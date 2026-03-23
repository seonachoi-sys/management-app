import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import TaskDashboard from './task-manager/TaskDashboard';
import ProjectOverview from './components/project/ProjectOverview';
import Sidebar from './components/layout/Sidebar';
import LoginPage from './components/auth/LoginPage';
import ProtectedRoute from './components/auth/ProtectedRoute';
import Breadcrumb from './components/common/Breadcrumb';
import GlobalSearch from './components/common/GlobalSearch';
import { ToastProvider } from './components/common/Toast';
import { SaveIndicatorProvider } from './components/common/SaveIndicator';
import WelcomePage from './components/home/WelcomePage';
import ParticipationManager from './components/project/ParticipationManager';
import PayrollProof from './components/project/PayrollProof';
import Simulator from './components/project/Simulator';
import SeedRunner from './scripts/SeedRunner';
import { useAuth } from './hooks/useAuth';
import './styles/designSystem.css';
import './App.css';

const PAGE_TITLES = {
  '/': '',
  '/project/overview': '수주현황',
  '/project/participation': '참여율관리',
  '/project/payroll': '인건비증빙',
  '/project/simulator': '시뮬레이터',
  '/tasks': '업무관리',
};

function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const location = useLocation();

  const pageTitle = PAGE_TITLES[location.pathname] || '';

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main className="main-content">
        {pageTitle !== '' && (
          <header className="topbar">
            <div className="topbar-left">
              <h1 className="topbar-title">{pageTitle}</h1>
              <Breadcrumb />
            </div>
            <span className="topbar-org">(주)타이로스코프</span>
          </header>
        )}
        <div className="content-area">
          <Routes>
            <Route path="/" element={<WelcomePage />} />

            {/* 국책과제 관리 — projectManagement 권한 필요 */}
            <Route
              path="/project/overview"
              element={
                <ProtectedRoute requiredAccess="projectManagement">
                  <ProjectOverview />
                </ProtectedRoute>
              }
            />
            <Route
              path="/project/participation"
              element={
                <ProtectedRoute requiredAccess="projectManagement">
                  <ParticipationManager />
                </ProtectedRoute>
              }
            />
            <Route
              path="/project/payroll"
              element={
                <ProtectedRoute requiredAccess="payrollAccess">
                  <PayrollProof />
                </ProtectedRoute>
              }
            />
            <Route
              path="/project/simulator"
              element={
                <ProtectedRoute requiredAccess="projectManagement">
                  <Simulator />
                </ProtectedRoute>
              }
            />

            {/* 업무관리 — 로그인만 하면 접근 가능 */}
            <Route path="/tasks" element={<TaskDashboard />} />

            {/* 시딩 (관리자 전용) */}
            <Route path="/seed" element={<SeedRunner />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
      <GlobalSearch />
    </div>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg-main)',
        color: 'var(--text-secondary)',
        fontSize: '14px',
      }}>
        로딩 중...
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <AppLayout />;
}

function App() {
  return (
    <BrowserRouter basename="/management-app">
      <ToastProvider>
        <SaveIndicatorProvider>
          <AuthGate />
        </SaveIndicatorProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
