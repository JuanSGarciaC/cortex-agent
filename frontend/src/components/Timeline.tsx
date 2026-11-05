import { AlertTriangle, Brain, CircleCheck, Cpu, Flag, Lightbulb, Play, Repeat, Save, Wrench } from 'lucide-react';
import { fmtMs, fmtUsd, type TraceEvent } from '../lib/api';

export const EVENT_META: Record<string, { label: string; icon: any; color: string }> = {
  run_start: { label: 'Inicio del run', icon: Play, color: '#c8ff3d' },
  memory_recall: { label: 'Memoria recuperada', icon: Brain, color: '#b18cff' },
  llm_call: { label: 'Llamada al modelo', icon: Cpu, color: '#c8ff3d' },
  thinking: { label: 'Razonamiento', icon: Lightbulb, color: '#ffd45e' },
  tool_call: { label: 'Herramienta MCP', icon: Wrench, color: '#5ee6ff' },
  tool_result: { label: 'Resultado', icon: CircleCheck, color: '#5ee6ff' },
  fallback: { label: 'Cambio de modelo', icon: Repeat, color: '#ff8f5e' },
  answer: { label: 'Respuesta', icon: Flag, color: '#5effb1' },
  memory_write: { label: 'Memoria guardada', icon: Save, color: '#b18cff' },
  error: { label: 'Error', icon: AlertTriangle, color: '#ff5e6c' },
  run_end: { label: 'Fin del run', icon: Flag, color: '#8b93a3' },
};

function summary(e: TraceEvent) {
  const d = e.data;
  switch (e.type) {
    case 'run_start': return <span className="mono">{d.model}</span>;
    case 'memory_recall': return d.items.length ? d.items.map((m: any) => <div key={m.id}>· {m.content}</div>) : 'Sin memorias relacionadas';
    case 'llm_call': return <span className="mono">paso {d.step} · {d.input_tokens}→{d.output_tokens} tok · {d.stop_reason}</span>;
    case 'thinking': return <div style={{ whiteSpace: 'pre-wrap' }}>{String(d.text).slice(0, 400)}</div>;
    case 'tool_call': return <pre>{JSON.stringify(d.input, null, 1)}</pre>;
    case 'tool_result': return <pre>{String(d.output).slice(0, 500)}</pre>;
    case 'memory_write': return `(${d.kind}) ${d.content}`;
    case 'error': return `${d.where}: ${d.message}`;
    case 'answer': return <span className="mono">{d.status}</span>;
    case 'run_end': return <span className="mono">{d.status} · {d.steps} pasos · {fmtUsd(d.cost_usd)}</span>;
    case 'fallback': return 'El servidor reenvió la solicitud a otro modelo';
    default: return null;
  }
}

function right(e: TraceEvent) {
  const d = e.data;
  if (e.type === 'llm_call' || e.type === 'tool_result' || e.type === 'run_end') return fmtMs(d.ms);
  if (e.type === 'tool_call') return d.name;
  return '';
}

export default function Timeline({ events }: { events: TraceEvent[] }) {
  return (
    <div>
      {events.map((e) => {
        const meta = EVENT_META[e.type] ?? { label: e.type, icon: Cpu, color: '#8b93a3' };
        const Icon = meta.icon;
        const isErr = e.type === 'error' || (e.type === 'tool_result' && e.data.is_error);
        return (
          <div className="tl-item" key={`${e.run_id}-${e.seq}`}>
            <span className="tl-icon" style={{ color: isErr ? '#ff5e6c' : meta.color }}><Icon size={12} /></span>
            <div className="tl-head">
              <b style={{ color: isErr ? '#ff5e6c' : undefined }}>{meta.label}</b>
              <span className="mono dim" style={{ fontSize: 11 }}>{right(e)}</span>
            </div>
            <div className="tl-body">{summary(e)}</div>
          </div>
        );
      })}
    </div>
  );
}
