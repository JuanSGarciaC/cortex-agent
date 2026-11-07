import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env_file(path: Path) -> None:
    # Minimal .env loader: KEY=VALUE lines, real environment wins.
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"'))


_load_env_file(BASE_DIR / ".env")

DB_PATH = Path(os.getenv("CORTEX_DB", BASE_DIR / "cortex.db"))
AGENT_MODEL = os.getenv("AGENT_MODEL", "claude-opus-5-5")
SMALL_MODEL = os.getenv("SMALL_MODEL", "claude-haiku-5-5")
AGENT_EFFORT = os.getenv("AGENT_EFFORT", "medium")
MAX_STEPS = int(os.getenv("MAX_STEPS", "8"))
MAX_COST_USD = float(os.getenv("MAX_COST_USD", "0.50"))
EMBED_MODEL = os.getenv("EMBED_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
MCP_SERVERS_FILE = Path(os.getenv("MCP_SERVERS_FILE", BASE_DIR / "mcp_servers.json"))
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000"
).split(",")

# USD per million tokens (input, output). Unknown models cost 0 in the tracker.
PRICES = {
    "claude-opus-5-5": (4.00, 20.00),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-haiku-5-5": (0.10, 0.50),
}


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    pin, pout = PRICES.get(model, (0.0, 0.0))
    return (input_tokens * pin + output_tokens * pout) / 1_000_000


def has_llm_credentials() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))
