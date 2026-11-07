from fastapi.testclient import TestClient

from app.gemini_proxy import app, from_gemini, to_gemini


def test_requires_auth_header_and_key(monkeypatch):
    client = TestClient(app)
    body = {"model": "m", "messages": []}
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    assert client.post("/v1/messages", json=body).status_code == 401  # a web page cannot spend the key
    monkeypatch.delenv("GEMINI_API_KEY")
    missing = client.post("/v1/messages", json=body, headers={"x-api-key": "local"})
    assert missing.status_code == 401 and "GEMINI_API_KEY" in missing.text


def test_tool_round_trip_keeps_signature_and_name():
    reply = from_gemini(
        {
            "candidates": [
                {
                    "finishReason": "STOP",
                    "content": {
                        "parts": [
                            {"text": "razonando", "thought": True},
                            {"functionCall": {"name": "rag_search", "args": {"query": "x"}}, "thoughtSignature": "abc=="},
                        ]
                    },
                }
            ],
            "usageMetadata": {"promptTokenCount": 7, "candidatesTokenCount": 3},
        },
        "gemini-x",
    )
    assert reply["stop_reason"] == "tool_use"
    assert reply["usage"] == {"input_tokens": 7, "output_tokens": 3}
    assert [b["type"] for b in reply["content"]] == ["tool_use"]
    call = reply["content"][0]

    request = to_gemini(
        {
            "max_tokens": 100,
            "system": "sé breve",
            "tools": [{"name": "rag_search", "description": "busca", "input_schema": {"type": "object"}}],
            "messages": [
                {"role": "user", "content": "hola"},
                {"role": "assistant", "content": [{"type": "thinking", "thinking": "", "signature": "s"}, call]},
                {"role": "user", "content": [{"type": "tool_result", "tool_use_id": call["id"], "content": "dato", "is_error": False}]},
            ],
        }
    )
    assert request["systemInstruction"]["parts"][0]["text"] == "sé breve"
    assert request["tools"][0]["functionDeclarations"][0]["parametersJsonSchema"] == {"type": "object"}
    user, model, result = request["contents"]
    assert user == {"role": "user", "parts": [{"text": "hola"}]}
    assert model["role"] == "model"
    assert model["parts"] == [{"functionCall": {"name": "rag_search", "args": {"query": "x"}}, "thoughtSignature": "abc=="}]
    assert result["parts"][0]["functionResponse"] == {"name": "rag_search", "response": {"result": "dato"}}


def test_stop_reasons_and_json_mode():
    empty = from_gemini({"promptFeedback": {"blockReason": "SAFETY"}}, "m")
    assert empty["stop_reason"] == "refusal" and empty["content"] == []
    cut = from_gemini({"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": "a"}]}}]}, "m")
    assert cut["stop_reason"] == "max_tokens"
    request = to_gemini({"messages": [{"role": "user", "content": "x"}], "output_config": {"format": {"type": "json_schema"}}})
    assert request["generationConfig"]["responseMimeType"] == "application/json"
