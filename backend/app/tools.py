"""MCP client hub: Cortex's own server in-process plus external stdio servers from mcp_servers.json.
The harness only ever talks MCP, so local and third-party tools look the same."""
import json
import re
from contextlib import AsyncExitStack

from mcp import Client, StdioServerParameters

from . import config
from .mcp_server import server as own_server

OWN = "cortex"
_SAFE = re.compile(r"[^a-zA-Z0-9_-]")


def load_external_config() -> dict:
    """{"name": {"command": "...", "args": [...], "env": {...}}}"""
    if not config.MCP_SERVERS_FILE.exists():
        return {}
    data = json.loads(config.MCP_SERVERS_FILE.read_text(encoding="utf-8"))
    return data.get("servers", data)


class ToolHub:
    def __init__(self, include_external: bool = True):
        self.include_external = include_external
        self.clients: dict[str, Client] = {}
        self.routes: dict[str, tuple[str, str]] = {}  # api name -> (server, mcp tool name)
        self.catalog: list[dict] = []
        self.errors: dict[str, str] = {}
        self._stack = AsyncExitStack()

    async def __aenter__(self):
        await self._connect(OWN, own_server)
        if self.include_external:
            try:
                servers = load_external_config().items()
            except Exception as exc:  # a broken config file must not take the agent down either
                self.errors[config.MCP_SERVERS_FILE.name] = f"{type(exc).__name__}: {exc}"
                servers = []
            for name, spec in servers:
                try:
                    params = StdioServerParameters(
                        command=spec["command"], args=spec.get("args", []), env=spec.get("env")
                    )
                    await self._connect(_SAFE.sub("_", name), params)
                except Exception as exc:  # one broken server must not take the agent down
                    self.errors[name] = f"{type(exc).__name__}: {exc}"
        return self

    async def __aexit__(self, *exc):
        await self._stack.aclose()

    async def _connect(self, name: str, target) -> None:
        client = await self._stack.enter_async_context(Client(target))
        self.clients[name] = client
        listed = await client.list_tools()
        for tool in listed.tools:
            api_name = tool.name if name == OWN else f"{name}__{tool.name}"
            api_name = _SAFE.sub("_", api_name)[:64]
            self.routes[api_name] = (name, tool.name)
            self.catalog.append(
                {
                    "name": api_name,
                    "server": name,
                    "source": "propio" if name == OWN else "externo",
                    "description": " ".join((tool.description or "").split()),
                    "input_schema": tool.input_schema,
                }
            )

    def anthropic_tools(self) -> list[dict]:
        return [
            {"name": t["name"], "description": t["description"], "input_schema": t["input_schema"]}
            for t in self.catalog
        ]

    async def call(self, api_name: str, arguments: dict) -> tuple[str, bool]:
        if api_name not in self.routes:
            return f"Herramienta desconocida: {api_name}", True
        server, tool = self.routes[api_name]
        try:
            result = await self.clients[server].call_tool(tool, arguments or {})
        except Exception as exc:
            return f"Fallo al llamar {api_name}: {type(exc).__name__}: {exc}", True
        parts = []
        for item in result.content:
            parts.append(getattr(item, "text", None) or f"[{getattr(item, 'type', 'contenido')}]")
        return "\n".join(parts) or "(sin salida)", bool(result.is_error)
