# Evidencias de prueba (2026-11-05)

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
- `evals-agente.png`, `../img/chat.png`, `../img/trazas.png`, `../img/inicio.png`
