"""Evals: retrieval metrics (no LLM), agent metrics, and an LLM judge. Results are stored per run so the UI
can compare runs case by case.

CLI (exit code 1 when the pass rate is below --min-pass, for CI):
    python -m app.evals datasets/retrieval_basico.json --min-pass 0.8
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

from pydantic import BaseModel, Field

from . import config, db, llm, rag

DATASETS_DIR = config.BASE_DIR / "datasets"


def list_datasets() -> list[dict]:
    out = []
    for path in sorted(DATASETS_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        out.append({"file": path.name, "name": data.get("name", path.stem), "kind": data["kind"], "cases": len(data["cases"])})
    return sorted(out, key=lambda d: d["kind"] != "retrieval")  # retrieval first: runs without an API key


def load_dataset(file: str) -> dict:
    path = (DATASETS_DIR / file).resolve()
    if path.parent != DATASETS_DIR.resolve() or not path.exists():
        raise FileNotFoundError("Dataset no encontrado")
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("kind") not in ("retrieval", "agent") or not data.get("cases"):
        raise ValueError("Dataset inválido: requiere kind (retrieval|agent) y cases")
    return data


def _doc_titles(chunk_ids: list[int]) -> list[str]:
    if not chunk_ids:
        return []
    with db.session() as conn:
        marks = ",".join("?" * len(chunk_ids))
        found = {
            r["id"]: r["title"]
            for r in conn.execute(
                f"SELECT c.id, d.title FROM chunks c JOIN documents d ON d.id=c.doc_id WHERE c.id IN ({marks})", chunk_ids
            )
        }
    return [found[c] for c in chunk_ids if c in found]


def retrieval_metrics(ranked_titles: list[str], expected: list[str]) -> dict:
    """recall@k over expected documents and MRR of the first relevant hit."""
    expected_set = set(expected)
    hits = expected_set & set(ranked_titles)
    recall = len(hits) / len(expected_set) if expected_set else 1.0
    first = next((i for i, t in enumerate(ranked_titles) if t in expected_set), None)
    return {"recall": round(recall, 4), "mrr": round(1 / (first + 1), 4) if first is not None else 0.0}


class Verdict(BaseModel):
    faithfulness: int = Field(description="1-5: la respuesta se apoya solo en los fragmentos recuperados")
    relevance: int = Field(description="1-5: la respuesta resuelve la pregunta y coincide con la referencia")
    reason: str = Field(description="Una frase que justifica la nota")


JUDGE_PROMPT = """Califica la respuesta de un asistente RAG.

Pregunta: {question}
Respuesta de referencia: {reference}
Fragmentos recuperados por el asistente:
{contexts}

Respuesta del asistente:
{answer}

