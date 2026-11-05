# Evidencias de prueba (2026-11-05)

Modelo: `qwen3:8b` local con Ollama 0.40.14, sobre el endpoint compatible con Anthropic, en CPU. **No es una prueba contra Claude.** Con este backend, los parámetros `betas`, `fallbacks` y `cache_control` no quedan validados, y el costo aparece en $0.

| Prueba | Resultado | Archivo |
|---|---|---|
| Tests (LLM falso) | 15 de 15 | `tests.txt` |
| Eval de retrieval, k=3 | 11 de 12 (91,7 %) | `eval-retrieval.txt` |
| Eval de agente + juez | **2 de 6 (33,3 %)** | `eval-agente.txt`, `evals-agente.png` |
| Chat por la interfaz | `rag_search`, cita `[chunk_id:7]`, 17 días; 381 s | `../img/chat.png`, `../img/trazas.png` |

## Por qué falló cada caso del agente

| Caso | Causa | Origen |
|---|---|---|
| a02 | El juez devolvió JSON con un carácter de más y no se pudo leer. La respuesta del agente no quedó guardada. | Modelo local sin salida estructurada |
| a04 | No usó `rag_search` y dijo no tener información. | Modelo |
| a05 | Dijo que no hay documentos sobre el tema, sin buscar. | Modelo |
| a06 | Respondió bien (391), pero el juez bajó la fidelidad a 1 porque no hay fragmentos. | Diseño del juez: no contempla preguntas sin documentos |

## Uso de herramientas

Con la petición completa del harness, antes de ajustar el prompt, el modelo llamó una herramienta en 2 de 4 intentos. Sin `betas`, `fallbacks` ni `cache_control` fueron 3 de 4. Son pocas muestras para atribuir la diferencia a esos parámetros.
