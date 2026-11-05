import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import config, db, evals, llm, memory, rag
from .harness import run_agent
from .tools import ToolHub


@asynccontextmanager
async def lifespan(_app):
    db.init()
    yield


app = FastAPI(title="Cortex Agent", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    conversation_id: int | None = None


class EvalIn(BaseModel):
    dataset: str
    k: int = Field(default=5, ge=1, le=20)


class MemoryIn(BaseModel):
    content: str = Field(min_length=1, max_length=1000)
    kind: str = "hecho"


@app.get("/api/health")
def health():
    return {"ok": True, "llm": config.has_llm_credentials(), "agent_model": config.AGENT_MODEL, "small_model": config.SMALL_MODEL}


@app.post("/api/chat")
async def chat(body: ChatIn):
    if not body.message.strip():
        raise HTTPException(400, "El mensaje está vacío")
    if body.conversation_id is not None:
        with db.session() as conn:
            if not conn.execute("SELECT 1 FROM conversations WHERE id=?", (body.conversation_id,)).fetchone():
                raise HTTPException(404, "La conversación no existe")
    queue: asyncio.Queue = asyncio.Queue()

    async def worker():
        try:
            await run_agent(body.message, body.conversation_id, queue=queue)
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(worker())

    async def stream():
        try:
            while (event := await queue.get()) is not None:
                yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
        finally:
            # Client disconnects do not cancel the run: it finishes and stays in the trace history.
            if not task.done():
                await asyncio.shield(task)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/api/conversations")
def conversations():
    with db.session() as conn:
        return db.rows(conn.execute("SELECT * FROM conversations ORDER BY id DESC LIMIT 100"))


@app.get("/api/conversations/{conv_id}")
def conversation(conv_id: int):
    with db.session() as conn:
        conv = conn.execute("SELECT * FROM conversations WHERE id=?", (conv_id,)).fetchone()
        if not conv:
            raise HTTPException(404, "La conversación no existe")
        runs = db.rows(conn.execute("SELECT * FROM runs WHERE conv_id=? ORDER BY id", (conv_id,)))
        answers = {}
        for r in conn.execute(
            "SELECT e.run_id, e.data FROM events e JOIN runs r ON r.id=e.run_id WHERE r.conv_id=? AND "
            "(e.type='answer' OR (e.type='error' AND json_extract(e.data,'$.where')='harness'))",
            (conv_id,),
        ):
            data = json.loads(r["data"])
            answers[r["run_id"]] = data.get("text") or data.get("message", "")
    turns = [{"run_id": r["id"], "question": r["question"], "answer": answers.get(r["id"], ""), "status": r["status"]} for r in runs]
    return {**dict(conv), "turns": turns}


@app.delete("/api/conversations/{conv_id}")
def delete_conversation(conv_id: int):
    with db.session() as conn:
        if not conn.execute("DELETE FROM conversations WHERE id=?", (conv_id,)).rowcount:
            raise HTTPException(404, "La conversación no existe")
    return {"ok": True}


@app.get("/api/runs")
def runs(source: str | None = None):
    with db.session() as conn:
        sql = "SELECT * FROM runs" + (" WHERE source=?" if source else "") + " ORDER BY id DESC LIMIT 100"
        return db.rows(conn.execute(sql, (source,) if source else ()))


@app.get("/api/runs/{run_id}/events")
def run_events(run_id: int):
    with db.session() as conn:
        run = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if not run:
            raise HTTPException(404, "El run no existe")
        events = [{**r, "data": json.loads(r["data"])} for r in db.rows(conn.execute("SELECT * FROM events WHERE run_id=? ORDER BY seq", (run_id,)))]
    return {"run": dict(run), "events": events}


@app.get("/api/stats")
def stats():
    with db.session() as conn:
        one = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
        return {
            "documents": one("SELECT COUNT(*) FROM documents"),
            "chunks": one("SELECT COUNT(*) FROM chunks"),
            "memories": one("SELECT COUNT(*) FROM memories"),
            "runs": one("SELECT COUNT(*) FROM runs"),
            "tool_calls": one("SELECT COUNT(*) FROM events WHERE type='tool_call'"),
            "cost_usd": round(one("SELECT COALESCE(SUM(cost_usd),0) FROM runs"), 4),
            "eval_runs": one("SELECT COUNT(*) FROM eval_runs"),
        }


@app.post("/api/documents")
async def upload_document(file: UploadFile = File(...)):
    name = Path(file.filename or "documento.txt").name
    if Path(name).suffix.lower() not in rag.ALLOWED_EXT:
        raise HTTPException(400, "Formato no soportado. Usa .txt, .md o .pdf")
    data = await file.read(rag.MAX_UPLOAD_BYTES + 1)
    if len(data) > rag.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "El archivo supera 10 MB")
    try:
        text = rag.extract_text(name, data)
        return await asyncio.to_thread(rag.ingest, Path(name).stem, text, name)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(400, f"No se pudo leer el archivo: {type(exc).__name__}")


@app.get("/api/documents")
def documents():
    return rag.list_documents()


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int):
    if not rag.delete_document(doc_id):
        raise HTTPException(404, "El documento no existe")
    return {"ok": True}


@app.get("/api/rag/search")
def rag_search(q: str, k: int = 5):
    return rag.search(q, max(1, min(k, 20)))


@app.get("/api/rag/map")
def rag_map(q: str | None = None, k: int = 5):
    return rag.map_points(q, max(1, min(k, 20)))


@app.get("/api/memories")
def memories():
    return memory.list_all()


@app.post("/api/memories")
def add_memory(body: MemoryIn):
    try:
        return memory.save(body.content, body.kind)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.delete("/api/memories/{mid}")
def delete_memory(mid: int):
    if not memory.delete(mid):
        raise HTTPException(404, "La memoria no existe")
    return {"ok": True}


@app.get("/api/memories/graph")
def memory_graph():
    return memory.graph()


@app.get("/api/tools")
async def tools():
    async with ToolHub() as hub:
        catalog, errors = hub.catalog, hub.errors
    with db.session() as conn:
        usage = {
            r["name"]: {"calls": r["calls"], "errors": r["errors"] or 0}
            for r in conn.execute(
                "SELECT json_extract(data,'$.name') AS name, COUNT(*) AS calls, "
                "SUM(json_extract(data,'$.is_error')) AS errors FROM events WHERE type='tool_result' GROUP BY name"
            )
        }
    return {"tools": [{**t, **usage.get(t["name"], {"calls": 0, "errors": 0})} for t in catalog], "errors": errors}


@app.get("/api/evals/datasets")
def eval_datasets():
    return evals.list_datasets()


@app.post("/api/evals/run")
async def eval_run(body: EvalIn):
    try:
        return await evals.run_dataset(body.dataset, body.k)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    except (ValueError, llm.LLMUnavailable) as exc:
        raise HTTPException(400, str(exc))


@app.get("/api/evals/runs")
def eval_runs(dataset: str | None = None):
    return evals.list_runs(dataset)
