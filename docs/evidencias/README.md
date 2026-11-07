# Evidencias de prueba

## Prueba con Gemini y traductor en el repo (2026-11-06)

Base de datos temporal recién cargada con `seed.py`, a través de `backend/app/gemini_proxy.py`. Agente con `gemini-3.6-flash`; juez y memoria con `gemini-3.5-flash-lite`.

**No valida Claude.** El traductor descarta `betas`, `fallbacks`, `thinking`, `cache_control` y `effort`. El costo aparece en $0 porque esos modelos no están en la tabla de precios.

| Prueba | Resultado |
|---|---|
| Eval de agente + juez | **6 de 6**, recall 1,00, fidelidad y relevancia 5/5 |
| Herramienta correcta | 6 de 6 |
| Tiempo medio por caso | 7,9 s (1 a 4 pasos) |
| Chat por `POST /api/chat` | 17 días con cita `[7]`, 2 pasos, 8,6 s |
| Chat en el navegador | 17 días con cita `[7]`, 2 pasos, 13,8 s, sin errores en la consola |

Hubo un 429 durante el eval, que el reintento del SDK resolvió. Es una sola corrida en la capa gratuita.

Archivos: `eval-agente-gemini-2.txt` (sin las líneas de log HTTP), `gemini-evals-2.png` y todas las capturas de `../img/`.

---

## Primera prueba con Gemini (2026-11-05)

Corrida única con la capa gratuita de Gemini, sobre una base de datos limpia. Se usó un traductor temporal fuera del repo, reemplazado después por `backend/app/gemini_proxy.py`.

**No valida Claude.** El traductor descarta `betas`, `fallbacks`, `thinking`, `cache_control` y `effort`, así que esa parte de `harness.py` sigue sin probarse contra la API de Claude. El costo aparece en $0 porque esos modelos no están en la tabla de precios.

| Prueba | Modelo | Resultado |
|---|---|---|
| Eval de agente + juez | `gemini-3.6-flash` | **5 de 6**, recall 1,00, fidelidad y relevancia 5/5 |
| Herramienta correcta | `gemini-3.6-flash` | 6 de 6 |
| Chat por la interfaz | `gemini-3.5-flash-lite` | 17 días con cita, 2 pasos, **8,6 s** |

- **a06:** el agente respondió, pero el juez no lo calificó: se agotó la cuota gratuita de 20 peticiones diarias de ese modelo. No es un fallo del agente.
- **Chat con otro modelo:** esa misma cuota cortó una primera pregunta con `gemini-3.6-flash`. La pregunta se repitió una vez con `gemini-3.5-flash-lite`.
- **Latencia del eval:** los 43,4 s de media incluyen las esperas del traductor (mínimo 7,5 s entre peticiones) y los reintentos por cuota. Los tres primeros casos, antes de agotar la cuota, terminaron en 10 a 16 s con esas esperas incluidas.
- **Intentos descartados:** antes hubo dos corridas sin ningún resultado del modelo: `gemini-2.5-flash` ya no está disponible para cuentas nuevas y `gemini-3.8-flash` estaba saturado.

Archivos: `eval-agente-gemini.txt`, `latencia-chat-gemini.txt`, `gemini-evals.png`.

---

## Prueba con modelo local (2026-11-05)

Modelo: `qwen3:4b` local con Ollama 0.40.14, sobre el endpoint compatible con Anthropic, en una GPU AMD RX 5700. **No es una prueba contra Claude.** Con este backend, los parámetros `betas`, `fallbacks` y `cache_control` no quedan validados, y el costo aparece en $0.

## Antes y después

| Métrica | Antes (`qwen3:8b`) | Después (`qwen3:4b`) |
|---|---|---|
| Velocidad del modelo, prueba corta | 3,9 tok/s | 84,5 tok/s (entre 20 y 50 en runs reales) |
| Eval de agente, tiempo medio por caso | 125 s | 34 a 41 s |
| Eval de agente, aprobados | 2 de 6 | 5 de 6 y 6 de 6, en dos corridas |
| Uso de la herramienta correcta | 60 % | 100 % en las dos corridas |
| Chat, hasta la respuesta | 381 s | 28 a 177 s, muy variable |
| Bloqueo del chat por extraer memoria | 209 s | 0 s (corre en segundo plano) |
| JavaScript inicial | 566 KB | 190 KB |
| Scroll horizontal en móvil | 10 px | 0 px |
| Tests (LLM falso) | 15 | 19 |

La API no era el cuello de botella: sus endpoints responden en 10 ms o menos. El tiempo se va en el modelo.

## Por qué sigue habiendo respuestas lentas

`qwen3:4b` razona mucho antes de responder y a veces se enreda: una respuesta llegó a 4.341 tokens (177 s). Además, la memoria del turno anterior comparte la GPU, así que una pregunta inmediata puede esperar.

## Lo que se probó y se descartó

| Opción | Resultado |
|---|---|
| Apagar el razonamiento de `qwen3:4b` | No ahorra tokens y mezcla el razonamiento en inglés con la respuesta |
| Quitar `output_config.effort` | Sin efecto |
| `qwen2.5:3b` | Rápido, pero aprueba 0 a 17 %: no busca en los documentos y dice que 17 × 23 = 85,5 |

## Archivos

- `tests.txt`, `eval-retrieval.txt`
- `eval-agente.txt`: corrida inicial con `qwen3:8b`
- `eval-agente-qwen3-4b-1.txt` y `-2.txt`: corridas finales
- `latencia-chat.txt`: última medición por la interfaz, con preguntas seguidas
- `evals-agente.png`

## Fallo de calidad detectado

En la última medición por la interfaz, el chat respondió 20 días a la pregunta de vacaciones, cuando lo correcto es 17, y no citó el fragmento. Encontró el documento correcto, pero tomó el tope de la política como resultado. El 6 de 6 del eval no garantiza respuestas correctas siempre: `qwen3:4b` sirve para demostrar la app, no como modelo fiable.
