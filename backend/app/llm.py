"""Single place that owns the Anthropic client. Tests inject a fake with `set_client`."""
import json

import anthropic
import pydantic

from . import config

_client = None


class LLMUnavailable(RuntimeError):
    pass


def set_client(client) -> None:
    global _client
    _client = client


def client():
    global _client
    if _client is None:
        if not config.has_llm_credentials():
            raise LLMUnavailable(
                "Falta configurar el modelo en backend/.env. Revisa «Cómo correrlo» en el README y reinicia el backend."
            )
        _client = anthropic.AsyncAnthropic()
    return _client


async def structured(schema, prompt: str, max_tokens: int = 2000):
    """Small-model call returning a `schema` instance, or None if two attempts yield nothing usable."""
    # Ollama's Anthropic endpoint ignores output_format, so the prompt also carries the schema.
    instruction = (
        "\n\nResponde únicamente con un objeto JSON con los valores, sin Markdown y sin repetir el esquema. JSON Schema:\n"
        + json.dumps(schema.model_json_schema(), ensure_ascii=False)
    )
    for _ in range(2):  # small local models sometimes emit broken JSON or none at all; a second sample usually fixes it
        try:
            response = await client().messages.parse(
                model=config.SMALL_MODEL,
                max_tokens=max_tokens,
                output_config={"effort": "low"},
                messages=[{"role": "user", "content": prompt + instruction}],
                output_format=schema,
            )
            if response.parsed_output is not None:
                return response.parsed_output
        except pydantic.ValidationError as exc:
            recovered = _first_json_object(schema, str(exc.errors()[0].get("input", "")))
            if recovered is not None:
                return recovered
    return None


def _first_json_object(schema, text: str):
    """Without native structured output, a model can surround valid JSON with stray text or repeat it."""
    start = text.find("{")
    if start < 0:
        return None
    try:
        return schema.model_validate(json.JSONDecoder().raw_decode(text, start)[0])
    except ValueError:  # JSONDecodeError and pydantic.ValidationError
        return None


def describe_error(exc: Exception) -> str:
    """Human message for the UI, keeping retryable and non-retryable cases apart."""
    if isinstance(exc, LLMUnavailable):
        return str(exc)
    if isinstance(exc, anthropic.AuthenticationError):
        return "La API key del modelo no es válida. Revisa backend/.env."
    if isinstance(exc, anthropic.RateLimitError):
        return "Límite de solicitudes de la API alcanzado. Intenta en unos segundos."
    if isinstance(exc, anthropic.BadRequestError):
        return f"Solicitud rechazada por la API: {exc.message}"
    if isinstance(exc, anthropic.APIStatusError):
        return f"Error de la API ({exc.status_code}): {exc.message}"
    if isinstance(exc, anthropic.APIConnectionError):
        return "No hay conexión con el modelo. Revisa que el traductor u Ollama estén corriendo."
    return f"{type(exc).__name__}: {exc}"
