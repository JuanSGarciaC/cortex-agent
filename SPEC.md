# Cortex Agent — SPEC

Una sola app que reúne un **harness de agente propio**, **MCP** (servidor y cliente), **RAG**, **memoria** y **evals**, con vistas de observabilidad muy visuales.

## Backend (Python, FastAPI, SQLite)

| Módulo | Responsabilidad |
|---|---|
| `app/harness.py` | Bucle del agente sobre la Messages API de Claude. Límite de pasos y de costo, manejo de `stop_reason`, ejecución paralela de herramientas, un evento por paso. |
| `app/mcp_server.py` | Servidor MCP propio (`MCPServer`) con `rag_search`, `rag_list_documents`, `memory_save`, `memory_recall`. También corre por stdio: `python -m app.mcp_server`. |
| `app/tools.py` | Cliente MCP: abre el servidor propio en proceso y los externos de `mcp_servers.json` (stdio), y expone una lista única de herramientas. |
| `app/rag.py` | Ingesta (txt, md, pdf), chunking con solape, búsqueda híbrida (FTS5 BM25 + coseno) fusionada con RRF, proyección 2D (PCA) para el mapa. |
| `app/memory.py` | Hechos de largo plazo con embedding; extracción automática al final de cada turno con un modelo pequeño y salida estructurada. |
| `app/evals.py` | Datasets JSON, métricas de retrieval (recall@k, MRR), métricas del agente (herramienta esperada, pasos, costo, latencia) y juez LLM (fidelidad y relevancia, 1–5). |
| `app/db.py` | Esquema SQLite y conexión. |

### Eventos de traza (tabla `events`, también por SSE)
`run_start`, `memory_recall`, `llm_call`, `thinking`, `tool_call`, `tool_result`, `fallback`, `answer`, `memory_write`, `error`, `run_end`.

### API
- `POST /api/chat` → stream SSE de eventos. Body: `{conversation_id?, message}`.
- `GET /api/conversations`, `GET /api/conversations/{id}`
- `GET /api/runs`, `GET /api/runs/{id}/events`
- `POST /api/documents` (multipart), `GET /api/documents`, `DELETE /api/documents/{id}`
- `GET /api/rag/map?q=` → puntos 2D de chunks + consulta + vecinos
- `GET /api/memories`, `DELETE /api/memories/{id}`, `GET /api/memories/graph`
- `GET /api/tools` → catálogo MCP
- `GET /api/evals/datasets`, `POST /api/evals/run`, `GET /api/evals/runs`, `GET /api/evals/runs/{id}`
- `GET /api/health`

## Frontend (React, Vite, TypeScript)
Tema oscuro, íconos `lucide-react`, sin emojis.
- **Inicio**: hero con Swarm Cursor (React Bits).
- **Chat**: conversación más un panel de traza en vivo.
- **Trazas**: grafo animado del bucle por run.
- **Mapa RAG**: nube 2D de chunks; la consulta se ilumina junto a sus vecinos.
- **Memoria**: grafo de fuerzas (canvas) de hechos agrupados por tipo.
- **Evals**: mapa de calor de casos × corridas y KPIs.
- **Herramientas**: catálogo en grilla con filtros laterales y conteos.

## Modelos
`AGENT_MODEL=claude-opus-5-5` (pensamiento adaptativo, effort `medium`, fallbacks del servidor). `SMALL_MODEL=claude-haiku-5-5` para el juez y la extracción de memoria.
