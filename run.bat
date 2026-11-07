@echo off
rem Levanta backend (puerto 8000) y frontend (puerto 5173) en ventanas separadas.
cd /d "%~dp0"
if not exist backend\.venv (
  python -m venv backend\.venv
  backend\.venv\Scripts\pip install -r backend\requirements.txt
)
if not exist backend\.env (
  >backend\.env echo ANTHROPIC_BASE_URL=http://localhost:8787
  >>backend\.env echo ANTHROPIC_AUTH_TOKEN=gemini-proxy
  >>backend\.env echo AGENT_MODEL=gemini-3.6-flash
  >>backend\.env echo SMALL_MODEL=gemini-3.5-flash-lite
  >>backend\.env echo GEMINI_API_KEY=
  echo Se creo backend\.env: pega tu GEMINI_API_KEY para usar el chat y los evals de agente.
)
if not exist backend\cortex.db (
  pushd backend
  .venv\Scripts\python seed.py
  popd
)
if not exist frontend\node_modules (
  pushd frontend
  call npm install
  popd
)
findstr /b /c:"ANTHROPIC_BASE_URL=http://localhost:8787" backend\.env >nul && start "Cortex Gemini" cmd /k "cd /d backend && .venv\Scripts\python -m uvicorn app.gemini_proxy:app --host 127.0.0.1 --port 8787"
start "Cortex API" cmd /k "cd /d backend && .venv\Scripts\python -m uvicorn app.main:app --reload"
start "Cortex Web" cmd /k "cd /d frontend && npm run dev"
echo Backend: http://localhost:8000/docs
echo Frontend: http://localhost:5173
