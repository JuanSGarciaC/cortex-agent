import { useEffect, useState } from 'react';
import { FlaskConical, Loader2, Play } from 'lucide-react';
import { api, fmtDate, fmtMs, fmtUsd, type Dataset, type EvalRun } from '../lib/api';

type Result = EvalRun['results'][number];

const score = (kind: string, r: Result) =>
  kind === 'retrieval' ? Number(r.scores.mrr ?? 0) : ((Number(r.scores.faithfulness ?? 0) + Number(r.scores.relevance ?? 0)) / 10);

function cellStyle(kind: string, r?: Result) {
  if (!r) return { background: 'rgba(255,255,255,.03)' };
  if (!r.passed) return { background: 'rgba(255,94,108,.55)', color: '#fff' };
  const s = score(kind, r);
  return { background: `rgba(200,255,61,${0.25 + s * 0.65})`, color: '#0b0f00' };
}

const SUMMARY_LABELS: Record<string, [string, (v: number) => string]> = {
  pass_rate: ['Aprobados', (v) => `${Math.round(v * 100)} %`],
  avg_recall: ['Recall@k', (v) => v.toFixed(2)],
  avg_mrr: ['MRR', (v) => v.toFixed(2)],
  avg_tool_ok: ['Herramienta correcta', (v) => `${Math.round(v * 100)} %`],
  avg_faithfulness: ['Fidelidad', (v) => `${v.toFixed(1)}/5`],
  avg_relevance: ['Relevancia', (v) => `${v.toFixed(1)}/5`],
  avg_steps: ['Pasos', (v) => v.toFixed(1)],
  avg_cost_usd: ['Costo por caso', fmtUsd],
  avg_ms: ['Latencia', fmtMs],
};

export default function Evals() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [active, setActive] = useState<string>('');
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [running, setRunning] = useState(false);
  const [sel, setSel] = useState<{ run: EvalRun; r: Result } | null>(null);
  const [error, setError] = useState('');
  const [llm, setLlm] = useState(true);

  useEffect(() => {
    api.datasets().then((d) => { setDatasets(d); if (d[0]) setActive(d[0].file); }).catch((e) => setError(e.message));
    api.health().then((h) => setLlm(h.llm)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!active) return;
    setSel(null);
    api.evalRuns(active).then(setRuns).catch((e) => setError(e.message));
  }, [active]);

  async function run() {
    setRunning(true);
    setError('');
    try {
      await api.runEval(active, 3);
      setRuns(await api.evalRuns(active));
    } catch (err) { setError((err as Error).message); } finally { setRunning(false); }
  }

  const ds = datasets.find((d) => d.file === active);
  const latest = runs[0];
  const cols = [...runs].slice(0, 12).reverse();
  const caseIds = Array.from(new Set(cols.flatMap((r) => r.results.map((x) => x.case_id))));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Calidad</span>
          <h1>Evals</h1>
          <p>Retrieval sin LLM (recall@k y MRR) y evals del agente completo con un juez que califica fidelidad y relevancia. Cada corrida queda guardada para compararla con las anteriores.</p>
        </div>
        <button className="btn primary" onClick={run} disabled={!active || running || (ds?.kind === 'agent' && !llm)} title={ds?.kind === 'agent' && !llm ? 'Necesita ANTHROPIC_API_KEY' : undefined}>
          {running ? <Loader2 size={16} className="spin" /> : <Play size={16} />} {running ? 'Corriendo...' : 'Correr dataset'}
        </button>
      </div>
      {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', marginBottom: 16 }}>
        {datasets.map((d) => (
          <button key={d.file} className={`card ds-card ${d.file === active ? 'active' : ''}`} onClick={() => setActive(d.file)}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className={`chip ${d.kind === 'agent' ? 'cyan' : 'accent'}`}>{d.kind === 'agent' ? 'agente + juez' : 'retrieval'}</span>
              <span className="dim mono" style={{ fontSize: 11 }}>{d.cases} casos</span>
            </div>
            <h3 style={{ marginTop: 10 }}>{d.name}</h3>
            <div className="dim mono" style={{ fontSize: 11, marginTop: 4 }}>{d.file}</div>
          </button>
        ))}
      </div>

      {!latest ? (
        <div className="card empty"><FlaskConical size={30} /><p>Este dataset no tiene corridas. Pulsa «Correr dataset».</p></div>
      ) : (
        <div className="grid">
          <div className="kpis">
            {Object.entries(latest.summary).filter(([k]) => SUMMARY_LABELS[k]).map(([k, v]) => (
              <div className="kpi" key={k}>
                <div className="label">{SUMMARY_LABELS[k][0]}</div>
                <div className="value">{SUMMARY_LABELS[k][1](v)}</div>
                {k === 'pass_rate' && <div className="bar-mini" style={{ marginTop: 8 }}><i style={{ width: `${v * 100}%` }} /></div>}
              </div>
            ))}
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
            <div className="card heat">
              <div className="card-title"><h3>Casos × corridas</h3><span className="dim" style={{ fontSize: 12 }}>verde: aprobado (más intenso, mejor puntaje) · rojo: falló</span></div>
              <table>
                <thead>
                  <tr><th />{cols.map((r) => <th key={r.id} title={fmtDate(r.created_at)}>#{r.id}</th>)}</tr>
                </thead>
                <tbody>
                  {caseIds.map((cid, ri) => (
                    <tr key={cid}>
                      <td className="case" title={cols.flatMap((r) => r.results).find((x) => x.case_id === cid)?.output}>{cid}</td>
                      {cols.map((r, ci) => {
                        const res = r.results.find((x) => x.case_id === cid);
                        const s = res ? score(r.kind, res) : 0;
                        return (
                          <td key={r.id} className={`cell ${sel?.run.id === r.id && sel.r.case_id === cid ? 'sel' : ''}`} style={{ ...cellStyle(r.kind, res), animationDelay: `${(ri + ci) * 0.02}s` }} onClick={() => res && setSel({ run: r, r: res })}>
                            {res ? (res.passed ? s.toFixed(1) : 'x') : ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td className="case">aprobados</td>
                    {cols.map((r) => <td key={r.id} className="mono" style={{ fontSize: 11, textAlign: 'center', color: 'var(--muted)' }}>{Math.round(r.summary.pass_rate * 100)}%</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="card">
              <div className="card-title"><h3>Detalle</h3>{sel && <span className={`chip ${sel.r.passed ? 'ok' : 'danger'}`}>{sel.r.passed ? 'aprobado' : 'falló'}</span>}</div>
              {sel ? (
                <div className="grid" style={{ gap: 10 }}>
                  <div className="mono dim" style={{ fontSize: 11 }}>{sel.r.case_id} · corrida #{sel.run.id} · {fmtDate(sel.run.created_at)}</div>
                  <pre className="json">{JSON.stringify(sel.r.scores, null, 2)}</pre>
                  <div className="muted" style={{ fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{sel.r.output}</div>
                </div>
              ) : <p className="dim">Haz clic en una celda.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
