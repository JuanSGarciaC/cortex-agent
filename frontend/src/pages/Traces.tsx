import { useEffect, useMemo, useState } from 'react';
import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { GitBranch } from 'lucide-react';
import { EVENT_META } from '../components/Timeline';
import { api, fmtDate, fmtMs, fmtUsd, type Run, type TraceEvent } from '../lib/api';

type StepData = { title: string; sub: string; type: string; event: TraceEvent; err: boolean; selected: boolean };

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const meta = EVENT_META[data.type];
  const Icon = meta?.icon;
  return (
    <div className={`flow-node ${data.selected ? 'selected' : ''} ${data.err ? 'err' : ''}`}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="t" style={{ color: data.err ? '#ff5e6c' : undefined }}>{Icon && <Icon size={14} color={data.err ? '#ff5e6c' : meta.color} />} {data.title}</div>
      <div className="s">{data.sub}</div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
const nodeTypes = { step: StepNode };

/** Lay events out as columns: one column per step, parallel tool calls stacked inside it. */
function buildGraph(events: TraceEvent[], selected: number | null) {
  const nodes: Node<StepData>[] = [];
  const edges: Edge[] = [];
  let col = 0;
  let prev: string[] = [];
  const results = new Map(events.filter((e) => e.type === 'tool_result').map((e) => [e.data.id, e]));
  const add = (group: TraceEvent[]) => {
    const ids = group.map((e) => `n${e.seq}`);
    group.forEach((e, i) => {
      const res = e.type === 'tool_call' ? results.get(e.data.id) : undefined;
      const d = e.data;
      const sub =
        e.type === 'llm_call' ? `${d.input_tokens}→${d.output_tokens} tok · ${fmtMs(d.ms)}`
          : e.type === 'tool_call' ? `${res ? fmtMs(res.data.ms) : '...'}${res?.data.is_error ? ' · error' : ''}`
          : e.type === 'memory_recall' ? `${d.items.length} hechos`
          : e.type === 'run_end' ? `${d.status} · ${fmtUsd(d.cost_usd)}`
          : e.type === 'memory_write' ? d.kind
          : e.type === 'error' ? d.where : e.type === 'answer' ? d.status : d.model ?? '';
      nodes.push({
        id: `n${e.seq}`, type: 'step', position: { x: col * 230, y: (i - (group.length - 1) / 2) * 90 + 120 },
        data: { title: e.type === 'tool_call' ? d.name : e.type === 'llm_call' ? `Modelo · paso ${d.step}` : EVENT_META[e.type]?.label ?? e.type, sub, type: e.type, event: res ?? e, err: e.type === 'error' || !!res?.data.is_error, selected: selected === e.seq },
      });
    });
    prev.forEach((p) => ids.forEach((id) => edges.push({ id: `${p}-${id}`, source: p, target: id, animated: true, style: { stroke: '#c8ff3d88', strokeWidth: 1.5 } })));
    prev = ids;
    col += 1;
  };
  let i = 0;
  const shown = events.filter((e) => !['thinking', 'tool_result', 'fallback'].includes(e.type));
  while (i < shown.length) {
    if (shown[i].type === 'tool_call') {
      const group: TraceEvent[] = [];
      const step = shown[i].data.step;
      while (i < shown.length && shown[i].type === 'tool_call' && shown[i].data.step === step) group.push(shown[i++]);
      add(group);
    } else add([shown[i++]]);
  }
  return { nodes, edges };
}

function Waterfall({ events }: { events: TraceEvent[] }) {
  const start = events[0]?.ts ?? 0;
  const spans = events
    .filter((e) => e.type === 'llm_call' || e.type === 'tool_result')
    .map((e) => ({ label: e.type === 'llm_call' ? `modelo · paso ${e.data.step}` : e.data.name, end: e.ts - start, ms: e.data.ms as number, color: e.type === 'llm_call' ? '#c8ff3d' : e.data.is_error ? '#ff5e6c' : '#5ee6ff' }));
  const total = Math.max(...spans.map((s) => s.end), 0.001);
  if (!spans.length) return <p className="dim">Sin pasos medidos.</p>;
  return (
    <div className="waterfall">
      {spans.map((s, i) => {
        const left = Math.max(0, (s.end - s.ms / 1000) / total) * 100;
        const width = Math.max(0.8, (s.ms / 1000 / total) * 100);
        return (
          <div className="wf-row" key={i}>
            <span className="lbl">{s.label}</span>
            <div className="wf-track"><div className="wf-bar" style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, background: s.color, animationDelay: `${i * 0.06}s` }} /></div>
            <span className="ms">{fmtMs(s.ms)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Traces() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [selected, setSelected] = useState<TraceEvent | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.runs().then((r) => { setRuns(r); if (r[0]) setActive(r[0].id); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (active == null) return;
    setSelected(null);
    api.runEvents(active).then((r) => setEvents(r.events)).catch((e) => setError(e.message));
  }, [active]);

  const graph = useMemo(() => buildGraph(events, selected?.seq ?? null), [events, selected]);
  const run = runs.find((r) => r.id === active);
  const thinking = events.filter((e) => e.type === 'thinking');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Observabilidad</span>
          <h1>Trazas</h1>
          <p>Cada run del harness como grafo: el modelo, las herramientas MCP que llamó en paralelo, la memoria y el costo de cada paso.</p>
        </div>
      </div>
      {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
      {!runs.length ? (
        <div className="card empty"><GitBranch size={30} /><p>Todavía no hay runs. Haz una pregunta en el chat o corre un eval de agente.</p></div>
      ) : (
        <div className="traces">
          <div className="card run-list">
            {runs.map((r) => (
              <button key={r.id} className={`run-item ${r.id === active ? 'active' : ''}`} onClick={() => setActive(r.id)}>
                <div className="q">{r.question}</div>
                <div className="meta">
                  <span style={{ color: r.status === 'ok' ? '#5effb1' : '#ff8f5e' }}>{r.status}</span>
                  <span>{r.source}</span><span>{r.steps} pasos</span><span>{fmtUsd(r.cost_usd)}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="grid">
            {run && (
              <div className="kpis">
                <div className="kpi"><div className="label">Estado</div><div className="value" style={{ fontSize: 20 }}>{run.status}</div></div>
                <div className="kpi"><div className="label">Pasos</div><div className="value">{run.steps}</div></div>
                <div className="kpi"><div className="label">Tokens</div><div className="value">{(run.input_tokens + run.output_tokens).toLocaleString('es-CO')}</div></div>
                <div className="kpi"><div className="label">Costo</div><div className="value">{fmtUsd(run.cost_usd)}</div></div>
                <div className="kpi"><div className="label">Duración</div><div className="value">{run.ended_at ? fmtMs((run.ended_at - run.started_at) * 1000) : '...'}</div></div>
              </div>
            )}
            <div className="card">
              <div className="card-title"><h3>Grafo del run</h3><span className="dim mono" style={{ fontSize: 11 }}>{run && fmtDate(run.started_at)}</span></div>
              <div className="flow">
                <ReactFlow
                  key={active ?? 0} nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} fitView colorMode="dark"
                  nodesDraggable={false} proOptions={{ hideAttribution: true }}
                  onNodeClick={(_, n) => setSelected((n.data as StepData).event)}
                >
                  <Background color="#ffffff10" gap={22} />
                </ReactFlow>
              </div>
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)' }}>
              <div className="card">
                <div className="card-title"><h3>Cascada de tiempos</h3></div>
                <Waterfall events={events} />
                {!!thinking.length && (
                  <>
                    <h3 style={{ margin: '18px 0 8px', fontSize: 14 }}>Razonamiento resumido</h3>
                    {thinking.map((t) => <p key={t.seq} className="muted" style={{ fontSize: 12.5, margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{t.data.text}</p>)}
                  </>
                )}
              </div>
              <div className="card">
                <div className="card-title"><h3>Detalle del nodo</h3></div>
                {selected ? <pre className="json">{JSON.stringify(selected.data, null, 2)}</pre> : <p className="dim">Haz clic en un nodo del grafo.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
