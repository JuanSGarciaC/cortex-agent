import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { Brain, Database, FlaskConical, GitBranch, Home as HomeIcon, MessageSquare, Wrench } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { api } from './lib/api';
import Home from './pages/Home';
import Chat from './pages/Chat';
import Traces from './pages/Traces';
import Rag from './pages/Rag';
import MemoryPage from './pages/Memory';
import Evals from './pages/Evals';
import Tools from './pages/Tools';

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
  useEffect(() => {
    api.health().then((h) => setLlm(h.llm)).catch(() => setLlm(false));
  }, []);
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
        <span className={`status-dot ${llm ? 'on' : ''}`} title={llm ? 'API de Claude configurada' : 'Falta ANTHROPIC_API_KEY'} role="status" aria-label={llm ? 'API de Claude configurada' : 'Falta ANTHROPIC_API_KEY'} />
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/trazas" element={<Traces />} />
          <Route path="/rag" element={<Rag />} />
          <Route path="/memoria" element={<MemoryPage />} />
          <Route path="/evals" element={<Evals />} />
          <Route path="/herramientas" element={<Tools />} />
        </Routes>
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
