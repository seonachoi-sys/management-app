import React, { useState, Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import LoginPage from './components/auth/LoginPage';
import ProtectedRoute from './components/auth/ProtectedRoute';
import Breadcrumb from './components/common/Breadcrumb';
import GlobalSearch from './components/common/GlobalSearch';
import { ToastProvider } from './components/common/Toast';
import { SaveIndicatorProvider } from './components/common/SaveIndicator';
import { useAuth } from './hooks/useAuth';
import './styles/designSystem.css';
import './App.css';

// Lazy load — 각 페이지를 별도 청크로 분리
const WelcomePage = lazy(() => import('./components/home/WelcomePage'));
const ProjectOverview = lazy(() => import('./components/project/ProjectOverview'));
const ParticipationManager = lazy(() => import('./components/project/ParticipationManager'));
const PayrollProof = lazy(() => import('./components/project/PayrollProof'));
const Simulator = lazy(() => import('./components/project/Simulator'));
const TaskDashboard = lazy(() => import('./task-manager/TaskDashboard'));
const SeedRunner = lazy(() => import('./scripts/SeedRunner'));

const PAGE_TITLES = {
  '/': '',
  '/project/overview': '수주현황',
  '/project/participation': '참여율관리',
  '/project/payroll': '인건비증빙',
  '/project/simulator': '시뮬레이터',
  '/tasks': '업무관리',
};

const Loading = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: 'var(--text-hint)', fontSize: 14 }}>
    로딩 중...
  </div>
);

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
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<WelcomePage />} />

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

              <Route path="/tasks" element={<TaskDashboard />} />
              <Route path="/seed" element={<SeedRunner />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
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
    <HashRouter>
      <ToastProvider>
        <SaveIndicatorProvider>
          <AuthGate />
        </SaveIndicatorProvider>
      </ToastProvider>
    </HashRouter>
  );
}

export default App;
