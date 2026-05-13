import React, { useState } from 'react';
import { CheckCircle, Lock, Unlock, AlertTriangle, X } from 'lucide-react';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { logAction } from '../../services/auditService';
import { useAuth } from '../../hooks/useAuth';
import './MonthlyStatusManager.css';

export type MonthlyStatus = '작업중' | '확정' | '잠금';

interface UploadFlags {
  payroll: boolean;
  health: boolean;
  employment: boolean;
  accident: boolean;
}

interface Props {
  yearMonth: string;
  status: MonthlyStatus;
  uploadFlags: UploadFlags;
  onStatusChange: (newStatus: MonthlyStatus) => void;
}

// ═══ 확정 체크리스트 모달 ═══
function ConfirmModal({ yearMonth, uploadFlags, onConfirm, onClose }: {
  yearMonth: string; uploadFlags: UploadFlags;
  onConfirm: () => void; onClose: () => void;
}) {
  const [checks, setChecks] = useState({
    payroll: uploadFlags.payroll,
    health: uploadFlags.health,
    employment: uploadFlags.employment,
    accident: uploadFlags.accident,
    changesReviewed: false,
    laborConfirmed: false,
  });

  const toggle = (key: keyof typeof checks) => setChecks(prev => ({ ...prev, [key]: !prev[key] }));
  const allChecked = Object.values(checks).every(Boolean);

  const items = [
    { key: 'payroll' as const, label: '급여대장 업로드됨', auto: uploadFlags.payroll },
    { key: 'health' as const, label: '건강보험 고지서 업로드됨', auto: uploadFlags.health },
    { key: 'employment' as const, label: '고용보험 고지서 업로드됨', auto: uploadFlags.employment },
    { key: 'accident' as const, label: '산재보험 고지서 업로드됨', auto: uploadFlags.accident },
    { key: 'changesReviewed' as const, label: '전월 대비 변동사항 확인됨', auto: false },
    { key: 'laborConfirmed' as const, label: '인건비 산출 결과 확인됨', auto: false },
  ];

  return (
    <div className="msm-overlay" onClick={onClose}>
      <div className="msm-modal" onClick={e => e.stopPropagation()}>
        <div className="msm-modal-header">
          <h3>{yearMonth} 데이터 확정</h3>
          <button className="msm-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="msm-modal-body">
          <p className="msm-desc">아래 항목을 모두 확인한 후 확정하세요.</p>
          <div className="msm-checklist">
            {items.map(item => (
              <label key={item.key} className={`msm-check-item ${checks[item.key] ? 'checked' : ''}`}>
                <input type="checkbox" checked={checks[item.key]}
                  onChange={() => toggle(item.key)} disabled={item.auto && checks[item.key]} />
                <span>{item.label}</span>
                {!checks[item.key] && item.auto === false && <span className="msm-required">수동 확인 필요</span>}
                {item.auto && checks[item.key] && <span className="msm-auto">자동</span>}
              </label>
            ))}
          </div>
        </div>
        <div className="msm-modal-actions">
          <button className="btn-secondary" onClick={onClose}>취소</button>
          <button className="btn-primary" onClick={onConfirm} disabled={!allChecked}>
            <CheckCircle size={14} /> 확정
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══ 메인 ═══
const MonthlyStatusManager: React.FC<Props> = ({ yearMonth, status, uploadFlags, onStatusChange }) => {
  const { user } = useAuth();
  const [showConfirm, setShowConfirm] = useState(false);
  const [processing, setProcessing] = useState(false);

  const updateStatus = async (newStatus: MonthlyStatus) => {
    setProcessing(true);
    const docRef = doc(db, 'monthlyData', yearMonth);
    await setDoc(docRef, {
      status: newStatus,
      [`${newStatus}At`]: Timestamp.now(),
      [`${newStatus}By`]: user?.email || '',
    }, { merge: true });
    await logAction('status_change', 'monthlyData', yearMonth, 'status', status, newStatus, user?.email || '');
    onStatusChange(newStatus);
    setProcessing(false);
  };

  const handleConfirm = async () => {
    await updateStatus('확정');
    setShowConfirm(false);
  };

  const handleLock = async () => {
    await updateStatus('잠금');
  };

  const handleUnlock = async () => {
    if (!window.confirm('정말 잠금을 해제하시겠습니까?\n해제 사유가 감사 로그에 기록됩니다.')) return;
    await updateStatus('작업중');
  };

  return (
    <div className="msm-container">
      <div className="msm-status-bar">
        <div className={`msm-badge ${status}`}>
          {status === '작업중' && '📝 작업중'}
          {status === '확정' && '✅ 확정됨'}
          {status === '잠금' && '🔒 잠금됨'}
        </div>

        <div className="msm-actions">
          {status === '작업중' && (
            <button className="btn-primary msm-btn" onClick={() => setShowConfirm(true)} disabled={processing}>
              <CheckCircle size={14} /> 데이터 확정
            </button>
          )}
          {status === '확정' && (
            <>
              <button className="btn-secondary msm-btn" onClick={() => updateStatus('작업중')} disabled={processing}>
                확정 취소
              </button>
              <button className="btn-primary msm-btn" onClick={handleLock} disabled={processing}>
                <Lock size={14} /> 잠금
              </button>
            </>
          )}
          {status === '잠금' && (
            <button className="btn-secondary msm-btn msm-unlock" onClick={handleUnlock} disabled={processing}>
              <Unlock size={14} /> 잠금 해제
            </button>
          )}
        </div>
      </div>

      {status === '잠금' && (
        <div className="msm-lock-warning">
          <Lock size={14} /> 이 달의 데이터는 잠금 상태입니다. 수정하려면 잠금을 해제하세요.
        </div>
      )}

      {showConfirm && (
        <ConfirmModal
          yearMonth={yearMonth}
          uploadFlags={uploadFlags}
          onConfirm={handleConfirm}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
};

export default MonthlyStatusManager;
