import React, { useState } from 'react';
import './App.css';

const TOOLS = [
  {
    id: 'home',
    name: '홈',
    icon: '\u{1F3E0}',
    desc: '경영관리팀 업무 포탈',
  },
  {
    id: 'participation',
    name: '참여율 관리',
    icon: '\u{1F4CA}',
    desc: '국책과제 참여율 대시보드',
    src: `${process.env.PUBLIC_URL}/dashboard.html`,
  },
  {
    id: 'funding',
    name: '자금 확보 현황',
    icon: '\u{1F4B0}',
    desc: '누적 자금 확보 대시보드',
    src: `${process.env.PUBLIC_URL}/funding_dashboard.html`,
  },
  {
    id: 'payroll',
    name: '인건비 증빙',
    icon: '\u{1F4C4}',
    desc: '인건비 증빙 생성기',
    src: `${process.env.PUBLIC_URL}/payroll.html`,
  },
  {
    id: 'tasks',
    name: '업무관리',
    icon: '\u{1F4CB}',
    desc: '업무관리 대시보드',
    src: `${process.env.PUBLIC_URL}/tasks.html`,
  },
];

function Home({ onNavigate }) {
  return (
    <div className="home">
      <div className="home-hero">
        <h2>경영관리팀 업무 포탈</h2>
        <p>(주)타이로스코프 국책과제 관리 시스템</p>
      </div>
      <div className="home-cards">
        {TOOLS.filter((t) => t.id !== 'home').map((tool) => (
          <div
            key={tool.id}
            className="home-card"
            onClick={() => onNavigate(tool.id)}
          >
            <div className="home-card-icon">{tool.icon}</div>
            <div className="home-card-info">
              <h3>{tool.name}</h3>
              <p>{tool.desc}</p>
            </div>
            <div className="home-card-arrow">&rarr;</div>
          </div>
        ))}
      </div>
      <div className="home-summary">
        <div className="summary-box">
          <div className="summary-label">관리 과제</div>
          <div className="summary-value">4개 과제</div>
          <div className="summary-sub">AI빅테크 / 의료데이터 / 바이오코어 / 인재성장</div>
        </div>
        <div className="summary-box">
          <div className="summary-label">관리 인원</div>
          <div className="summary-value">30명</div>
          <div className="summary-sub">임원 4명 / 직원 26명</div>
        </div>
        <div className="summary-box">
          <div className="summary-label">관리 연도</div>
          <div className="summary-value">2026~2027</div>
          <div className="summary-sub">연간 참여율 및 인건비</div>
        </div>
      </div>
    </div>
  );
}

function ToolView({ tool }) {
  return (
    <div className="tool-view">
      <iframe
        src={tool.src}
        title={tool.name}
        className="tool-iframe"
      />
    </div>
  );
}

function App() {
  const [activeId, setActiveId] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const activeTool = TOOLS.find((t) => t.id === activeId);

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">TS</div>
          {sidebarOpen && <span className="sidebar-title">경영관리팀</span>}
        </div>
        <nav className="sidebar-nav">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              className={`nav-item ${activeId === tool.id ? 'active' : ''}`}
              onClick={() => setActiveId(tool.id)}
              title={tool.name}
            >
              <span className="nav-icon">{tool.icon}</span>
              {sidebarOpen && <span className="nav-label">{tool.name}</span>}
            </button>
          ))}
        </nav>
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? '\u25C0' : '\u25B6'}
        </button>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <h1>{activeTool?.icon} {activeTool?.name}</h1>
          <span className="topbar-org">(주)타이로스코프</span>
        </header>
        <div className="content-area">
          {activeId === 'home' ? (
            <Home onNavigate={setActiveId} />
          ) : (
            <ToolView tool={activeTool} />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
