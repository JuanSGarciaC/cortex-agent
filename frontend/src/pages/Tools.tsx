import { useEffect, useMemo, useState } from 'react';
import { Brain, Database, FileSearch, Pause, Play, Plug, Wrench } from 'lucide-react';
import { api, type Tool } from '../lib/api';

const GLYPHS: Record<string, any> = { rag_search: FileSearch, rag_list_documents: Database, memory_save: Brain, memory_recall: Brain };
const ORBS: Record<string, [string, string]> = { propio: ['#c8ff3d', '#5ee6ff'], externo: ['#b18cff', '#ff8f5e'] };

function ToolCard({ t, i }: { t: Tool; i: number }) {
  const Glyph = GLYPHS[t.name] ?? Plug;
  const [a, b] = ORBS[t.source] ?? ORBS.externo;
  const params = Object.entries<any>(t.input_schema?.properties ?? {});
  const required = new Set<string>(t.input_schema?.required ?? []);
  return (
    <article className="tool-card" style={{ animationDelay: `${i * 0.05}s` }}>
      <div className="badges">
        <span className={`chip ${t.source === 'propio' ? 'accent' : 'cyan'}`}>{t.source}</span>
        {t.calls === 0 && <span className="chip">sin uso</span>}
      </div>
      <div className="tool-cover">
        <div className="orb" style={{ background: a, left: -40, top: -60 }} />
        <div className="orb" style={{ background: b, right: -60, bottom: -90, animationDelay: '-4s' }} />
        <div className="grid-lines" />
        <div className="glyph"><Glyph size={38} strokeWidth={1.4} color="#fff" /></div>
      </div>
      <div className="body">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="name">{t.name}</span>
          <span className="dim mono" style={{ fontSize: 11 }}>{t.server}</span>
        </div>
        <p className="desc">{t.description || 'Sin descripción.'}</p>
        <div className="row wrap" style={{ gap: 6 }}>
          {params.map(([name, p]) => <span key={name} className="chip" title={p.description}>{name}{required.has(name) ? '' : '?'}: {p.type ?? 'any'}</span>)}
        </div>
        <div className="row" style={{ marginTop: 12, gap: 14, fontSize: 12 }}>
          <span><b>{t.calls}</b> <span className="muted">llamadas</span></span>
          <span style={{ color: t.errors ? '#ff5e6c' : undefined }}><b>{t.errors}</b> <span className="muted">errores</span></span>
        </div>
      </div>
    </article>
  );
}

export default function Tools() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('todas');
  const [sort, setSort] = useState<'uso' | 'az'>('uso');
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.tools().then((r) => { setTools(r.tools); setErrors(r.errors); }).catch((e) => setError(e.message));
  }, []);

  const servers = useMemo(() => Array.from(new Set(tools.map((t) => t.server))), [tools]);
  const shown = useMemo(() => {
    const list = tools.filter((t) => filter === 'todas' || t.source === filter || t.server === filter);
    return [...list].sort((a, b) => (sort === 'az' ? a.name.localeCompare(b.name) : b.calls - a.calls));
  }, [tools, filter, sort]);
  const count = (f: string) => tools.filter((t) => f === 'todas' || t.source === f || t.server === f).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Protocolo</span>
          <h1>Herramientas MCP</h1>
          <p>Todo lo que el agente puede usar, descubierto por MCP en cada run: el servidor propio de Cortex y los servidores externos de backend/mcp_servers.json.</p>
        </div>
        <div className="row">
          <label htmlFor="sort" className="sr-only">Ordenar</label>
          <select id="sort" className="select" style={{ width: 160 }} value={sort} onChange={(e) => setSort(e.target.value as any)}>
            <option value="uso">Más usadas</option>
            <option value="az">A a Z</option>
          </select>
          <button className="btn" onClick={() => setPaused((p) => !p)}>{paused ? <Play size={15} /> : <Pause size={15} />} {paused ? 'Reanudar' : 'Pausar'} animaciones</button>
        </div>
      </div>
      {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
      {Object.entries(errors).map(([name, msg]) => <div key={name} className="error-box" style={{ marginBottom: 12 }}>No se pudo conectar el servidor «{name}»: {msg}</div>)}
      <div className="catalog">
        <nav className="filters" aria-label="Filtros">
          <h4>Origen</h4>
          {['todas', 'propio', 'externo'].map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}><span style={{ textTransform: 'capitalize' }}>{f}</span><span className="count">{count(f)}</span></button>
          ))}
          <h4>Servidor</h4>
          {servers.map((s) => <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}><span className="mono" style={{ fontSize: 12.5 }}>{s}</span><span className="count">{count(s)}</span></button>)}
          <div className="card" style={{ marginTop: 18, padding: 14 }}>
            <h3 style={{ fontSize: 13 }}><Wrench size={14} /> Agrega un servidor</h3>
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>Copia <code>mcp_servers.example.json</code> en <code>mcp_servers.json</code>. Se conecta en el siguiente run y sus herramientas aparecen con el prefijo del servidor.</p>
          </div>
        </nav>
        <div className={`tool-grid ${paused ? 'paused' : ''}`}>
          {shown.map((t, i) => <ToolCard key={t.name} t={t} i={i} />)}
          {!shown.length && <div className="card empty"><Plug size={28} /><p>No hay herramientas con este filtro.</p></div>}
        </div>
      </div>
    </div>
  );
}
