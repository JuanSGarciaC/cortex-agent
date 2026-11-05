import hashlib
import re

import numpy as np
import pytest

from app import config, db, embed, llm

DIM = 256


def fake_embed(texts):
    """Bag-of-words hashed into DIM buckets: deterministic and lexical, no model download."""
    out = np.zeros((len(texts), DIM), dtype=np.float32)
    for i, text in enumerate(texts):
        for tok in re.findall(r"\w+", text.lower()):
            if len(tok) > 2:
                out[i, int(hashlib.md5(tok.encode()).hexdigest(), 16) % DIM] += 1
    return out


class Block:
    def __init__(self, **data):
        self.__dict__.update(data)
        self._data = data

    def to_dict(self):
        return dict(self._data)


class Usage:
    def __init__(self, i=100, o=50):
        self.input_tokens, self.output_tokens, self.cache_read_input_tokens = i, o, 0


class Response:
    def __init__(self, blocks, stop_reason, model="claude-opus-5-5"):
        self.content = [Block(**b) for b in blocks]
        self.stop_reason = stop_reason
        self.usage = Usage()
        self.model = model


class Parsed:
    def __init__(self, value):
        self.parsed_output = value


class FakeClient:
    """Scripted stand-in for AsyncAnthropic: `script` is a list of Response or callables(kwargs)->Response."""

    def __init__(self, script=None, facts=None, verdict=None):
        self.script = list(script or [])
        self.calls = []
        self.facts = facts or []
        self.verdict = verdict
        client = self

        class _BetaMessages:
            async def create(self, **kwargs):
                client.calls.append(kwargs)
                item = client.script.pop(0) if client.script else Response([{"type": "text", "text": "fin"}], "end_turn")
                return item(kwargs) if callable(item) else item

        class _Beta:
            messages = _BetaMessages()

        class _Messages:
            async def parse(self, **kwargs):
                fmt = kwargs["output_format"]
                if fmt.__name__ == "Facts":
                    return Parsed(fmt(facts=client.facts))
                return Parsed(client.verdict or fmt(faithfulness=5, relevance=5, reason="ok"))

        self.beta = _Beta()
        self.messages = _Messages()


def tool_use(name, input_, id_="tu_1"):
    return Response([{"type": "thinking", "thinking": "Busco en los documentos.", "signature": "sig"},
                     {"type": "tool_use", "id": id_, "name": name, "input": input_}], "tool_use")


def final(text):
    return Response([{"type": "text", "text": text}], "end_turn")


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(config, "MCP_SERVERS_FILE", tmp_path / "none.json")
    embed.set_embedder(fake_embed)
    db.init()
    yield
    llm.set_client(None)


@pytest.fixture
def seeded():
    from pathlib import Path

    from app import rag

    for path in sorted((Path(__file__).parent.parent / "docs_seed").glob("*.md")):
        rag.ingest(path.stem, path.read_text(encoding="utf-8"), path.name)
