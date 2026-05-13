import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Home, BarChart3, Users, Calculator, FlaskConical, ClipboardList,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, LogOut,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { hasAccess } from '../../config/accessControl';
import './Sidebar.css';

interface MenuItem { name: string; path: string; icon: React.ReactNode; }
interface MenuCategory { id: string; label: string; requiredAccess?: 'projectManagement' | 'payrollAccess'; items: MenuItem[]; }

const MENU: MenuCategory[] = [
  {
    id: 'project', label: '국책과제 관리', requiredAccess: 'projectManagement',
    items: [
      { name: '수주현황', path: '/project/overview', icon: <BarChart3 size={18} /> },
      { name: '참여율관리', path: '/project/participation', icon: <Users size={18} /> },
      { name: '인건비증빙', path: '/project/payroll', icon: <Calculator size={18} /> },
      { name: '시뮬레이터', path: '/project/simulator', icon: <FlaskConical size={18} /> },
    ],
  },
  {
    id: 'hr', label: '인사총무',
    items: [
      { name: '업무관리', path: '/tasks', icon: <ClipboardList size={18} /> },
    ],
  },
];

function loadExpandState(): Record<string, boolean> {
  try {
    const saved = localStorage.getItem('sidebar-expand');
    return saved ? JSON.parse(saved) : {};
  } catch { return {}; }
}

function saveExpandState(state: Record<string, boolean>) {
  localStorage.setItem('sidebar-expand', JSON.stringify(state));
}

// ═══ 접기/펼치기 카테고리 ═══
function CollapsibleCategory({ cat, collapsed, location }: {
  cat: MenuCategory; collapsed: boolean; location: ReturnType<typeof useLocation>;
}) {
  const hasActivePath = cat.items.some(item => location.pathname.startsWith(item.path));
  const savedState = loadExpandState();
  const [expanded, setExpanded] = useState(savedState[cat.id] !== undefined ? savedState[cat.id] : true);

  // 활성 메뉴가 하위에 있으면 자동 펼침
  useEffect(() => {
    if (hasActivePath && !expanded) {
      setExpanded(true);
      const ns = { ...loadExpandState(), [cat.id]: true };
      saveExpandState(ns);
    }
  }, [hasActivePath, cat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    const ns = { ...loadExpandState(), [cat.id]: next };
    saveExpandState(ns);
  };

  return (
    <div className="sidebar-new-category">
      {!collapsed ? (
        <div className="sidebar-new-category-label" onClick={toggle}>
          <span>{cat.label}</span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      ) : (
        <div className="sidebar-new-category-label collapsed-dot" title={cat.label} />
      )}
      {(collapsed || expanded) && (
        <div className="sidebar-cat-items">
          {cat.items.map((item) => (
            <NavLink key={item.path} to={item.path}
              className={({ isActive }) => `sidebar-new-item ${isActive ? 'active' : ''}`}
              title={item.name}>
              <span className="sidebar-new-icon">{item.icon}</span>
              {!collapsed && <span className="sidebar-new-label">{item.name}</span>}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ 메인 ═══
interface SidebarProps { collapsed: boolean; onToggle: () => void; }

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle }) => {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const userEmail = user?.email;

  const visibleMenu = MENU.filter(cat => {
    if (!cat.requiredAccess) return true;
    return hasAccess(userEmail, cat.requiredAccess);
  });

  const initials = user?.displayName
    ? user.displayName.charAt(0)
    : (user?.email?.charAt(0) || '?').toUpperCase();

  return (
    <aside className={`sidebar-new ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-new-header">
        <div className="sidebar-new-logo">TS</div>
        {!collapsed && <span className="sidebar-new-title">경영관리팀</span>}
      </div>

      <nav className="sidebar-new-nav">
        <NavLink to="/" end className={({ isActive }) => `sidebar-new-item ${isActive ? 'active' : ''}`} title="홈">
          <span className="sidebar-new-icon"><Home size={18} /></span>
          {!collapsed && <span className="sidebar-new-label">홈</span>}
        </NavLink>

        {visibleMenu.map(cat => (
          <CollapsibleCategory key={cat.id} cat={cat} collapsed={collapsed} location={location} />
        ))}
      </nav>

      <div className="sidebar-new-footer">
        {user && (
          <div className="sidebar-new-user">
            <div className="sidebar-new-avatar">{initials}</div>
            {!collapsed && (
              <>
                <span className="sidebar-new-username">{user.displayName || user.email}</span>
                <button className="sidebar-new-logout" onClick={signOut} title="로그아웃"><LogOut size={15} /></button>
              </>
            )}
          </div>
        )}
        <button className="sidebar-new-toggle" onClick={onToggle}>
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
