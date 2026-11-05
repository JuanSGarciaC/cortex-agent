"""Single place that owns the Anthropic client. Tests inject a fake with `set_client`."""
import anthropic

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
                "Falta ANTHROPIC_API_KEY. Agrégala en backend/.env y reinicia el backend."
            )
        _client = anthropic.AsyncAnthropic()
    return _client


def describe_error(exc: Exception) -> str:
    """Human message for the UI, keeping retryable and non-retryable cases apart."""
    if isinstance(exc, LLMUnavailable):
        return str(exc)
    if isinstance(exc, anthropic.AuthenticationError):
        return "La API key de Anthropic no es válida."
    if isinstance(exc, anthropic.RateLimitError):
        return "Límite de solicitudes de la API alcanzado. Intenta en unos segundos."
    if isinstance(exc, anthropic.BadRequestError):
        return f"Solicitud rechazada por la API: {exc.message}"
    if isinstance(exc, anthropic.APIStatusError):
        return f"Error de la API ({exc.status_code}): {exc.message}"
    if isinstance(exc, anthropic.APIConnectionError):
        return "No hay conexión con la API de Anthropic."
    return f"{type(exc).__name__}: {exc}"
