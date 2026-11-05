# HANDOFF — Cortex Agent (estado al 2026-11-05)

## Objetivo
Una sola app que reúne un harness de agente propio, MCP, RAG, memoria y evals, con una UI muy visual. Ver `SPEC.md` y `README.md`.

## Qué está hecho y verificado
- Backend FastAPI + SQLite en `backend/app/`: harness, MCP (servidor y cliente), RAG, memoria, evals y API con SSE.
- Frontend React/Vite en `frontend/src/` con siete vistas.
- 15 tests en verde: `cd backend && .venv\Scripts\python -m pytest -q`. Usan un cliente LLM falso.
- Eval de retrieval con embeddings reales: aprueba el 91,7 % con k=3.
- Servidor MCP por stdio probado: `python -m app.mcp_server`.
- Probado con un modelo real y local (`qwen3:8b` en Ollama): el chat llama `rag_search`, cita y responde 17 días. El eval de agente aprueba 2 de 6. Detalle en `docs/evidencias/README.md`.

## Pendiente (en orden)
1. **Subir a GitHub como repo privado.** El clasificador de permisos bloqueó la subida; la tiene que correr el usuario:
   `gh repo create JuanSGarciaC/cortex-agent --private --source . --push`
2. **Probar con la API real de Claude.** Sigue sin hacerse: Ollama no valida los parámetros propios de Anthropic.
   - Poner `ANTHROPIC_API_KEY=sk-ant-...` en `backend/.env` y quitar las líneas de Ollama.
   - Prueba: «¿Cuántos días de vacaciones tengo si llevo 7 años?». Debe llamar `rag_search`, citar `[chunk_id]` y responder 17 días.
   - Si `harness.py` da 400, quitar primero `fallbacks` y `betas`.
   - Después correr `python -m app.evals agente_rag.json`.
3. **Corregir el juez.** Baja la fidelidad a 1 en preguntas que no necesitan documentos (caso a06).
4. Opcional: autenticación si se expone fuera de localhost; mitigar que un documento con instrucciones haga que el agente llame `memory_save`.

## Cómo levantar
`run.bat` en la raíz, o por separado:
- Backend: `cd backend && .venv\Scripts\python -m uvicorn app.main:app --reload` (puerto 8000)
- Frontend: `cd frontend && npm run dev` (puerto 5173; `/api` va por proxy al 8000)
- Datos de ejemplo: `cd backend && .venv\Scripts\python seed.py`
- Con Ollama: el servidor debe estar corriendo (`ollama serve` o la app de bandeja); ver README.

## Decisiones y aprendizajes
- Modelos por defecto: agente `claude-opus-5-5` con effort `medium`; juez y extracción de memoria con `claude-haiku-5-5`. Se cambian por variables de entorno (ver README). El `backend/.env` local apunta a Ollama.
- El endpoint de Ollama ignora `output_format`, así que el juez y la memoria también envían el JSON Schema en el prompt (`llm.json_instruction`).
- Versiones instaladas: `mcp` 2.3 (`MCPServer` y `Client`; FastMCP ya no existe) y `anthropic` 2.5.
- Swarm Cursor (WebGL) se ve en blanco bajo `React.StrictMode`; por eso `main.tsx` no lo usa.
- La búsqueda vectorial es por fuerza bruta en numpy y el mapa usa PCA en lugar de UMAP. Los límites están anotados con comentarios `shortcut:`.
