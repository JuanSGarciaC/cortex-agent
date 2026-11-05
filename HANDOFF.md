# HANDOFF — Cortex Agent (estado al 2026-11-04)

## Objetivo
Una sola app que reúne un harness de agente propio, MCP, RAG, memoria y evals, con una UI muy visual. Ver `SPEC.md` y `README.md`.

## Qué está hecho y verificado
- Backend FastAPI + SQLite en `backend/app/`: harness, MCP (servidor y cliente), RAG, memoria, evals y API con SSE.
- Frontend React/Vite en `frontend/src/` con siete vistas. Compila sin errores y sin errores de consola (probado con Playwright y Edge).
- 15 tests en verde: `cd backend && .venv\Scripts\python -m pytest -q`. Usan un cliente LLM falso, sin API real.
- Eval de retrieval con embeddings reales: aprueba el 91,7 % con k=3.
- Servidor MCP por stdio probado: `python -m app.mcp_server`.
- Commit local `a95b29f` en la rama `main`.

## Pendiente (en orden)
1. **Probar con la API real de Claude.** Nunca se llamó a la API: no había `ANTHROPIC_API_KEY`.
   - Poner la key en `backend/.env` (`ANTHROPIC_API_KEY=sk-ant-...`) y reiniciar el backend.
   - Prueba: en el chat, preguntar «¿Cuántos días de vacaciones tengo si llevo 7 años?». Debe llamar `rag_search`, citar `[chunk_id]` y responder 17 días.
   - Puntos de riesgo para revisar si falla:
     - `harness.py`: la llamada `client.beta.messages.create(...)` envía `betas=["server-side-fallback-2026-07-01"]`, `fallbacks="default"`, `cache_control` en el nivel superior, `thinking={"type":"adaptive","display":"summarized"}` y `output_config={"effort": ...}`. Si da 400, quitar primero fallbacks y betas.
     - Reenvío del historial: los bloques del modelo se guardan con `block.to_dict()` y se reenvían tal cual. Si la API rechaza algún campo en el segundo turno o en el segundo paso, revisar `_block_dict`.
     - `memory.extract` y `evals.judge` usan `client.messages.parse(..., output_format=PydanticModel)` con `claude-haiku-5-5`.
   - Después correr `python -m app.evals agente_rag.json` y revisar el mapa de calor en /evals.
   - Tomar las capturas de Chat y Trazas para el README; ahora faltan porque sin key solo hay runs con error.
2. **Subir a GitHub como repo privado.** El clasificador de permisos bloqueó la subida; la tiene que autorizar el usuario:
   `gh repo create JuanSGarciaC/cortex-agent --private --source . --push`
3. Opcional: autenticación si se expone fuera de localhost; mitigar que un documento con instrucciones haga que el agente llame `memory_save`.

## Cómo levantar
`run.bat` en la raíz, o por separado:
- Backend: `cd backend && .venv\Scripts\python -m uvicorn app.main:app --reload` (puerto 8000)
- Frontend: `cd frontend && npm run dev` (puerto 5173; `/api` va por proxy al 8000)
- Datos de ejemplo: `cd backend && .venv\Scripts\python seed.py`

## Decisiones y aprendizajes
- Modelos: agente `claude-opus-5-5` con effort `medium`; juez y extracción de memoria con `claude-haiku-5-5`. Se cambian por variables de entorno (ver README).
- Versiones instaladas: `mcp` 2.3 (`MCPServer` y `Client`; FastMCP ya no existe) y `anthropic` 2.5.
- Swarm Cursor (WebGL) se ve en blanco bajo `React.StrictMode`; por eso `main.tsx` no lo usa.
- La búsqueda vectorial es por fuerza bruta en numpy y el mapa usa PCA en lugar de UMAP. Los límites están anotados con comentarios `shortcut:`.
