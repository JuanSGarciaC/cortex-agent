import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Search, Trash2, UploadCloud } from 'lucide-react';
import { api, colorFor, type Doc, type Hit, type MapPoint } from '../lib/api';

type MapData = Awaited<ReturnType<typeof api.map>>;
const S = 260; // half-size of the SVG coordinate space
const sx = (x: number) => x * S * 0.9;
const sy = (y: number) => -y * S * 0.82;

export default function Rag() {
  const [map, setMap] = useState<MapData | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [q, setQ] = useState('');
  const [hover, setHover] = useState<{ p: MapPoint; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = (query?: string) => api.map(query, 5).then(setMap);
  const loadDocs = () => api.documents().then(setDocs);
  useEffect(() => {
    Promise.all([load(), loadDocs()]).catch((e) => setError(e.message));
  }, []);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setError('');
    if (!q.trim()) { setHits([]); return load(); }
    setBusy(true);
    try {
      const [, h] = await Promise.all([load(q), api.search(q, 5)]);
      setHits(h);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError('');
    try {
      for (const f of Array.from(files)) await api.upload(f);
      await Promise.all([load(q || undefined), loadDocs()]);
    } catch (err) { setError((err as Error).message); } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function remove(id: number) {
    await api.deleteDocument(id);
    setHits((h) => h.filter((x) => x.doc_id !== id));
    await Promise.all([load(q || undefined), loadDocs()]);
  }

  const neighbors = new Set(map?.neighbors ?? []);
  const byId = new Map((map?.points ?? []).map((p) => [p.id, p]));
  const titles = Array.from(new Map((map?.points ?? []).map((p) => [p.doc_id, p.title])).entries());

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Retrieval</span>
          <h1>Mapa RAG</h1>
          <p>Cada punto es un fragmento proyectado en 2D desde su embedding. Escribe una consulta y mira dónde cae y qué vecinos recupera la búsqueda híbrida.</p>
        </div>
      </div>
      {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="rag">
        <div className="card">
          <form className="row" onSubmit={search} style={{ marginBottom: 14 }}>
            <label htmlFor="q" className="sr-only">Consulta</label>
            <input id="q" className="input" placeholder="Ej.: ¿cuál es el tope de hospedaje?" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn primary" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <Search size={16} />} Buscar</button>
          </form>
          <div className="map" ref={boxRef} onMouseLeave={() => setHover(null)}>
            {map && map.points.length === 0 ? (
              <div className="empty" style={{ height: '100%' }}><FileText size={30} /><p>Sube documentos para ver el mapa.</p></div>
            ) : (
              <svg viewBox={`${-S} ${-S * 0.9} ${S * 2} ${S * 1.8}`} role="img" aria-label="Mapa 2D de fragmentos">
                <defs>
                  <radialGradient id="qglow"><stop offset="0" stopColor="#fff" stopOpacity="0.9" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
                </defs>
                {[-0.5, 0, 0.5].map((v) => <line key={`h${v}`} x1={-S} x2={S} y1={sy(v)} y2={sy(v)} stroke="#ffffff08" />)}
                {[-0.5, 0, 0.5].map((v) => <line key={`v${v}`} y1={-S} y2={S} x1={sx(v)} x2={sx(v)} stroke="#ffffff08" />)}
                {map?.query && map.neighbors.map((id) => {
                  const p = byId.get(id);
                  return p ? <line key={`l${id}`} className="link" x1={sx(map.query!.x)} y1={sy(map.query!.y)} x2={sx(p.x)} y2={sy(p.y)} stroke="#ffffffaa" strokeWidth={1} /> : null;
                })}
                {map?.points.map((p, i) => {
                  const hit = neighbors.has(p.id);
                  const dim = neighbors.size > 0 && !hit;
                  return (
                    <g key={p.id} style={{ animation: `pop .5s ${Math.min(i * 0.01, 1)}s both` }}>
                      {hit && <circle className="halo" cx={sx(p.x)} cy={sy(p.y)} r={9} fill="none" stroke={colorFor(p.doc_id)} strokeWidth={1.5} />}
                      <circle
                        className="pt" cx={sx(p.x)} cy={sy(p.y)} r={hit ? 7 : 4.5} fill={colorFor(p.doc_id)} opacity={dim ? 0.22 : 0.9}
                        onMouseEnter={(e) => { const b = boxRef.current!.getBoundingClientRect(); setHover({ p, x: e.clientX - b.left, y: e.clientY - b.top }); }}
                      />
                    </g>
                  );
                })}
                {map?.query && (
                  <g>
                    <circle cx={sx(map.query.x)} cy={sy(map.query.y)} r={22} fill="url(#qglow)" opacity={0.35} />
                    <circle className="halo" cx={sx(map.query.x)} cy={sy(map.query.y)} r={10} fill="none" stroke="#fff" />
                    <rect x={sx(map.query.x) - 6} y={sy(map.query.y) - 6} width={12} height={12} rx={3} fill="#fff" transform={`rotate(45 ${sx(map.query.x)} ${sy(map.query.y)})`} />
                  </g>
                )}
              </svg>
            )}
            {hover && (
              <div className="tooltip" style={{ left: Math.min(hover.x + 14, (boxRef.current?.clientWidth ?? 600) - 290), top: hover.y + 14 }}>
                <div className="row" style={{ marginBottom: 4 }}><span className="chip"><span className="sw" style={{ background: colorFor(hover.p.doc_id) }} />{hover.p.title}</span><span className="dim mono" style={{ fontSize: 11 }}>#{hover.p.id}</span></div>
                <span className="muted">{hover.p.preview}...</span>
              </div>
            )}
          </div>
          <div className="legend">
            {titles.map(([id, t]) => <span key={id} className="chip"><span className="sw" style={{ background: colorFor(id) }} />{t}</span>)}
            {map?.query && <span className="chip" style={{ color: '#fff' }}>&#9670; consulta</span>}
          </div>
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <div
            className={`dropzone ${over ? 'over' : ''}`} role="button" tabIndex={0}
            onClick={() => fileRef.current?.click()} onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
          >
            {uploading ? <Loader2 size={26} className="spin" color="#c8ff3d" /> : <UploadCloud size={26} color="#c8ff3d" />}
            <div style={{ marginTop: 8, fontWeight: 600 }}>{uploading ? 'Indexando...' : 'Arrastra archivos o haz clic'}</div>
            <div className="dim" style={{ fontSize: 12 }}>.txt, .md o .pdf, hasta 10 MB</div>
            <input ref={fileRef} type="file" accept=".txt,.md,.pdf" multiple hidden onChange={(e) => upload(e.target.files)} />
          </div>

          {hits.length > 0 && (
            <div className="card">
              <div className="card-title"><h3>Recuperados</h3><span className="dim mono" style={{ fontSize: 11 }}>RRF · vector + BM25</span></div>
              <div className="grid" style={{ gap: 8 }}>
                {hits.map((h, i) => (
                  <div className="hit" key={h.chunk_id} style={{ animationDelay: `${i * 0.06}s` }}>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <span className="chip accent">#{i + 1}</span>
                      <span className="chip"><span className="sw" style={{ background: colorFor(h.doc_id) }} />{h.title}</span>
                      <span className="chip cyan" title="Puesto en la búsqueda vectorial">vec {h.vector_rank != null ? h.vector_rank + 1 : '-'}</span>
                      <span className="chip" title="Puesto en BM25">bm25 {h.bm25_rank != null ? h.bm25_rank + 1 : '-'}</span>
                    </div>
                    <div className="txt">{h.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-title"><h3>Documentos</h3><span className="chip">{docs.length}</span></div>
            {docs.map((d) => (
              <div className="doc-row" key={d.id}>
                <span className="sw" style={{ width: 10, height: 10, borderRadius: 3, background: colorFor(d.id) }} />
                <div className="grow"><div style={{ fontSize: 13 }}>{d.title}</div><div className="dim mono" style={{ fontSize: 11 }}>{d.chunks} fragmentos · {d.chars.toLocaleString('es-CO')} caracteres</div></div>
                <button className="btn ghost icon danger" aria-label={`Borrar ${d.title}`} onClick={() => remove(d.id)}><Trash2 size={14} /></button>
              </div>
            ))}
            {!docs.length && <p className="dim">Sin documentos. Corre <code>python seed.py</code> para cargar el manual de ejemplo.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
