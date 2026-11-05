import asyncio
import json

from fastapi.testclient import TestClient

from app import db, evals, llm, memory, rag
from app.harness import run_agent
from app.main import app
from app.tools import ToolHub
from tests.conftest import FakeClient, Response, final, tool_use


# ---------- RAG ----------
def test_chunk_respects_size_and_overlap():
    text = "a" * 2000 + "\n\n" + "corto"
    parts = rag.chunk(text, size=800, overlap=100)
    assert all(len(p) <= 800 for p in parts)
    assert parts[1].startswith("a" * 100)  # overlap carried into the next slice
    assert parts[-1].endswith("corto")


def test_hybrid_search_finds_right_document(seeded):
    hits = rag.search("tope de hospedaje por noche", 3)
    assert hits[0]["title"] == "politica-gastos"
    assert hits[0]["bm25_rank"] is not None and hits[0]["vector_rank"] is not None


def test_delete_document_removes_fts_rows(seeded):
    doc = next(d for d in rag.list_documents() if d["title"] == "politica-gastos")
    assert rag.delete_document(doc["id"])
    assert all(h["title"] != "politica-gastos" for h in rag.search("hospedaje minibar", 5))
    with db.session() as conn:
        assert conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == conn.execute("SELECT COUNT(*) FROM chunks_fts").fetchone()[0]


def test_map_points_projects_query_and_neighbors(seeded):
    m = rag.map_points("contraseña bloqueada", 3)
    assert len(m["points"]) == sum(d["chunks"] for d in rag.list_documents())
    assert all(-1.0001 <= p["x"] <= 1.0001 for p in m["points"])
    assert m["query"] is not None and len(m["neighbors"]) == 3


# ---------- Memoria ----------
def test_memory_dedupes_and_recalls():
    a = memory.save("El usuario prefiere respuestas cortas", "preferencia")
    b = memory.save("El usuario prefiere respuestas cortas", "preferencia")
    assert not a["duplicate"] and b["duplicate"] and b["id"] == a["id"]
    memory.save("Trabaja en el área de logística en Bogotá", "contexto")
    hits = memory.recall("respuestas cortas")
    assert hits[0]["id"] == a["id"]
    assert memory.graph()["nodes"]


# ---------- MCP ----------
def test_tool_hub_exposes_own_server_over_mcp(seeded):
    async def go():
        async with ToolHub() as hub:
            names = {t["name"] for t in hub.anthropic_tools()}
            out, err = await hub.call("rag_search", {"query": "vacaciones por año", "k": 2})
            bad, bad_err = await hub.call("no_existe", {})
            return names, out, err, bad_err

    names, out, err, bad_err = asyncio.run(go())
    assert {"rag_search", "rag_list_documents", "memory_save", "memory_recall"} <= names
    assert not err and json.loads(out)[0]["documento"] == "politica-vacaciones"
    assert bad_err


# ---------- Harness ----------
def test_harness_tool_loop_traces_and_persists(seeded):
    fake = FakeClient([tool_use("rag_search", {"query": "vacaciones por año"}), final("Son 15 días [1].")],
                      facts=[memory.Fact(content="El usuario lleva 7 años en la empresa", kind="hecho")])
    llm.set_client(fake)
    result = asyncio.run(run_agent("¿Cuántos días de vacaciones tengo?"))

    assert result["status"] == "ok" and result["answer"] == "Son 15 días [1]."
    assert result["tools_used"] == ["rag_search"] and result["retrieved"]
    assert result["steps"] == 2
    second_call = fake.calls[1]["messages"]
    assert second_call[-1]["content"][0]["type"] == "tool_result"
    assert fake.calls[0]["fallbacks"] == "default"
    with db.session() as conn:
        types = [r[0] for r in conn.execute("SELECT type FROM events WHERE run_id=? ORDER BY seq", (result["run_id"],))]
        roles = [r[0] for r in conn.execute("SELECT role FROM messages ORDER BY id")]
    assert types[0] == "run_start" and types[-1] == "run_end"
    for t in ("memory_recall", "llm_call", "thinking", "tool_call", "tool_result", "answer", "memory_write"):
        assert t in types
    assert roles == ["user", "assistant", "user", "assistant"]


