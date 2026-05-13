import React from 'react';
import { useNavigate } from 'react-router-dom';

const AccessDenied: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: '16px',
      padding: '32px',
    }}>
      <div style={{
        width: '64px',
        height: '64px',
        borderRadius: '50%',
        background: '#FEE2E2',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '28px',
      }}>
        🔒
      </div>
      <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
        접근 권한이 없습니다
      </h2>
      <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0, textAlign: 'center' }}>
        이 페이지에 접근하려면 관리자에게 문의하세요.
      </p>
      <button
        className="btn-primary"
        onClick={() => navigate('/tasks')}
        style={{ marginTop: '8px' }}
      >
        업무관리로 이동
      </button>
    </div>
  );
};

export default AccessDenied;
