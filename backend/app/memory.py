"""Long-term memory: facts with embeddings, dedupe on save, semantic recall, auto-extraction."""
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field

from . import config, db, llm
from .embed import embed, from_blob, to_blob

KINDS = ("preferencia", "hecho", "objetivo", "contexto")
DUPLICATE_SIM = 0.92
EDGE_SIM = 0.5


def _all(conn) -> tuple[list[dict], np.ndarray]:
    items = db.rows(conn.execute("SELECT id, content, kind, embedding, run_id, created_at FROM memories ORDER BY id"))
    if not items:
        return [], np.zeros((0, 1), dtype=np.float32)
    return items, np.vstack([from_blob(i.pop("embedding")) for i in items])


def save(content: str, kind: str = "hecho", run_id: int | None = None) -> dict:
    content = content.strip()
    if not content:
        raise ValueError("La memoria no puede estar vacía")
    if kind not in KINDS:
        kind = "hecho"
    vec = embed([content])[0]
    with db.session() as conn:
        items, matrix = _all(conn)
        if items:
            sims = matrix @ vec
            best = int(np.argmax(sims))
            if sims[best] >= DUPLICATE_SIM:
                return {**items[best], "duplicate": True}
        mid = conn.execute(
            "INSERT INTO memories(content, kind, embedding, run_id, created_at) VALUES (?,?,?,?,?)",
            (content, kind, to_blob(vec), run_id, db.now()),
        ).lastrowid
    return {"id": mid, "content": content, "kind": kind, "run_id": run_id, "duplicate": False}


def recall(query: str, k: int = 5, min_sim: float = 0.3) -> list[dict]:
    if not query.strip():
        return []
    with db.session() as conn:
        items, matrix = _all(conn)
    if not items:
        return []
    sims = matrix @ embed([query])[0]
    order = np.argsort(-sims)[:k]
    return [{**items[i], "similarity": round(float(sims[i]), 4)} for i in order if sims[i] >= min_sim]


def list_all() -> list[dict]:
    with db.session() as conn:
        return db.rows(conn.execute("SELECT id, content, kind, run_id, created_at FROM memories ORDER BY id DESC"))


def delete(mid: int) -> bool:
    with db.session() as conn:
        return conn.execute("DELETE FROM memories WHERE id=?", (mid,)).rowcount > 0


def graph() -> dict:
    """Nodes plus edges between semantically close facts (top 3 neighbors above EDGE_SIM)."""
    with db.session() as conn:
        items, matrix = _all(conn)
    edges = []
    if len(items) > 1:
        sims = matrix @ matrix.T
        np.fill_diagonal(sims, -1)
        seen = set()
        for i in range(len(items)):
            for j in np.argsort(-sims[i])[:3]:
                j = int(j)
                key = (min(i, j), max(i, j))
                if sims[i, j] >= EDGE_SIM and key not in seen:
                    seen.add(key)
                    edges.append({"source": items[i]["id"], "target": items[j]["id"], "weight": round(float(sims[i, j]), 3)})
    return {"nodes": items, "edges": edges}


class Fact(BaseModel):
    content: str = Field(description="Hecho breve y autocontenido, en tercera persona")
    kind: Literal["preferencia", "hecho", "objetivo", "contexto"]


class Facts(BaseModel):
    facts: list[Fact]


EXTRACT_PROMPT = (
    "Extrae de esta conversación los hechos duraderos sobre el usuario que valga la pena recordar "
    "en futuras conversaciones: preferencias, objetivos, datos personales o de su trabajo que él mismo dijo. "
    "No incluyas el contenido de documentos, respuestas del asistente ni datos efímeros. "
    "Si no hay nada que valga la pena, devuelve una lista vacía. Máximo 3 hechos.\n\n"
    "Usuario: {user}\n\nAsistente: {answer}"
)


async def extract(user_text: str, answer: str) -> list[Fact]:
    response = await llm.client().messages.parse(
        model=config.SMALL_MODEL,
        max_tokens=2000,
        output_config={"effort": "low"},
        messages=[{"role": "user", "content": EXTRACT_PROMPT.format(user=user_text, answer=answer[:4000])}],
        output_format=Facts,
    )
    parsed = response.parsed_output
    return parsed.facts[:3] if parsed else []
