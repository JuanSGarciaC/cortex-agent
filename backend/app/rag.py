"""RAG: ingestion, chunking, hybrid search (BM25 + vector, fused with RRF) and a 2D map."""
import io
import re

import numpy as np

from . import db
from .embed import embed, from_blob, to_blob

CHUNK_CHARS = 500
OVERLAP_CHARS = 100
RRF_K = 60
ALLOWED_EXT = {".txt", ".md", ".pdf"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def extract_text(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    return data.decode("utf-8", errors="replace")


def chunk(text: str, size: int = CHUNK_CHARS, overlap: int = OVERLAP_CHARS) -> list[str]:
    """Pack paragraphs up to `size` chars; split oversize paragraphs with overlap."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    pieces: list[str] = []
    for p in paragraphs:
        if len(p) <= size:
            pieces.append(p)
            continue
        start = 0
        while start < len(p):
            pieces.append(p[start : start + size])
            if start + size >= len(p):
                break
            start += size - overlap
    chunks: list[str] = []
    current = ""
    for piece in pieces:
        if current and len(current) + len(piece) + 2 > size:
            chunks.append(current)
            current = piece
        else:
            current = f"{current}\n\n{piece}" if current else piece
    if current:
        chunks.append(current)
    return chunks


def ingest(title: str, text: str, source: str = "upload") -> dict:
    parts = chunk(text)
    if not parts:
        raise ValueError("El documento no tiene texto extraíble")
    vectors = embed(parts)
    with db.session() as conn:
        doc_id = conn.execute(
            "INSERT INTO documents(title, source, chars, created_at) VALUES (?,?,?,?)",
            (title, source, len(text), db.now()),
        ).lastrowid
        for i, (part, vec) in enumerate(zip(parts, vectors)):
            cid = conn.execute(
                "INSERT INTO chunks(doc_id, ord, text, embedding) VALUES (?,?,?,?)",
                (doc_id, i, part, to_blob(vec)),
            ).lastrowid
            conn.execute("INSERT INTO chunks_fts(rowid, text) VALUES (?,?)", (cid, part))
    return {"id": doc_id, "title": title, "chunks": len(parts)}


def delete_document(doc_id: int) -> bool:
    with db.session() as conn:
        ids = [r[0] for r in conn.execute("SELECT id FROM chunks WHERE doc_id=?", (doc_id,))]
        conn.executemany("DELETE FROM chunks_fts WHERE rowid=?", [(i,) for i in ids])
        return conn.execute("DELETE FROM documents WHERE id=?", (doc_id,)).rowcount > 0


def list_documents() -> list[dict]:
    with db.session() as conn:
        return db.rows(
            conn.execute(
                "SELECT d.id, d.title, d.source, d.chars, d.created_at, COUNT(c.id) AS chunks "
                "FROM documents d LEFT JOIN chunks c ON c.doc_id=d.id GROUP BY d.id ORDER BY d.id DESC"
            )
        )


def _load_chunks(conn) -> tuple[list[dict], np.ndarray]:
    # shortcut: loads every vector per query (brute force), fine up to ~50k chunks; switch to sqlite-vec beyond that.
    items = db.rows(
        conn.execute(
            "SELECT c.id, c.doc_id, c.ord, c.text, c.embedding, d.title FROM chunks c "
            "JOIN documents d ON d.id=c.doc_id ORDER BY c.id"
        )
    )
    if not items:
        return [], np.zeros((0, 1), dtype=np.float32)
    matrix = np.vstack([from_blob(i.pop("embedding")) for i in items])
    return items, matrix


def _fts_query(q: str) -> str:
    tokens = re.findall(r"\w+", q.lower())
    return " OR ".join(f'"{t}"' for t in tokens if len(t) > 2)


def search(query: str, k: int = 5) -> list[dict]:
    query = query.strip()
    if not query:
        return []
    with db.session() as conn:
        items, matrix = _load_chunks(conn)
        if not items:
            return []
        qvec = embed([query])[0]
        sims = matrix @ qvec
        vec_order = list(np.argsort(-sims)[: max(20, k)])
        by_id = {it["id"]: idx for idx, it in enumerate(items)}
        bm25_ids: list[int] = []
        fts = _fts_query(query)
        if fts:
            bm25_ids = [
                r[0]
                for r in conn.execute(
                    "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT 20",
                    (fts,),
                )
            ]
    scores: dict[int, float] = {}
    vec_rank = {int(idx): r for r, idx in enumerate(vec_order)}
    bm_rank = {by_id[cid]: r for r, cid in enumerate(bm25_ids) if cid in by_id}
    for idx, r in vec_rank.items():
        scores[idx] = scores.get(idx, 0) + 1 / (RRF_K + r + 1)
    for idx, r in bm_rank.items():
        scores[idx] = scores.get(idx, 0) + 1 / (RRF_K + r + 1)
    ranked = sorted(scores, key=lambda i: -scores[i])[:k]
    return [
        {
            "chunk_id": items[i]["id"],
            "doc_id": items[i]["doc_id"],
            "title": items[i]["title"],
            "text": items[i]["text"],
            "score": round(scores[i], 5),
            "similarity": round(float(sims[i]), 4),
            "vector_rank": vec_rank.get(i),
            "bm25_rank": bm_rank.get(i),
        }
        for i in ranked
    ]


def map_points(query: str | None = None, k: int = 5) -> dict:
    """2D PCA projection of every chunk; optionally the query point and its retrieved neighbors."""
    # shortcut: PCA instead of UMAP keeps deps light; clusters are coarser. Swap in umap-learn if the map gets crowded.
    with db.session() as conn:
        items, matrix = _load_chunks(conn)
    if len(items) < 2:
        return {"points": [{"id": it["id"], "doc_id": it["doc_id"], "title": it["title"], "x": 0, "y": 0, "preview": it["text"][:140]} for it in items], "query": None, "neighbors": []}
    mean = matrix.mean(axis=0)
    _, _, vt = np.linalg.svd(matrix - mean, full_matrices=False)
    comps = vt[:2]
    coords = (matrix - mean) @ comps.T
    scale = np.abs(coords).max(axis=0)
    scale[scale == 0] = 1
    coords = coords / scale
    points = [
        {"id": it["id"], "doc_id": it["doc_id"], "title": it["title"], "x": float(x), "y": float(y), "preview": it["text"][:140]}
        for it, (x, y) in zip(items, coords)
    ]
    result = {"points": points, "query": None, "neighbors": []}
    if query and query.strip():
        q = (embed([query])[0] - mean) @ comps.T / scale
        result["query"] = {"x": float(np.clip(q[0], -1.2, 1.2)), "y": float(np.clip(q[1], -1.2, 1.2)), "text": query}
        result["neighbors"] = [h["chunk_id"] for h in search(query, k)]
    return result
