import { lazy, Suspense, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { Brain, Database, FlaskConical, GitBranch, Home as HomeIcon, MessageSquare, Wrench } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { api } from './lib/api';

const Home = lazy(() => import('./pages/Home'));
const Chat = lazy(() => import('./pages/Chat'));
const Traces = lazy(() => import('./pages/Traces'));
const Rag = lazy(() => import('./pages/Rag'));
const MemoryPage = lazy(() => import('./pages/Memory'));
const Evals = lazy(() => import('./pages/Evals'));
const Tools = lazy(() => import('./pages/Tools'));

const NAV = [
  { to: '/', label: 'Inicio', icon: HomeIcon },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/trazas', label: 'Trazas', icon: GitBranch },
  { to: '/rag', label: 'Mapa RAG', icon: Database },
  { to: '/memoria', label: 'Memoria', icon: Brain },
  { to: '/evals', label: 'Evals', icon: FlaskConical },
  { to: '/herramientas', label: 'Herramientas MCP', icon: Wrench },
];

function Shell() {
  const [llm, setLlm] = useState<boolean | null>(null);
  const [model, setModel] = useState('');
  useEffect(() => {
    api.health().then((h) => { setLlm(h.llm); setModel(h.agent_model); }).catch(() => setLlm(false));
  }, []);
  const status = llm ? `Modelo: ${model}` : 'Sin modelo configurado';
  return (
    <div className="shell">
      <nav className="rail" aria-label="Principal">
        <div className="logo" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 32 32"><circle cx="16" cy="16" r="9" fill="none" stroke="#c8ff3d" strokeWidth="3" /><circle cx="16" cy="16" r="3" fill="#5ee6ff" /></svg>
        </div>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} aria-label={label}>
            <Icon size={20} />
            <span className="tip">{label}</span>
          </NavLink>
        ))}
        <div className="spacer" />
        <span className={`status-dot ${llm ? 'on' : ''}`} title={status} role="status" aria-label={status} />
      </nav>
      <main className="main">
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/trazas" element={<Traces />} />
            <Route path="/rag" element={<Rag />} />
            <Route path="/memoria" element={<MemoryPage />} />
            <Route path="/evals" element={<Evals />} />
            <Route path="/herramientas" element={<Tools />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

// No StrictMode: its dev double-mount makes SwarmCursor call loseContext() on the canvas it then reuses (white hero).
ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Shell />
  </BrowserRouter>,
);