def test_harness_stops_at_max_steps_with_valid_history(seeded, monkeypatch):
    from app import config

    monkeypatch.setattr(config, "MAX_STEPS", 2)
    llm.set_client(FakeClient([tool_use("rag_search", {"query": "x"}, "a"), tool_use("rag_search", {"query": "y"}, "b")]))
    result = asyncio.run(run_agent("pregunta en bucle", extract_memory=False))
    assert result["status"] == "max_steps"
    with db.session() as conn:
        roles = [r[0] for r in conn.execute("SELECT role FROM messages ORDER BY id")]
    assert roles[-1] == "assistant"

    # The next turn on the same conversation must still alternate roles.
    fake = FakeClient([final("ok")])
    llm.set_client(fake)
    asyncio.run(run_agent("sigo", conversation_id=result["conversation_id"], extract_memory=False))
    sent = [m["role"] for m in fake.calls[0]["messages"]]
    assert all(a != b for a, b in zip(sent, sent[1:]))


def test_harness_reports_missing_credentials(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    result = asyncio.run(run_agent("hola"))
    assert result["status"] == "error" and "ANTHROPIC_API_KEY" in result["answer"]
    with db.session() as conn:
        assert conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0] == 0


def test_harness_handles_refusal(seeded):
    llm.set_client(FakeClient([Response([], "refusal")]))
    result = asyncio.run(run_agent("algo", extract_memory=False))
    assert result["status"] == "refused" and result["answer"]


# ---------- Evals ----------
def test_retrieval_metrics():
    assert evals.retrieval_metrics(["b", "a"], ["a"]) == {"recall": 1.0, "mrr": 0.5}
    assert evals.retrieval_metrics(["b"], ["a"]) == {"recall": 0.0, "mrr": 0.0}


def test_retrieval_dataset_runs_and_is_stored(seeded):
    report = asyncio.run(evals.run_dataset("retrieval_basico.json"))
    assert report["summary"]["cases"] == 12
    assert report["summary"]["avg_recall"] >= 0.75
    assert evals.list_runs("retrieval_basico.json")[0]["results"]


def test_agent_dataset_with_judge(seeded, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")

    def respond(kwargs):
        last = kwargs["messages"][-1]["content"][0]
        if last.get("type") == "tool_result":
            return final("Respuesta basada en los fragmentos.")
        if "17 por 23" in last.get("text", ""):
            return final("391")
        return tool_use("rag_search", {"query": last["text"]})

    llm.set_client(FakeClient([respond] * 20))
    report = asyncio.run(evals.run_dataset("agente_rag.json"))
    by_id = {r["case_id"]: r for r in report["results"]}
    assert by_id["a06"]["scores"]["tool_ok"] == 1.0
    assert by_id["a01"]["passed"]
    assert report["summary"]["avg_faithfulness"] == 5


def test_dataset_path_traversal_rejected():
    import pytest

    with pytest.raises(FileNotFoundError):
        evals.load_dataset("../app/config.py")


# ---------- API ----------
def test_api_upload_chat_stream_and_trace():
    llm.set_client(FakeClient([final("Hola, soy Cortex.")]))
    with TestClient(app) as client:
        up = client.post("/api/documents", files={"file": ("notas.md", "# Notas\n\nEl código de bodega es 4471.".encode(), "text/markdown")})
        assert up.status_code == 200 and up.json()["chunks"] == 1
        assert client.post("/api/documents", files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 400

        with client.stream("POST", "/api/chat", json={"message": "hola"}) as r:
            events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
        assert events[0]["type"] == "run_start" and events[-1]["type"] == "run_end"
        run_id = events[0]["run_id"]
        trace = client.get(f"/api/runs/{run_id}/events").json()
        assert len(trace["events"]) == len(events)
        conv = client.get(f"/api/conversations/{events[0]['data']['conversation_id']}").json()
        assert conv["turns"][0]["answer"] == "Hola, soy Cortex."
        assert client.post("/api/chat", json={"message": "x", "conversation_id": 999}).status_code == 404
        assert client.post("/api/chat", json={"message": "   "}).status_code == 400
        tools = client.get("/api/tools").json()["tools"]
        assert any(t["name"] == "rag_search" for t in tools)
        assert client.get("/api/stats").json()["documents"] == 1
