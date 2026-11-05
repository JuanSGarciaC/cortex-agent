"""Local embeddings with fastembed (no extra API). Tests swap `set_embedder` for a fake."""
import threading

import numpy as np

from . import config

_lock = threading.Lock()
_model = None
_custom = None


def set_embedder(fn) -> None:
    """fn(list[str]) -> np.ndarray (n, d). Used by tests and evals."""
    global _custom
    _custom = fn


def embed(texts: list[str]) -> np.ndarray:
    if not texts:
        return np.zeros((0, 1), dtype=np.float32)
    if _custom is not None:
        vecs = np.asarray(_custom(texts), dtype=np.float32)
    else:
        global _model
        with _lock:
            if _model is None:
                from fastembed import TextEmbedding

                _model = TextEmbedding(config.EMBED_MODEL)
            vecs = np.asarray(list(_model.embed(texts)), dtype=np.float32)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    return vecs / np.maximum(norms, 1e-9)


def to_blob(vec: np.ndarray) -> bytes:
    return np.asarray(vec, dtype=np.float32).tobytes()


def from_blob(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)
