# HANDOFF — Cortex Agent (estado al 2026-11-06)

## Objetivo
Una sola app que reúne un harness de agente propio, MCP, RAG, memoria y evals, con una UI muy visual. Ver `SPEC.md` y `README.md`.

## Qué está hecho y verificado
- Backend FastAPI + SQLite en `backend/app/`: harness, MCP (servidor y cliente), RAG, memoria, evals y API con SSE.
- Frontend React/Vite en `frontend/src/` con siete vistas.
- 21 tests en verde: `cd backend && .venv\Scripts\python -m pytest -q`. Usan un cliente LLM falso.
- Eval de retrieval con embeddings reales: aprueba el 91,7 % con k=3.
- Servidor MCP por stdio probado: `python -m app.mcp_server`.
- Repo privado en GitHub (`JuanSGarciaC/cortex-agent`), con CI en verde.
- Probado con un modelo real y local (`qwen3:4b` en Ollama): el eval de agente aprobó 5 de 6 y 6 de 6, y el chat responde en 28 a 177 s. Detalle en `docs/evidencias/README.md`.
- Probado una vez con Gemini en la nube, mediante un traductor temporal ya eliminado: eval de agente 5 de 6 y chat de 8,6 s con la respuesta correcta. Detalle en `docs/evidencias/README.md`.
- Probado con Gemini mediante `backend/app/gemini_proxy.py`, ahora en el repo: eval de agente 6 de 6 y chat en el navegador con 17 días y cita. El agente y el juez usan modelos distintos para repartir la cuota gratuita.
- Repo público desde el 2026-11-06.

## Pendiente
Nada obligatorio. Opcional: autenticación si se expone fuera de localhost; mitigar que un documento con instrucciones haga que el agente llame `memory_save`.

**Decisión:** no se probará con la API de Claude, porque el plan Pro no incluye API y requeriría comprar créditos. Los parámetros propios de Claude en `harness.py` (`betas`, `fallbacks`, `thinking`, `cache_control`, `effort`) siguen sin validar, y si algún día se usa Claude, una respuesta 400 apuntaría primero a `fallbacks` y `betas`.

## Cómo levantar
`run.bat` en la raíz, o por separado:
- Backend: `cd backend && .venv\Scripts\python -m uvicorn app.main:app --reload` (puerto 8000)
- Frontend: `cd frontend && npm run dev` (puerto 5173; `/api` va por proxy al 8000)
- Datos de ejemplo: `cd backend && .venv\Scripts\python seed.py`
- Con Ollama: el servidor debe estar corriendo (`ollama serve` o la app de bandeja); ver README.
- Con Gemini: el traductor debe estar corriendo en el puerto 8787; ver README.

## Decisiones y aprendizajes
- Modelos en uso: agente `gemini-3.6-flash`; juez y extracción de memoria con `gemini-3.5-flash-lite`, por el traductor. Se cambian en `backend/.env`. Los valores por defecto del código son modelos de Claude, sin probar.
- El endpoint de Ollama ignora `output_format`, así que el juez y la memoria también envían el JSON Schema en el prompt (`llm.structured`).
- Versiones instaladas: `mcp` 2.3 (`MCPServer` y `Client`; FastMCP ya no existe) y `anthropic` 2.5.
- Swarm Cursor (WebGL) se ve en blanco bajo `React.StrictMode`; por eso `main.tsx` no lo usa.
- La búsqueda vectorial es por fuerza bruta en numpy y el mapa usa PCA en lugar de UMAP. Los límites están anotados con comentarios `shortcut:`.
- Con `qwen3:4b`, `thinking: disabled` no funciona: el modelo razona igual y lo mezcla con la respuesta. Por eso sigue activo.
- En el chat, la memoria se extrae en segundo plano después de `run_end`. El evento `memory_write` aparece en Trazas, no en la traza en vivo.
- `qwen3:4b` llegó a responder 20 días en lugar de 17 en el chat: sirve para demostrar la app sin internet, pero para responder con fiabilidad se usa Gemini.
