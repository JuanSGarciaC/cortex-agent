"""Cortex's own MCP server. In-process for the harness; stdio for Claude Desktop and other hosts:

    python -m app.mcp_server
"""
import json

from mcp.server.mcpserver import MCPServer

from . import db, memory, rag

server = MCPServer(
    "cortex",
    instructions="Base de conocimiento (RAG) y memoria de largo plazo del usuario.",
)


@server.tool()
def rag_search(query: str, k: int = 5) -> str:
    """Busca en la base de conocimiento del usuario (documentos subidos) y devuelve los fragmentos más
    relevantes con su id y título. Úsala antes de responder preguntas sobre esos documentos y cita los ids."""
    k = max(1, min(int(k), 10))
    hits = rag.search(query, k)
    if not hits:
        return "Sin resultados en la base de conocimiento."
    return json.dumps(
        [{"chunk_id": h["chunk_id"], "documento": h["title"], "texto": h["text"]} for h in hits],
        ensure_ascii=False,
    )


@server.tool()
def rag_list_documents() -> str:
    """Lista los documentos disponibles en la base de conocimiento (id, título, número de fragmentos)."""
    docs = rag.list_documents()
    return json.dumps([{"id": d["id"], "titulo": d["title"], "fragmentos": d["chunks"]} for d in docs], ensure_ascii=False)


@server.tool()
def memory_save(content: str, kind: str = "hecho") -> str:
    """Guarda un hecho duradero sobre el usuario. kind: preferencia, hecho, objetivo o contexto.
    Úsala solo cuando el usuario pida recordar algo o diga un dato estable sobre sí mismo."""
    saved = memory.save(content, kind)
    return "Ya estaba guardado." if saved["duplicate"] else f"Guardado con id {saved['id']}."


@server.tool()
def memory_recall(query: str, k: int = 5) -> str:
    """Recupera hechos guardados sobre el usuario relacionados con la consulta."""
    hits = memory.recall(query, max(1, min(int(k), 10)))
    if not hits:
        return "No hay memorias relacionadas."
    return json.dumps([{"id": h["id"], "tipo": h["kind"], "contenido": h["content"]} for h in hits], ensure_ascii=False)


if __name__ == "__main__":
    db.init()
    server.run()
