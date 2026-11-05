"""Cortex's own agent harness: a manual loop over the Messages API.

Every step is written to the `events` table (and pushed to an optional queue for SSE), so the UI,
the trace viewer and the evals all read from the same record."""
import asyncio
import json
import time

from . import config, db, llm, memory
from .tools import ToolHub

SYSTEM = (
    "Eres Cortex, un asistente con acceso a la base de conocimiento del usuario y a su memoria de largo "
    "plazo mediante herramientas MCP.\n"
    "- Para preguntas sobre los documentos del usuario, usa rag_search antes de responder y cita los "
    "fragmentos que uses como [chunk_id].\n"
    "- Si la búsqueda no trae nada útil, dilo en lugar de inventar.\n"
    "- Usa memory_save solo cuando el usuario pida recordar algo.\n"
    "- Responde en español, breve y directo, en Markdown."
)
FALLBACK_BETA = "server-side-fallback-2026-07-01"
TOOL_OUTPUT_PREVIEW = 2000


class Tracer:
    def __init__(self, run_id: int, queue: asyncio.Queue | None = None):
        self.run_id = run_id
        self.queue = queue
        self.seq = 0

    def emit(self, type_: str, **data) -> None:
        self.seq += 1
        event = {"run_id": self.run_id, "seq": self.seq, "type": type_, "data": data, "ts": db.now()}
        with db.session() as conn:
            conn.execute(
                "INSERT INTO events(run_id, seq, type, data, ts) VALUES (?,?,?,?,?)",
                (self.run_id, self.seq, type_, db.dumps(data), event["ts"]),
            )
        if self.queue is not None:
            self.queue.put_nowait(event)


def _load_history(conv_id: int) -> list[dict]:
    with db.session() as conn:
        return [
            {"role": r["role"], "content": json.loads(r["content"])}
            for r in conn.execute("SELECT role, content FROM messages WHERE conv_id=? ORDER BY id", (conv_id,))
        ]


def _ensure_conversation(conv_id: int | None, message: str) -> int:
    with db.session() as conn:
        if conv_id is not None:
            if conn.execute("SELECT 1 FROM conversations WHERE id=?", (conv_id,)).fetchone():
                return conv_id
            raise LookupError("La conversación no existe")
        return conn.execute(
            "INSERT INTO conversations(title, created_at) VALUES (?,?)", (message[:60], db.now())
        ).lastrowid


def _block_dict(block) -> dict:
    return block.to_dict() if hasattr(block, "to_dict") else dict(block)


