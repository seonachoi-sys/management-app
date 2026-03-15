import React, { useState } from 'react';
import './App.css';

// 카테고리별 폴더 구조
const CATEGORIES = [
  {
    id: 'project',
    name: '과제 관리',
    icon: '📁',
    items: [
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
    ],
  },
  {
    id: 'hr',
    name: '인사 / 총무',
    icon: '📁',
    items: [
      {
        id: 'payroll',
        name: '인건비 증빙',
        icon: '📄',
        desc: '인건비 증빙 생성기',
        src: `${process.env.PUBLIC_URL}/payroll.html`,
      },
      {
        id: 'tasks',
        name: '업무관리',
        icon: '📋',
        desc: '업무관리 대시보드',
        src: `${process.env.PUBLIC_URL}/tasks.html`,
      },
    ],
  },
  {
    id: 'sales',
    name: '매출 / 청구',
    icon: '📁',
    items: [
      {
        id: 'billing',
        name: '매출청구 관리',
        icon: '💳',
        desc: '병원 매출청구 및 거래명세서',
        src: 'https://seonachoi-sys.github.io/billing-app/',
      },
    ],
  },
];

// 모든 도구 플랫 목록 (홈 카드용)
const ALL_TOOLS = CATEGORIES.flatMap((cat) => cat.items);

function Home({ onNavigate }) {
  return (
    <div className="home">
      <div className="home-hero">
        <h2>경영관리팀 업무 포탈</h2>
        <p>(주)타이로스코프 경영관리 시스템</p>
      </div>

      {/* 카테고리별 카드 */}
      {CATEGORIES.map((cat) => (
        <div key={cat.id} className="home-category">
          <h3 className="home-category-title">{cat.icon} {cat.name}</h3>
          <div className="home-cards">
            {cat.items.map((tool) => (
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
        </div>
      ))}

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
  const [openFolders, setOpenFolders] = useState(['project', 'hr', 'sales']);

  const activeTool = ALL_TOOLS.find((t) => t.id === activeId);

  const toggleFolder = (catId) => {
    setOpenFolders((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  };

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">TS</div>
          {sidebarOpen && <span className="sidebar-title">경영관리팀</span>}
        </div>
        <nav className="sidebar-nav">
          {/* 홈 */}
          <button
            className={`nav-item ${activeId === 'home' ? 'active' : ''}`}
            onClick={() => setActiveId('home')}
            title="홈"
          >
            <span className="nav-icon">🏠</span>
            {sidebarOpen && <span className="nav-label">홈</span>}
          </button>

          {/* 카테고리 폴더 */}
          {CATEGORIES.map((cat) => (
            <div key={cat.id} className="nav-folder">
              <button
                className="nav-folder-header"
                onClick={() => toggleFolder(cat.id)}
                title={cat.name}
              >
                <span className="nav-folder-arrow">
                  {openFolders.includes(cat.id) ? '▾' : '▸'}
                </span>
                {sidebarOpen && <span className="nav-folder-name">{cat.name}</span>}
              </button>
              {openFolders.includes(cat.id) && (
                <div className="nav-folder-items">
                  {cat.items.map((tool) => (
                    <button
                      key={tool.id}
                      className={`nav-item nav-sub-item ${activeId === tool.id ? 'active' : ''}`}
                      onClick={() => setActiveId(tool.id)}
                      title={tool.name}
                    >
                      <span className="nav-icon">{tool.icon}</span>
                      {sidebarOpen && <span className="nav-label">{tool.name}</span>}
                    </button>
                  ))}
                </div>
              )}
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
          <h1>{activeId === 'home' ? '🏠 홈' : `${activeTool?.icon} ${activeTool?.name}`}</h1>
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
