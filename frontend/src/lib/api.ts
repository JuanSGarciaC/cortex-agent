export type TraceEvent = { run_id: number; seq: number; type: string; data: Record<string, any>; ts: number };
export type Run = {
  id: number; conv_id: number; status: string; model: string; question: string; steps: number;
  input_tokens: number; output_tokens: number; cost_usd: number; started_at: number; ended_at: number | null; source: string;
};
export type Doc = { id: number; title: string; source: string; chars: number; chunks: number; created_at: number };
export type Hit = { chunk_id: number; doc_id: number; title: string; text: string; score: number; similarity: number; vector_rank: number | null; bm25_rank: number | null };
export type MapPoint = { id: number; doc_id: number; title: string; x: number; y: number; preview: string };
export type Memory = { id: number; content: string; kind: string; run_id: number | null; created_at: number };
export type Tool = { name: string; server: string; source: string; description: string; input_schema: any; calls: number; errors: number };
export type EvalRun = { id: number; dataset: string; kind: string; created_at: number; summary: Record<string, number>; results: { case_id: string; passed: boolean; scores: Record<string, any>; output: string }[] };
export type Dataset = { file: string; name: string; kind: string; cases: number };
export type Stats = { documents: number; chunks: number; memories: number; runs: number; tool_calls: number; cost_usd: number; eval_runs: number };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const body = await res.json();
      msg = typeof body.detail === 'string' ? body.detail : msg;
    } catch { /* no json body */ }
    throw new Error(msg);
  }
  return res.json();
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  health: () => req<{ ok: boolean; llm: boolean; agent_model: string; small_model: string }>('/api/health'),
  stats: () => req<Stats>('/api/stats'),
  conversations: () => req<{ id: number; title: string; created_at: number }[]>('/api/conversations'),
  conversation: (id: number) => req<{ id: number; title: string; turns: { run_id: number; question: string; answer: string; status: string }[] }>(`/api/conversations/${id}`),
  deleteConversation: (id: number) => req(`/api/conversations/${id}`, { method: 'DELETE' }),
  runs: () => req<Run[]>('/api/runs'),
  runEvents: (id: number) => req<{ run: Run; events: TraceEvent[] }>(`/api/runs/${id}/events`),
  documents: () => req<Doc[]>('/api/documents'),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{ id: number; title: string; chunks: number }>('/api/documents', { method: 'POST', body: fd });
  },
  deleteDocument: (id: number) => req(`/api/documents/${id}`, { method: 'DELETE' }),
  search: (q: string, k = 5) => req<Hit[]>(`/api/rag/search?q=${encodeURIComponent(q)}&k=${k}`),
  map: (q?: string, k = 5) => req<{ points: MapPoint[]; query: { x: number; y: number; text: string } | null; neighbors: number[] }>(`/api/rag/map?k=${k}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  memories: () => req<Memory[]>('/api/memories'),
  addMemory: (content: string, kind: string) => req<Memory & { duplicate: boolean }>('/api/memories', json({ content, kind })),
  deleteMemory: (id: number) => req(`/api/memories/${id}`, { method: 'DELETE' }),
  memoryGraph: () => req<{ nodes: Memory[]; edges: { source: number; target: number; weight: number }[] }>('/api/memories/graph'),
  tools: () => req<{ tools: Tool[]; errors: Record<string, string> }>('/api/tools'),
  datasets: () => req<Dataset[]>('/api/evals/datasets'),
  evalRuns: (dataset?: string) => req<EvalRun[]>(`/api/evals/runs${dataset ? `?dataset=${encodeURIComponent(dataset)}` : ''}`),
  runEval: (dataset: string, k = 3) => req<EvalRun>('/api/evals/run', json({ dataset, k })),
};

/** POST /api/chat and call onEvent for every SSE event until the run ends. */
export async function streamChat(message: string, conversationId: number | null, onEvent: (e: TraceEvent) => void, signal?: AbortSignal) {
  const res = await fetch('/api/chat', { ...json({ message, conversation_id: conversationId }), signal });
  if (!res.ok || !res.body) {
    let msg = `Error ${res.status}`;
    try { msg = (await res.json()).detail ?? msg; } catch { /* ignore */ }
    throw new Error(typeof msg === 'string' ? msg : `Error ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith('data: ')) onEvent(JSON.parse(chunk.slice(6)));
    }
  }
}

export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
export const fmtUsd = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
export const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });

const PALETTE = ['#c8ff3d', '#5ee6ff', '#b18cff', '#ff8f5e', '#ff5ea8', '#5effb1', '#ffd45e', '#8fa8ff'];
export const colorFor = (id: number) => PALETTE[Math.abs(id) % PALETTE.length];
export const KIND_COLORS: Record<string, string> = { preferencia: '#c8ff3d', hecho: '#5ee6ff', objetivo: '#ff8f5e', contexto: '#b18cff' };
