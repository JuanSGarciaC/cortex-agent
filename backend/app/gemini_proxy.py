"""Local translator: lets the Anthropic SDK talk to Gemini without touching the harness.

Run: python -m uvicorn app.gemini_proxy:app --host 127.0.0.1 --port 8787
Then set ANTHROPIC_BASE_URL=http://localhost:8787 and a Gemini model in AGENT_MODEL / SMALL_MODEL.
betas, fallbacks, thinking, cache_control and effort are dropped, so this never validates Claude."""
import os
import uuid

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import config  # noqa: F401  (loads backend/.env)

API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
SIGNATURE_SEP = "."  # Gemini requires thought signatures back; the tool id carries them so the proxy stays stateless
STOP_REASONS = {"STOP": "end_turn", "MAX_TOKENS": "max_tokens"}

app = FastAPI(title="Anthropic to Gemini proxy")


def _to_part(block: dict, tool_names: dict[str, str]) -> dict | None:
    kind = block.get("type")
    if kind == "text":
        return {"text": block["text"]}
    if kind == "tool_use":
        part = {"functionCall": {"name": block["name"], "args": block.get("input") or {}}}
        _, _, signature = block["id"].partition(SIGNATURE_SEP)
        return {**part, "thoughtSignature": signature} if signature else part
    if kind == "tool_result":
        content = block.get("content", "")
        if isinstance(content, list):
            content = "\n".join(b.get("text", "") for b in content)
        key = "error" if block.get("is_error") else "result"
        return {"functionResponse": {"name": tool_names[block["tool_use_id"]], "response": {key: content}}}
    return None  # thinking blocks do not exist on the Gemini side


def to_gemini(body: dict) -> dict:
    tool_names = {
        b["id"]: b["name"]
        for m in body["messages"]
        if isinstance(m["content"], list)
        for b in m["content"]
        if b.get("type") == "tool_use"
    }
    contents = []
    for message in body["messages"]:
        blocks = message["content"]
        if isinstance(blocks, str):
            blocks = [{"type": "text", "text": blocks}]
        parts = [p for p in (_to_part(b, tool_names) for b in blocks) if p]
        if parts:
            contents.append({"role": "model" if message["role"] == "assistant" else "user", "parts": parts})

    generation = {"maxOutputTokens": body.get("max_tokens", 8192)}
    if (body.get("output_config") or {}).get("format") or body.get("output_format"):
        generation["responseMimeType"] = "application/json"
    request = {"contents": contents, "generationConfig": generation}

    system = body.get("system")
    if isinstance(system, list):
        system = "\n".join(b.get("text", "") for b in system)
    if system:
        request["systemInstruction"] = {"parts": [{"text": system}]}
    if body.get("tools"):
        declarations = [
            {"name": t["name"], "description": t.get("description", ""), "parametersJsonSchema": t["input_schema"]}
            for t in body["tools"]
        ]
        request["tools"] = [{"functionDeclarations": declarations}]
    return request


def from_gemini(data: dict, model: str) -> dict:
    candidate = (data.get("candidates") or [{}])[0]
    content = []
    for part in (candidate.get("content") or {}).get("parts", []):
        if part.get("thought"):
            continue
        if "text" in part:
            content.append({"type": "text", "text": part["text"]})
        elif "functionCall" in part:
            tool_id = f"toolu_{uuid.uuid4().hex}"
            if part.get("thoughtSignature"):
                tool_id += SIGNATURE_SEP + part["thoughtSignature"]
            call = part["functionCall"]
            content.append({"type": "tool_use", "id": tool_id, "name": call["name"], "input": call.get("args") or {}})

    if any(b["type"] == "tool_use" for b in content):
        stop_reason = "tool_use"
    else:  # an empty candidate list or a SAFETY-like finish means Gemini declined
        stop_reason = STOP_REASONS.get(candidate.get("finishReason"), "refusal")
    usage = data.get("usageMetadata") or {}
    return {
        "id": f"msg_{uuid.uuid4().hex}",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": usage.get("promptTokenCount", 0), "output_tokens": usage.get("candidatesTokenCount", 0)},
    }


def _error(status: int, message: str, headers: dict | None = None) -> JSONResponse:
    body = {"type": "error", "error": {"type": "api_error", "message": message}}
    return JSONResponse(body, status_code=status, headers=headers)


@app.post("/v1/messages")
async def messages(request: Request):
    # A required header forces a CORS preflight, so a web page cannot spend the key through this local port.
    if "authorization" not in request.headers and "x-api-key" not in request.headers:
        return _error(401, "Falta el encabezado de autenticación")
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        return _error(401, "Falta GEMINI_API_KEY en backend/.env")
    body = await request.json()
    async with httpx.AsyncClient(timeout=300) as client:
        reply = await client.post(
            API_URL.format(model=body["model"]),
            headers={"x-goog-api-key": key},  # header, not query string: keeps the key out of URLs and logs
            json=to_gemini(body),
        )
    if reply.status_code != 200:
        retry = {"retry-after": reply.headers["retry-after"]} if "retry-after" in reply.headers else None
        return _error(reply.status_code, f"Gemini: {reply.text[:500]}", retry)
    return from_gemini(reply.json(), body["model"])