faithfulness: 5 si toda afirmación está respaldada por los fragmentos (o la respuesta admite no saber), 1 si inventa. Si la pregunta no depende de documentos (por ejemplo, un cálculo) y la referencia no pide fragmentos, no penalices su ausencia: califica si la respuesta es correcta.
relevance: 5 si responde la pregunta y coincide con la referencia, 1 si no responde."""


async def judge(question: str, reference: str, contexts: list[str], answer: str) -> dict:
    v = await llm.structured(
        Verdict,
        JUDGE_PROMPT.format(
            question=question,
            reference=reference or "(sin referencia)",
            contexts="\n---\n".join(contexts)[:12000] or "(ninguno)",
            answer=answer,
        ),
    )
    if v is None:
        raise RuntimeError("El juez no devolvió un veredicto válido")
    clamp = lambda n: max(1, min(5, int(n)))  # noqa: E731
    return {"faithfulness": clamp(v.faithfulness), "relevance": clamp(v.relevance), "reason": v.reason}


async def _run_case(kind: str, case: dict, k: int) -> tuple[bool, dict, str]:
    expected = case.get("expected_docs", [])
    if kind == "retrieval":
        hits = rag.search(case["question"], k)
        titles = [h["title"] for h in hits]
        scores = retrieval_metrics(titles, expected)
        return scores["recall"] >= 1.0, scores, json.dumps(titles, ensure_ascii=False)

    from .harness import run_agent

    result = await run_agent(case["question"], source="eval", extract_memory=False, use_memory=False)
    expected_tool = case.get("expected_tool")
    scores = {
        "tool_ok": 1.0 if (expected_tool is None and not result["tools_used"]) or expected_tool in result["tools_used"] else 0.0,
        "steps": result["steps"],
        "cost_usd": round(result["cost_usd"], 6),
        "ms": result["ms"],
        "run_id": result["run_id"],
    }
    if result["status"] != "ok":
        scores["error"] = result["answer"]
        return False, scores, result["answer"]
    if expected:
        scores.update(retrieval_metrics(_doc_titles(result["retrieved"]), expected))
    try:
        verdict = await judge(case["question"], case.get("reference", ""), result["contexts"], result["answer"])
    except Exception as exc:  # a broken judge must not hide the agent's answer
        scores["error"] = f"Juez: {llm.describe_error(exc)}"
        return False, scores, result["answer"]
    scores.update(verdict)
    passed = scores["tool_ok"] == 1.0 and verdict["faithfulness"] >= 4 and verdict["relevance"] >= 4
    return passed, scores, result["answer"]


def _summary(kind: str, results: list[dict]) -> dict:
    n = len(results)
    summary = {"cases": n, "pass_rate": round(sum(r["passed"] for r in results) / n, 4) if n else 0}
    keys = ["recall", "mrr"] if kind == "retrieval" else ["tool_ok", "recall", "faithfulness", "relevance", "steps", "cost_usd", "ms"]
    for key in keys:
        vals = [r["scores"][key] for r in results if isinstance(r["scores"].get(key), (int, float))]
        if vals:
            summary[f"avg_{key}"] = round(sum(vals) / len(vals), 4)
    return summary


async def run_dataset(file: str, k: int = 5) -> dict:
    data = load_dataset(file)
    kind = data["kind"]
    if kind == "agent" and not config.has_llm_credentials():
        raise llm.LLMUnavailable("Los evals de agente necesitan ANTHROPIC_API_KEY.")
    results = []
    for case in data["cases"]:
        try:
            passed, scores, output = await _run_case(kind, case, k)
        except Exception as exc:  # one failing case is a result, not a crashed run
            passed, scores, output = False, {"error": llm.describe_error(exc)}, ""
        results.append({"case_id": case["id"], "question": case["question"], "passed": passed, "scores": scores, "output": output})
    summary = _summary(kind, results)
    with db.session() as conn:
        run_id = conn.execute(
            "INSERT INTO eval_runs(dataset, kind, summary, created_at) VALUES (?,?,?,?)",
            (file, kind, db.dumps(summary), db.now()),
        ).lastrowid
        conn.executemany(
            "INSERT INTO eval_results(eval_run_id, case_id, passed, scores, output) VALUES (?,?,?,?,?)",
            [(run_id, r["case_id"], int(r["passed"]), db.dumps(r["scores"]), r["output"]) for r in results],
        )
    return {"id": run_id, "dataset": file, "kind": kind, "summary": summary, "results": results}


def list_runs(dataset: str | None = None) -> list[dict]:
    with db.session() as conn:
        sql = "SELECT * FROM eval_runs" + (" WHERE dataset=?" if dataset else "") + " ORDER BY id DESC LIMIT 50"
        runs = db.rows(conn.execute(sql, (dataset,) if dataset else ()))
        for run in runs:
            run["summary"] = json.loads(run["summary"])
            run["results"] = [
                {**r, "scores": json.loads(r["scores"]), "passed": bool(r["passed"])}
                for r in db.rows(conn.execute("SELECT case_id, passed, scores, output FROM eval_results WHERE eval_run_id=? ORDER BY id", (run["id"],)))
            ]
    return runs


def main() -> None:
    parser = argparse.ArgumentParser(description="Corre un dataset de evals de Cortex")
    parser.add_argument("dataset", help="Archivo dentro de backend/datasets")
    parser.add_argument("--k", type=int, default=5)
    parser.add_argument("--min-pass", type=float, default=0.0)
    args = parser.parse_args()
    db.init()
    report = asyncio.run(run_dataset(Path(args.dataset).name, args.k))
    for r in report["results"]:
        print(f"{'PASS' if r['passed'] else 'FAIL'}  {r['case_id']:<8} {json.dumps(r['scores'], ensure_ascii=False)}")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    sys.exit(0 if report["summary"]["pass_rate"] >= args.min_pass else 1)


if __name__ == "__main__":
    main()
