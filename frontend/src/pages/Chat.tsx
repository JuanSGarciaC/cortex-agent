import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Activity, ArrowUp, KeyRound, MessageSquare, Plus, Sparkles, Trash2 } from 'lucide-react';
import Timeline from '../components/Timeline';
import { api, fmtUsd, streamChat, type TraceEvent } from '../lib/api';

type Turn = { run_id?: number; question: string; answer: string; status: string };

const SUGGESTIONS = [
  '¿Cuántos días de vacaciones tengo si llevo 7 años?',
  'Voy a Cali dos días, ¿cuánto me reconocen de alimentación?',
  'Se cayó el sistema de despachos un domingo, ¿a quién llamo?',
  'Recuerda que prefiero respuestas en viñetas',
];

// [12] in an answer is a chunk citation: render it as a chip.
const withCitations = (text: string) => text.replace(/\[(\d{1,6})\]/g, '[$1](#chunk-$1)');

function Answer({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        components={{
          a: ({ href, children }) =>
            href?.startsWith('#chunk-') ? <span className="cite" title={`Fragmento ${href.slice(7)}`}>{children}</span> : <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>{children}</a>,
        }}
      >
        {withCitations(text)}
      </ReactMarkdown>
    </div>
  );
}

export default function Chat() {
  const [convs, setConvs] = useState<{ id: number; title: string }[]>([]);
  const [convId, setConvId] = useState<number | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [llm, setLlm] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<HTMLDivElement>(null);

  const refreshConvs = () => api.conversations().then(setConvs).catch(() => {});
  useEffect(() => {
    refreshConvs();
    api.health().then((h) => setLlm(h.llm)).catch(() => {});
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns]);
  useEffect(() => { tlRef.current?.scrollTo({ top: tlRef.current.scrollHeight, behavior: "smooth" }); }, [events]);

  async function open(id: number) {
    if (busy) return;
    setConvId(id);
    setError('');
    const conv = await api.conversation(id);
    setTurns(conv.turns);
    const last = conv.turns[conv.turns.length - 1];
    setEvents(last?.run_id ? (await api.runEvents(last.run_id)).events : []);
  }

  function reset() {
    if (busy) return;
    setConvId(null);
    setTurns([]);
    setEvents([]);
    setError('');
  }

  async function remove(id: number) {
    await api.deleteConversation(id);
    if (id === convId) reset();
    refreshConvs();
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setError('');
    setBusy(true);
    setEvents([]);
    setTurns((t) => [...t, { question: message, answer: '', status: 'running' }]);
    try {
      await streamChat(message, convId, (e) => {
        setEvents((prev) => [...prev, e]);
        if (e.type === 'run_start') setConvId(e.data.conversation_id);
        if (e.type === 'answer' || (e.type === 'error' && e.data.where === 'harness')) {
          const answer = e.type === 'answer' ? e.data.text : e.data.message;
          const status = e.type === 'answer' ? e.data.status : 'error';
          setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, answer, status, run_id: e.run_id } : turn)));
        }
      });
    } catch (err) {
      setError((err as Error).message);
      setTurns((t) => t.slice(0, -1));
      setInput(message);
    } finally {
      setBusy(false);
      refreshConvs();
    }
  }

  const end = events.find((e) => e.type === 'run_end');

  return (
    <div className="chat">
      <aside className="chat-list">
        <button className="btn primary" style={{ width: '100%', marginBottom: 14 }} onClick={reset} disabled={busy}>
          <Plus size={16} /> Nueva conversación
        </button>
        {convs.map((c) => (
          <div key={c.id} className={`item ${c.id === convId ? 'active' : ''}`} onClick={() => open(c.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(c.id)}>
            <MessageSquare size={14} />
            <span>{c.title}</span>
            <button className="btn ghost icon danger" aria-label="Borrar conversación" onClick={(e) => { e.stopPropagation(); remove(c.id); }}><Trash2 size={13} /></button>
          </div>
        ))}
        {!convs.length && <p className="dim" style={{ fontSize: 12, padding: 8 }}>Aún no hay conversaciones.</p>}
      </aside>

      <section className="chat-main">
        <div className="messages">
          {!llm && (
            <div className="notice"><KeyRound size={16} /> Falta ANTHROPIC_API_KEY en backend/.env. El RAG, la memoria y las herramientas funcionan; el chat necesita la key.</div>
          )}
          {!turns.length && (
            <div className="empty" style={{ marginTop: '12vh' }}>
              <Sparkles size={34} color="#c8ff3d" />
              <h2 style={{ color: 'var(--text)' }}>Pregúntale a tu base de conocimiento</h2>
              <p style={{ maxWidth: 460, margin: 0 }}>El agente busca en tus documentos por MCP, cita los fragmentos y recuerda lo que le pidas. A la derecha ves cada paso en vivo.</p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <div className="msg user">{t.question}</div>
              <div className="msg bot">
                <div className="who">
                  <Sparkles size={13} color="#c8ff3d" /> cortex
                  {t.status !== 'ok' && t.status !== 'running' && <span className={`chip ${t.status === 'error' ? 'danger' : ''}`}>{t.status}</span>}
                </div>
                {t.status === 'running' && !t.answer ? (
                  <div className="thinking-dots" aria-label="Pensando"><span /><span /><span /></div>
                ) : t.status === 'error' ? (
                  <div className="error-box">{t.answer}</div>
                ) : (
                  <Answer text={t.answer} />
                )}
              </div>
            </div>
          ))}
          {error && <div className="error-box">{error}</div>}
          <div ref={endRef} />
        </div>
        <div className="composer">
          <form onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <label htmlFor="msg" className="sr-only">Mensaje</label>
            <textarea
              id="msg" className="textarea" rows={1} placeholder="Escribe una pregunta..." value={input} maxLength={8000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            />
            <button className="btn primary icon" type="submit" disabled={busy || !input.trim()} aria-label="Enviar"><ArrowUp size={18} /></button>
          </form>
        </div>
      </section>

      <aside className="trace-panel" aria-label="Traza en vivo">
        <header>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 className="row" style={{ fontSize: 15 }}><Activity size={16} color="#c8ff3d" /> Traza en vivo</h3>
            {busy && <span className="chip accent">corriendo</span>}
          </div>
          {end && (
            <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
              <span className="chip">{end.data.steps} pasos</span>
              <span className="chip">{end.data.input_tokens + end.data.output_tokens} tok</span>
              <span className="chip accent">{fmtUsd(end.data.cost_usd)}</span>
            </div>
          )}
        </header>
        <div className="timeline" ref={tlRef}>
          {events.length ? <Timeline events={events} /> : <p className="dim" style={{ fontSize: 12 }}>Los eventos del run aparecen aquí mientras el agente trabaja.</p>}
        </div>
      </aside>
    </div>
  );
}
