"""Loads the sample knowledge base (docs_seed/) once. Run: python seed.py"""
from pathlib import Path

from app import db, rag

db.init()
existing = {d["title"] for d in rag.list_documents()}
for path in sorted((Path(__file__).parent / "docs_seed").glob("*.md")):
    if path.stem in existing:
        print(f"ya existe  {path.stem}")
        continue
    info = rag.ingest(path.stem, path.read_text(encoding="utf-8"), path.name)
    print(f"cargado    {info['title']} ({info['chunks']} fragmentos)")

# Example memories so the memory graph is not empty on a fresh install.
from app import memory  # noqa: E402

if not memory.list_all():
    for content, kind in [
        ("El usuario prefiere respuestas en viñetas", "preferencia"),
        ("El usuario prefiere respuestas cortas y con la cifra exacta", "preferencia"),
        ("El usuario trabaja en el área de operaciones en Bogotá", "contexto"),
        ("El usuario viaja a Cali y Medellín por trabajo cada mes", "contexto"),
        ("El usuario lleva 7 años en la empresa", "hecho"),
        ("El usuario tiene contrato a término indefinido", "hecho"),
        ("El usuario quiere tomar vacaciones en diciembre", "objetivo"),
        ("El usuario quiere reducir sus gastos de viaje este trimestre", "objetivo"),
    ]:
        memory.save(content, kind)
    print("memorias de ejemplo cargadas")
