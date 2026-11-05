import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Brain, Database, FlaskConical, GitBranch, MessageSquare, Wrench } from 'lucide-react';
import SwarmCursor from '../components/SwarmCursor';
import '../components/SwarmCursor.css';
import { api, fmtUsd, type Stats } from '../lib/api';

const MODULES = [
  { to: '/chat', icon: MessageSquare, title: 'Harness propio', text: 'Bucle del agente sobre la Messages API: límites de pasos y costo, herramientas en paralelo, trazas por paso.', tag: 'Agente', cover: 'loop' },
  { to: '/herramientas', icon: Wrench, title: 'MCP', text: 'Servidor MCP propio más servidores externos por stdio. El agente solo habla MCP.', tag: 'Protocolo', cover: 'mcp' },
  { to: '/rag', icon: Database, title: 'RAG híbrido', text: 'BM25 más vectores fusionados con RRF, citas por fragmento y un mapa 2D de los embeddings.', tag: 'Retrieval', cover: 'rag' },
  { to: '/memoria', icon: Brain, title: 'Memoria', text: 'Hechos de largo plazo extraídos al final de cada turno, deduplicados y recuperados por similitud.', tag: 'Estado', cover: 'mem' },
  { to: '/evals', icon: FlaskConical, title: 'Evals', text: 'recall@k, MRR, herramienta esperada y un juez LLM para fidelidad y relevancia. Corre en CI.', tag: 'Calidad', cover: 'evals' },
  { to: '/trazas', icon: GitBranch, title: 'Observabilidad', text: 'Cada run como grafo y cascada de tiempos: tokens, costo, latencia y errores.', tag: 'Trazas', cover: 'trace' },
];

function Cover({ kind }: { kind: string }) {
  if (kind === 'rag')
    return (
      <svg viewBox="0 0 300 150" width="100%" height="100%" aria-hidden>
        {Array.from({ length: 46 }, (_, i) => {
          const a = i * 2.4, r = 18 + (i % 9) * 6;
          return <circle key={i} cx={150 + Math.cos(a) * r * 2} cy={75 + Math.sin(a) * r} r={i % 7 === 0 ? 4 : 2.2} fill={['#c8ff3d', '#5ee6ff', '#b18cff'][i % 3]} opacity={0.75}><animate attributeName="opacity" values="0.3;0.9;0.3" dur={`${2 + (i % 5)}s`} repeatCount="indefinite" /></circle>;
        })}
      </svg>
    );
  if (kind === 'mem')
    return (
      <svg viewBox="0 0 300 150" width="100%" height="100%" aria-hidden>
        {[[60, 50, 140, 90], [140, 90, 230, 45], [140, 90, 200, 120], [60, 50, 90, 115], [230, 45, 260, 100]].map(([a, b, c, d], i) => <line key={i} x1={a} y1={b} x2={c} y2={d} stroke="#ffffff22" />)}
        {[[60, 50, '#c8ff3d'], [140, 90, '#5ee6ff'], [230, 45, '#ff8f5e'], [200, 120, '#b18cff'], [90, 115, '#5ee6ff'], [260, 100, '#c8ff3d']].map(([x, y, c], i) => (
          <circle key={i} cx={x as number} cy={y as number} r={7} fill={c as string}><animate attributeName="r" values="6;9;6" dur={`${2.5 + i * 0.4}s`} repeatCount="indefinite" /></circle>
        ))}
      </svg>
    );
  if (kind === 'evals')
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4, padding: 18, height: '100%' }} aria-hidden>
        {Array.from({ length: 48 }, (_, i) => <div key={i} style={{ borderRadius: 4, background: (i * 7) % 11 < 2 ? '#ff5e6c88' : `rgba(200,255,61,${0.25 + ((i * 13) % 7) / 10})`, animation: `pop .4s ${i * 0.015}s both` }} />)}
      </div>
    );
  if (kind === 'trace')
    return (
      <div style={{ padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 9 }} aria-hidden>
        {[[0, 30, '#c8ff3d'], [30, 25, '#5ee6ff'], [32, 18, '#5ee6ff'], [55, 35, '#c8ff3d'], [90, 8, '#b18cff']].map(([l, w, c], i) => (
          <div key={i} style={{ height: 12, borderRadius: 4, background: 'rgba(255,255,255,.04)', position: 'relative' }}>
            <div style={{ position: 'absolute', left: `${l}%`, width: `${w}%`, top: 0, bottom: 0, borderRadius: 4, background: c as string, transformOrigin: 'left', animation: `grow .8s ${i * 0.15}s both` }} />
          </div>
        ))}
      </div>
    );
  const color = kind === 'mcp' ? '#5ee6ff' : '#c8ff3d';
  return (
    <svg viewBox="0 0 300 150" width="100%" height="100%" aria-hidden>
      <circle cx="150" cy="75" r="44" fill="none" stroke={`${color}44`} strokeDasharray="3 6"><animateTransform attributeName="transform" type="rotate" from="0 150 75" to="360 150 75" dur="18s" repeatCount="indefinite" /></circle>
      <circle cx="150" cy="75" r="16" fill={color} opacity="0.85" />
      {[0, 1, 2, 3].map((i) => (
        <circle key={i} r="5" fill={i % 2 ? '#b18cff' : '#fff'}>
          <animateMotion dur={`${3 + i}s`} repeatCount="indefinite" path="M150,31 a44,44 0 1,1 -0.1,0" begin={`${i * 0.7}s`} />
        </circle>
      ))}
    </svg>
  );
}

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    api.stats().then(setStats).catch(() => setStats(null));
  }, []);

  return (
    <>
      <SwarmCursor className="hero" count={1400} color="#c8ff3d" accentColor="#5ee6ff" idle="roam" spread={230}>
        <div className="hero-inner">
          <h1>
            Un agente que puedes <span className="glow">ver pensar.</span>
          </h1>
          <p className="lead">Cortex une un bucle de agente propio, herramientas MCP, búsqueda híbrida, memoria de largo plazo y evals en una sola app, y deja cada paso a la vista.</p>
          <div className="ctas">
            <Link to="/chat" className="btn primary">Abrir el chat <ArrowRight size={16} /></Link>
            <Link to="/rag" className="btn">Explorar el mapa RAG</Link>
          </div>
        </div>
        {stats && (
          <div className="hero-stats">
            <span><b>{stats.documents}</b>documentos</span>
            <span><b>{stats.chunks}</b>fragmentos</span>
            <span><b>{stats.memories}</b>memorias</span>
            <span><b>{stats.runs}</b>runs</span>
            <span><b>{stats.tool_calls}</b>llamadas MCP</span>
            <span><b>{fmtUsd(stats.cost_usd)}</b>costo total</span>
          </div>
        )}
      </SwarmCursor>
      <section className="page" style={{ paddingTop: 48 }}>
        <div className="page-head">
          <div>
            <h1>Seis piezas, un mismo registro de eventos</h1>
          </div>
        </div>
        <div className="modules">
          {MODULES.map(({ to, icon: Icon, title, text, tag, cover }) => (
            <Link to={to} className="module" key={to}>
              <span className="chip accent tag">{tag}</span>
              <div className="cover"><Cover kind={cover} /></div>
              <div className="body">
                <h3><Icon size={17} /> {title}</h3>
                <p>{text}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
