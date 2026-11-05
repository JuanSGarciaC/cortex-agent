import { useEffect, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import { Brain, Plus, Trash2 } from 'lucide-react';
import { api, fmtDate, KIND_COLORS, type Memory } from '../lib/api';

type GNode = Memory & SimulationNodeDatum;
type GLink = { source: GNode | number; target: GNode | number; weight: number };
const W = 800, H = 600;
const KINDS = ['preferencia', 'hecho', 'objetivo', 'contexto'];
// Each kind pulls toward its own corner so the clusters read at a glance.
const ANCHORS: Record<string, [number, number]> = { preferencia: [-170, -110], hecho: [170, -110], objetivo: [-170, 120], contexto: [170, 120] };

export default function MemoryPage() {
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [links, setLinks] = useState<GLink[]>([]);
  const [, setTick] = useState(0);
  const [hl, setHl] = useState<number | null>(null);
  const [content, setContent] = useState('');
  const [kind, setKind] = useState('preferencia');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const simRef = useRef<ReturnType<typeof forceSimulation<GNode>> | null>(null);

  async function load() {
    const g = await api.memoryGraph();
    const ns: GNode[] = g.nodes.map((n) => ({ ...n }));
    const ls: GLink[] = g.edges.map((e) => ({ ...e }));
    simRef.current?.stop();
    const sim = forceSimulation<GNode>(ns)
      .force('charge', forceManyBody().strength(-220))
      .force('link', forceLink<GNode, any>(ls).id((d) => d.id).distance((l: any) => 140 - l.weight * 80).strength(0.6))
      .force('x', forceX<GNode>((d) => ANCHORS[d.kind]?.[0] ?? 0).strength(0.06))
      .force('y', forceY<GNode>((d) => ANCHORS[d.kind]?.[1] ?? 0).strength(0.06))
      .force('collide', forceCollide(72))
      .force('center', forceCenter(0, 0))
      .on('tick', () => setTick((t) => t + 1));
    simRef.current = sim;
    setNodes(ns);
    setLinks(ls);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    return () => { simRef.current?.stop(); };
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setError('');
    try {
      const saved = await api.addMemory(content, kind);
      setMsg(saved.duplicate ? 'Ya existía una memoria casi igual; no se duplicó.' : 'Memoria guardada.');
      setContent('');
      await load();
    } catch (err) { setError((err as Error).message); }
  }

  async function remove(id: number) {
    await api.deleteMemory(id);
    await load();
  }

  const counts = KINDS.map((k) => [k, nodes.filter((n) => n.kind === k).length] as const);
  const linked = (id: number) => links.some((l) => ((l.source as GNode).id === hl && (l.target as GNode).id === id) || ((l.target as GNode).id === hl && (l.source as GNode).id === id));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Estado</span>
          <h1>Memoria</h1>
          <p>Hechos de largo plazo que el agente extrae al final de cada turno o guarda con la herramienta memory_save. Las líneas unen hechos con significado parecido.</p>
        </div>
        <div className="row wrap">{counts.map(([k, n]) => <span key={k} className="chip"><span className="sw" style={{ background: KIND_COLORS[k] }} />{k} {n}</span>)}</div>
      </div>
      {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="mem">
        <div className="graph">
          {!nodes.length ? (
            <div className="empty" style={{ height: '100%' }}><Brain size={32} /><p>Aún no hay memorias. Dile algo sobre ti al agente o agrega una a la derecha.</p></div>
          ) : (
            <svg viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} role="img" aria-label="Grafo de memorias">
              {links.map((l, i) => {
                const s = l.source as GNode, t = l.target as GNode;
                const on = hl != null && (s.id === hl || t.id === hl);
                return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={on ? '#ffffffaa' : '#ffffff1f'} strokeWidth={on ? 1.6 : 1} />;
              })}
              {nodes.map((n) => {
                const on = hl === n.id || (hl != null && linked(n.id));
                const faded = hl != null && !on;
                const label = n.content.length > 26 ? `${n.content.slice(0, 26)}...` : n.content;
                return (
                  <g key={n.id} transform={`translate(${n.x ?? 0},${n.y ?? 0})`} onMouseEnter={() => setHl(n.id)} onMouseLeave={() => setHl(null)} style={{ cursor: 'pointer', opacity: faded ? 0.25 : 1, transition: 'opacity .2s' }}>
                    <circle r={hl === n.id ? 20 : 13} fill={KIND_COLORS[n.kind]} opacity={0.15} style={{ transition: 'r .2s' }} />
                    <circle r={7} fill={KIND_COLORS[n.kind]} />
                    <text y={24} textAnchor="middle" fill="#c9ced8" fontSize={11} style={{ pointerEvents: 'none' }}>{label}</text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <form className="card grid" style={{ gap: 10 }} onSubmit={add}>
            <h3><Plus size={16} /> Agregar memoria</h3>
            <label htmlFor="mem" className="sr-only">Contenido</label>
            <textarea id="mem" className="textarea" rows={2} maxLength={1000} placeholder="Ej.: El usuario prefiere respuestas en viñetas" value={content} onChange={(e) => setContent(e.target.value)} />
            <div className="row">
              <label htmlFor="kind" className="sr-only">Tipo</label>
              <select id="kind" className="select" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
              <button className="btn primary" disabled={!content.trim()}>Guardar</button>
            </div>
            {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
          </form>
          <div className="card" style={{ maxHeight: 440, overflow: 'auto' }}>
            <div className="card-title"><h3>Hechos guardados</h3><span className="chip">{nodes.length}</span></div>
            {[...nodes].sort((a, b) => b.id - a.id).map((n) => (
              <div key={n.id} className={`mem-item ${hl === n.id ? 'hl' : ''}`} onMouseEnter={() => setHl(n.id)} onMouseLeave={() => setHl(null)}>
                <span className="sw" style={{ width: 9, height: 9, borderRadius: '50%', marginTop: 6, flex: 'none', background: KIND_COLORS[n.kind] }} />
                <div className="grow">
                  <div style={{ fontSize: 13 }}>{n.content}</div>
                  <div className="dim mono" style={{ fontSize: 11 }}>{n.kind} · {fmtDate(n.created_at)}{n.run_id ? ` · run ${n.run_id}` : ''}</div>
                </div>
                <button className="btn ghost icon danger" aria-label="Borrar memoria" onClick={() => remove(n.id)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
