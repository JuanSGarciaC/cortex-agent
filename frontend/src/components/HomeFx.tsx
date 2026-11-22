// Home page effects: split text (B1), count-up (A7), reveal + stagger (A1/A2) and a simulated trace (A2 + B2).
// Every effect falls back to the final, static content with prefers-reduced-motion or without IntersectionObserver.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MessageSquare, RotateCcw } from 'lucide-react';
import Timeline from './Timeline';
import type { TraceEvent } from '../lib/api';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const canAnimate = () => !reducedMotion() && 'IntersectionObserver' in window;

/** True once the element has entered the viewport (or right away when we can't or shouldn't animate). */
export function useInView<T extends Element>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => !canAnimate());
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

/** B1: words rise one after another. Screen readers get the plain text through aria-label. */
export function SplitText({ parts, className }: { parts: { text: string; className?: string }[]; className?: string }) {
  let i = 0;
  return (
    <h1 className={`split ${className ?? ''}`} aria-label={parts.map((p) => p.text).join(' ')}>
      {parts.map((p, pi) => (
        <span key={pi} className={p.className} aria-hidden>
          {p.text.split(' ').map((w, wi) => (
            <span key={wi} className="word" style={{ animationDelay: `${0.08 * i++}s` }}>{w}{' '}</span>
          ))}
        </span>
      ))}
    </h1>
  );
}

/** A7: counts from 0 to `value` once, with ease-out. */
export function CountUp({ value, format = (n) => String(Math.round(n)), ms = 1200 }: { value: number; format?: (n: number) => string; ms?: number }) {
  const [n, setN] = useState(() => (reducedMotion() ? value : 0));
  useEffect(() => {
    if (reducedMotion()) { setN(value); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setN(value * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <b className="tnum">{format(n)}</b>;
}

/** A1 + A2: children with the `.reveal-item` class rise in sequence when the wrapper enters the viewport. */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.12);
  // `pending` hides items only while JS is waiting to animate them; without it everything is visible.
  const [armed] = useState(canAnimate);
  return <div ref={ref} className={`${className} ${armed ? (seen ? 'revealed' : 'pending') : ''}`}>{children}</div>;
}

// Simulated run of the dataset question a01. Shape and answer match a real Gemini run
// (docs/evidencias/latencia-chat-gemini.txt); tokens and per-step times are illustrative.
const QUESTION = '¿Cuántos días de vacaciones tengo si llevo 7 años en la empresa?';
const ANSWER = 'Según la política de vacaciones, tienes 15 días hábiles base, más un día por cada año trabajado después del quinto. Con 7 años te corresponden 17 días hábiles [politica-vacaciones].';
const ev = (seq: number, type: string, data: Record<string, any>): TraceEvent => ({ run_id: 0, seq, type, data, ts: 0 });
const EVENTS: TraceEvent[] = [
  ev(1, 'run_start', { model: 'gemini-3.6-flash' }),
  ev(2, 'memory_recall', { items: [{ id: 1, content: 'Trabaja en Andes Logística' }] }),
  ev(3, 'llm_call', { step: 1, input_tokens: 1840, output_tokens: 42, stop_reason: 'tool_use', ms: 2100 }),
  ev(4, 'tool_call', { name: 'rag_search', input: { query: 'días de vacaciones por antigüedad' } }),
  ev(5, 'tool_result', { output: '[politica-vacaciones] 15 días hábiles por año… después del quinto año, un día adicional por año hasta un máximo de 20.', ms: 180 }),
  ev(6, 'llm_call', { step: 2, input_tokens: 2410, output_tokens: 96, stop_reason: 'end_turn', ms: 6200 }),
  ev(7, 'answer', { status: 'ok' }),
];
const STEP_MS = 650;

/** A2 + B2: the trace fills in step by step, then the answer is typed without shifting the layout. */
export function TraceDemo() {
  const [ref, seen] = useInView<HTMLDivElement>(0.35);
  const [run, setRun] = useState(0);
  const [shown, setShown] = useState(0);
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    if (!seen) return;
    if (reducedMotion()) { setShown(EVENTS.length); setTyped(ANSWER.length); return; }
    setShown(0); setTyped(0);
    const timers: number[] = EVENTS.map((_, i) => window.setTimeout(() => setShown(i + 1), 300 + i * STEP_MS));
    let raf = 0, t0 = 0;
    const type = (t: number) => {
      t0 ||= t;
      const n = Math.min(ANSWER.length, Math.floor((t - t0) / 18));
      setTyped(n);
      if (n < ANSWER.length) raf = requestAnimationFrame(type);
    };
    timers.push(window.setTimeout(() => { raf = requestAnimationFrame(type); }, 300 + EVENTS.length * STEP_MS));
    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(raf); };
  }, [seen, run]);

  const done = typed >= ANSWER.length;
  return (
    <div ref={ref} className="trace-demo">
      <div className="td-chat card">
        <div className="msg user">{QUESTION}</div>
        <div className="msg bot">
          <div className="who"><MessageSquare size={13} /> cortex</div>
          <p className="td-answer">
            <span className="sr-only">{ANSWER}</span>
            <span aria-hidden>{ANSWER.slice(0, typed)}{!done && typed > 0 && <i className="caret" />}</span>
            <span aria-hidden className="ghost">{ANSWER.slice(typed)}</span>
          </p>
        </div>
        <button className="btn ghost td-replay" onClick={() => setRun((r) => r + 1)} disabled={!done} aria-label="Repetir la traza">
          <RotateCcw size={14} /> Repetir
        </button>
      </div>
      <div className="td-trace card" aria-live="off">
        <div className="mono dim td-label">traza simulada · 2 pasos · 1 llamada MCP</div>
        {/* The invisible full copy reserves the final height so the page below doesn't shift as steps appear. */}
        <div className="td-stack">
          <div aria-hidden className="ghost"><Timeline events={EVENTS} /></div>
          <Timeline events={EVENTS.slice(0, shown)} />
        </div>
      </div>
    </div>
  );
}
