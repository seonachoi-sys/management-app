import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Users,
  Calculator,
  FlaskConical,
  ClipboardList,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { hasAccess } from '../../config/accessControl';
import './WelcomePage.css';

interface QuickAction {
  label: string;
  path: string;
  icon: React.ReactNode;
  iconBg: string;
  desc: string;
}

const PROJECT_ACTIONS: QuickAction[] = [
  {
    label: '수주현황',
    path: '/project/overview',
    icon: <BarChart3 size={20} />,
    iconBg: '#DBEAFE',
    desc: '진행중 과제 현황과 누적 수주금액을 확인합니다',
  },
  {
    label: '참여율관리',
    path: '/project/participation',
    icon: <Users size={20} />,
    iconBg: '#D1FAE5',
    desc: '연구원별 과제 참여율 및 3책5공 관리',
  },
  {
    label: '인건비증빙',
    path: '/project/payroll',
    icon: <Calculator size={20} />,
    iconBg: '#FEF3C7',
    desc: '급여대장 업로드 및 인건비 자동 산출',
  },
  {
    label: '시뮬레이터',
    path: '/project/simulator',
    icon: <FlaskConical size={20} />,
    iconBg: '#EDE9FE',
    desc: '신규과제 참여율 및 인건비 시뮬레이션',
  },
];

const TASK_ACTION: QuickAction = {
  label: '업무관리',
  path: '/tasks',
  icon: <ClipboardList size={20} />,
  iconBg: '#F1F5F9',
  desc: '팀 업무 칸반보드 및 일정 관리',
};

const WelcomePage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const displayName = user?.displayName
    || user?.email?.split('@')[0]
    || '사용자';

  const canAccessProject = hasAccess(user?.email, 'projectManagement');

  return (
    <div className="welcome-container">
      <div className="welcome-inner">
        {/* Header */}
        <div className="welcome-header">
          <div className="welcome-logo">TS</div>
          <h1 className="welcome-title">안녕하세요, {displayName}님</h1>
          <p className="welcome-subtitle">오늘은 어떤 업무를 할까요?</p>
        </div>

        {/* Project Actions (2x2) */}
        {canAccessProject && (
          <div className="welcome-grid">
            {PROJECT_ACTIONS.map((a) => (
              <div
                key={a.path}
                className="welcome-card"
                onClick={() => navigate(a.path)}
              >
                <div className="welcome-card-icon" style={{ background: a.iconBg }}>
                  {a.icon}
                </div>
                <div className="welcome-card-text">
                  <div className="welcome-card-label">{a.label}</div>
                  <div className="welcome-card-desc">{a.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Divider */}
        {canAccessProject && <div className="welcome-divider" />}

        {/* Task Action (full width) */}
        <div
          className="welcome-card welcome-card-full"
          onClick={() => navigate(TASK_ACTION.path)}
        >
          <div className="welcome-card-icon" style={{ background: TASK_ACTION.iconBg }}>
            {TASK_ACTION.icon}
          </div>
          <div className="welcome-card-text">
            <div className="welcome-card-label">{TASK_ACTION.label}</div>
            <div className="welcome-card-desc">{TASK_ACTION.desc}</div>
          </div>
        </div>

        {/* Footer */}
        <p className="welcome-footer">또는 사이드바에서 메뉴를 선택하세요</p>
      </div>
    </div>
  );
};

export default WelcomePage;