async def run_agent(
    message: str,
    conversation_id: int | None = None,
    queue: asyncio.Queue | None = None,
    source: str = "chat",
    extract_memory: bool = True,
    use_memory: bool = True,
) -> dict:
    message = message.strip()
    if not message:
        raise ValueError("El mensaje está vacío")
    conv_id = _ensure_conversation(conversation_id, message)
    history = _load_history(conv_id)
    with db.session() as conn:
        run_id = conn.execute(
            "INSERT INTO runs(conv_id, status, model, question, started_at, source) VALUES (?,?,?,?,?,?)",
            (conv_id, "running", config.AGENT_MODEL, message, db.now(), source),
        ).lastrowid
    tracer = Tracer(run_id, queue)
    started = time.perf_counter()
    tracer.emit("run_start", conversation_id=conv_id, model=config.AGENT_MODEL, question=message)

    totals = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "steps": 0}
    status, answer, tools_used, retrieved, contexts = "ok", "", [], [], []
    new_messages: list[dict] = []

    try:
        recalled = memory.recall(message, k=5) if use_memory else []
        tracer.emit("memory_recall", items=[{"id": m["id"], "content": m["content"], "kind": m["kind"], "similarity": m["similarity"]} for m in recalled])
        text = message
        if recalled:
            facts = "\n".join(f"- ({m['kind']}) {m['content']}" for m in recalled)
            text = f"<memoria_del_usuario>\n{facts}\n</memoria_del_usuario>\n\n{message}"
        new_messages.append({"role": "user", "content": [{"type": "text", "text": text}]})

        client = llm.client()
        async with ToolHub() as hub:
            for name, err in hub.errors.items():
                tracer.emit("error", where=f"mcp:{name}", message=err)
            tools = hub.anthropic_tools()
            for step in range(1, config.MAX_STEPS + 1):
                totals["steps"] = step
                t0 = time.perf_counter()
                response = await client.beta.messages.create(
                    model=config.AGENT_MODEL,
                    max_tokens=16000,
                    system=SYSTEM,
                    tools=tools,
                    messages=history + new_messages,
                    thinking={"type": "adaptive", "display": "summarized"},
                    output_config={"effort": config.AGENT_EFFORT},
                    cache_control={"type": "ephemeral"},
                    betas=[FALLBACK_BETA],
                    fallbacks="default",
                )
                usage = response.usage
                in_tok, out_tok = usage.input_tokens or 0, usage.output_tokens or 0
                step_cost = config.cost_usd(response.model, in_tok, out_tok)
                totals["input_tokens"] += in_tok
                totals["output_tokens"] += out_tok
                totals["cost_usd"] += step_cost
                tracer.emit(
                    "llm_call",
                    step=step,
                    model=response.model,
                    stop_reason=response.stop_reason,
                    input_tokens=in_tok,
                    output_tokens=out_tok,
                    cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
                    cost_usd=round(step_cost, 6),
                    ms=round((time.perf_counter() - t0) * 1000),
                )

                content = []
                for block in response.content:
                    data = _block_dict(block)
                    if data.get("type") == "fallback":
                        # Audit marker for a server-side model switch; safe to drop from history.
                        tracer.emit("fallback", step=step, detail=data)
                        continue
                    if data.get("type") == "thinking" and data.get("thinking"):
                        tracer.emit("thinking", step=step, text=data["thinking"])
                    content.append(data)
                texts = [b["text"] for b in content if b.get("type") == "text"]

                if response.stop_reason == "tool_use":
                    new_messages.append({"role": "assistant", "content": content})
                    calls = [b for b in content if b.get("type") == "tool_use"]
                    results = await asyncio.gather(*(_run_tool(hub, tracer, step, c) for c in calls))
                    for call, (output, is_error) in zip(calls, results):
                        tools_used.append(call["name"])
                        if call["name"] == "rag_search" and not is_error:
                            retrieved.extend(_chunk_ids(output))
                            contexts.append(output)
                    new_messages.append(
                        {
                            "role": "user",
                            "content": [
                                {"type": "tool_result", "tool_use_id": c["id"], "content": out, "is_error": err}
                                for c, (out, err) in zip(calls, results)
                            ],
                        }
                    )
                    if totals["cost_usd"] >= config.MAX_COST_USD:
                        status, answer = "budget", "Se alcanzó el límite de costo del run antes de terminar."
                        break
                    continue
                if response.stop_reason == "pause_turn":
                    new_messages.append({"role": "assistant", "content": content})
                    continue

                if response.stop_reason == "refusal":
                    status = "refused"
                    answer = "\n".join(texts) or "El modelo declinó responder esta solicitud."
                elif response.stop_reason == "max_tokens":
                    status = "truncated"
                    answer = "\n".join(texts) + "\n\n(Respuesta cortada por el límite de tokens.)"
                else:
                    answer = "\n".join(texts)
                new_messages.append({"role": "assistant", "content": content or [{"type": "text", "text": answer or "(sin respuesta)"}]})
                break
            else:
                status, answer = "max_steps", f"Se alcanzó el límite de {config.MAX_STEPS} pasos antes de terminar."

        if new_messages[-1]["role"] != "assistant":
            # Keep the stored history valid (user/assistant alternation) when the loop stopped mid-tools.
            new_messages.append({"role": "assistant", "content": [{"type": "text", "text": answer}]})
        _persist(conv_id, new_messages)
        tracer.emit("answer", text=answer, status=status)

        if extract_memory and status == "ok":
            try:
                for fact in await memory.extract(message, answer):
                    saved = memory.save(fact.content, fact.kind, run_id)
                    if not saved["duplicate"]:
                        tracer.emit("memory_write", id=saved["id"], content=saved["content"], kind=saved["kind"])
            except Exception as exc:  # memory is best-effort; the answer is already saved
                tracer.emit("error", where="memory_extract", message=llm.describe_error(exc))
    except Exception as exc:
        status = "error"
        answer = llm.describe_error(exc)
        tracer.emit("error", where="harness", message=answer)

    ms = round((time.perf_counter() - started) * 1000)
    with db.session() as conn:
        conn.execute(
            "UPDATE runs SET status=?, steps=?, input_tokens=?, output_tokens=?, cost_usd=?, ended_at=? WHERE id=?",
            (status, totals["steps"], totals["input_tokens"], totals["output_tokens"], totals["cost_usd"], db.now(), run_id),
        )
    tracer.emit("run_end", status=status, ms=ms, **{k: round(v, 6) if isinstance(v, float) else v for k, v in totals.items()})
    return {
        "run_id": run_id,
        "conversation_id": conv_id,
        "status": status,
        "answer": answer,
        "tools_used": tools_used,
        "retrieved": retrieved,
        "contexts": contexts,
        "ms": ms,
        **totals,
    }


async def _run_tool(hub: ToolHub, tracer: Tracer, step: int, call: dict) -> tuple[str, bool]:
    tracer.emit("tool_call", step=step, id=call["id"], name=call["name"], input=call.get("input", {}))
    t0 = time.perf_counter()
    output, is_error = await hub.call(call["name"], call.get("input") or {})
    tracer.emit(
        "tool_result",
        step=step,
        id=call["id"],
        name=call["name"],
        is_error=is_error,
        output=output[:TOOL_OUTPUT_PREVIEW],
        ms=round((time.perf_counter() - t0) * 1000),
    )
    return output, is_error


def _chunk_ids(output: str) -> list[int]:
    try:
        return [int(h["chunk_id"]) for h in json.loads(output)]
    except (ValueError, TypeError, KeyError):
        return []


def _persist(conv_id: int, messages: list[dict]) -> None:
    with db.session() as conn:
        conn.executemany(
            "INSERT INTO messages(conv_id, role, content, created_at) VALUES (?,?,?,?)",
            [(conv_id, m["role"], db.dumps(m["content"]), db.now()) for m in messages],
        )
