import React, { useState } from 'react';
import TaskDashboard from './task-manager/TaskDashboard';
import './App.css';

const CATEGORIES = [
  {
    id: 'project',
    label: '국책과제 관리',
    items: [
      { id: 'home', name: '홈', icon: '🏠', desc: '경영관리팀 업무 포탈' },
      {
        id: 'participation',
        name: '참여율 관리',
        icon: '📊',
        desc: '국책과제 참여율 대시보드',
        src: `${process.env.PUBLIC_URL}/dashboard.html`,
      },
      {
        id: 'funding',
        name: '자금 확보 현황',
        icon: '💰',
        desc: '누적 자금 확보 대시보드',
        src: `${process.env.PUBLIC_URL}/funding_dashboard.html`,
      },
      {
        id: 'payroll',
        name: '인건비 증빙',
        icon: '📄',
        desc: '인건비 증빙 생성기',
        src: `${process.env.PUBLIC_URL}/payroll.html`,
      },
      {
        id: 'simulator',
        name: '신규과제 시뮬레이터',
        icon: '🧪',
        desc: '현물 인건비 최적화 산출',
        src: `${process.env.PUBLIC_URL}/simulator.html`,
      },
    ],
  },
  {
    id: 'hr',
    label: '인사총무',
    items: [
      {
        id: 'task-manager',
        name: '업무관리',
        icon: '📋',
        desc: '업무 관리 / 일정 / 우선순위 / 회의록',
        component: 'TaskManager',
      },
    ],
  },
];

// flat lookup
const ALL_ITEMS = CATEGORIES.flatMap((c) => c.items);

function Home({ onNavigate }) {
  return (
    <div className="home">
      <div className="home-hero">
        <h2>경영관리팀 업무 포탈</h2>
        <p>(주)타이로스코프 국책과제 관리 시스템</p>
      </div>
      <div className="home-cards">
        {ALL_ITEMS.filter((t) => t.id !== 'home').map((tool) => (
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
      <iframe src={tool.src} title={tool.name} className="tool-iframe" />
    </div>
  );
}

function App() {
  const [activeId, setActiveId] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const activeTool = ALL_ITEMS.find((t) => t.id === activeId);

  const renderContent = () => {
    if (activeId === 'home') return <Home onNavigate={setActiveId} />;
    if (activeTool?.component === 'TaskManager') return <TaskDashboard />;
    if (activeTool?.src) return <ToolView tool={activeTool} />;
    return null;
  };

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">TS</div>
          {sidebarOpen && <span className="sidebar-title">경영관리팀</span>}
        </div>
        <nav className="sidebar-nav">
          {CATEGORIES.map((cat) => (
            <div key={cat.id} className="nav-category">
              {sidebarOpen && (
                <div className="nav-category-label">{cat.label}</div>
              )}
              {cat.items.map((tool) => (
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
            </div>
          ))}
        </nav>
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? '◀' : '▶'}
        </button>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <h1>
            {activeTool?.icon} {activeTool?.name}
          </h1>
          <span className="topbar-org">(주)타이로스코프</span>
        </header>
        <div className="content-area">{renderContent()}</div>
      </main>
    </div>
  );
}

export default App;
