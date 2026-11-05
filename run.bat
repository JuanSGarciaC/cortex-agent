@echo off
rem Levanta backend (puerto 8000) y frontend (puerto 5173) en ventanas separadas.
cd /d "%~dp0"
if not exist backend\.venv (
  python -m venv backend\.venv
  backend\.venv\Scripts\pip install -r backend\requirements.txt
)
if not exist backend\.env (
  echo ANTHROPIC_API_KEY=> backend\.env
  echo Se creo backend\.env: agrega tu ANTHROPIC_API_KEY para usar el chat y los evals de agente.
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
start "Cortex API" cmd /k "cd /d backend && .venv\Scripts\python -m uvicorn app.main:app --reload"
start "Cortex Web" cmd /k "cd /d frontend && npm run dev"
echo Backend: http://localhost:8000/docs
echo Frontend: http://localhost:5173
