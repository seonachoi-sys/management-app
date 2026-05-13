import React from 'react';
import { useLocation } from 'react-router-dom';
import './Breadcrumb.css';

const ROUTE_LABELS: Record<string, { parent?: string; label: string }> = {
  '/project/overview': { parent: '국책과제 관리', label: '수주현황' },
  '/project/participation': { parent: '국책과제 관리', label: '참여율관리' },
  '/project/payroll': { parent: '국책과제 관리', label: '인건비증빙' },
  '/project/simulator': { parent: '국책과제 관리', label: '시뮬레이터' },
  '/tasks': { parent: '인사총무', label: '업무관리' },
};

const Breadcrumb: React.FC = () => {
  const location = useLocation();
  const route = ROUTE_LABELS[location.pathname];

  if (!route) return null;

  return (
    <nav className="breadcrumb">
      {route.parent && (
        <>
          <span className="breadcrumb-parent">{route.parent}</span>
          <span className="breadcrumb-sep">/</span>
        </>
      )}
      <span className="breadcrumb-current">{route.label}</span>
    </nav>
  );
};

export default Breadcrumb;
