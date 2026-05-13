import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Employee, Project, YearlyParticipation } from '../../types/project';
import { doc, setDoc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../hooks/useAuth';
import './EmployeeDetailPanel.css';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function isExcludedProject(p: Project): boolean {
  const r = (p.excludeReason || '').toLowerCase();
  return r.includes('6개월') || r.includes('5천만') || r.includes('기획') || r.includes('평가');
}

interface Props {
  employee: Employee;
  data: YearlyParticipation[];
  projects: Project[];
  year: number;
  onClose: () => void;
}

const EmployeeDetailPanel: React.FC<Props> = ({ employee, data, projects, year, onClose }) => {
  const { user } = useAuth();
  const empData = data.filter(d => d.employeeName === employee.name);
  const [memo, setMemo] = useState('');
  const [memoLoaded, setMemoLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // 메모 로드
  React.useEffect(() => {
    const loadMemo = async () => {
      const snap = await getDoc(doc(db, 'employeeMemos', employee.employeeNumber));
      if (snap.exists()) setMemo(snap.data().memo || '');
      setMemoLoaded(true);
    };
    loadMemo();
  }, [employee.employeeNumber]);

  const saveMemo = async () => {
    setSaving(true);
    await setDoc(doc(db, 'employeeMemos', employee.employeeNumber), {
      employeeId: employee.employeeNumber,
      name: employee.name,
      memo,
      updatedAt: Timestamp.now(),
      updatedBy: user?.email || '',
    });
    setSaving(false);
  };

  // 3책5공
  const monthKey = String(new Date().getMonth() + 1);
  const activeParts = empData.filter(d => (d.monthlyRates[monthKey] || 0) > 0);
  const respCount = activeParts.filter(d => d.role === '책임연구원').length;
  const coCount = activeParts.filter(d => d.role === '연구원').length;
  const respExcl = activeParts.filter(d => {
    if (d.role !== '책임연구원') return false;
    const proj = projects.find(p => p.projectId === d.projectId);
    return proj ? isExcludedProject(proj) : false;
  }).length;

  // 월별 총 참여율 (바 차트용)
  const monthlyTotals = MONTHS.map(m => {
    const mk = String(m);
    return empData.reduce((s, d) => s + (d.monthlyRates[mk] || 0), 0);
  });
  const maxTotal = Math.max(...monthlyTotals, 100);

  return (
    <div className="edp-overlay" onClick={onClose}>
      <div className="edp-panel" onClick={e => e.stopPropagation()}>
        <div className="edp-header">
          <div>
            <h3>{employee.name}</h3>
            <span className="edp-sub">{employee.position} · {employee.department}</span>
          </div>
          <button className="edp-close" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="edp-body">
          {/* 3책5공 */}
          <div className="edp-section">
            <h4>3책5공 현황</h4>
            <div className="edp-badges">
              <span className={`edp-badge ${respCount - respExcl > 3 ? 'danger' : ''}`}>
                책임연구원 {respCount - respExcl}/3개 과제
                {respExcl > 0 && <span className="edp-excl"> (제외 {respExcl})</span>}
              </span>
              <span className={`edp-badge ${coCount > 5 ? 'danger' : ''}`}>
                공동연구원 {coCount}/5개 과제
              </span>
            </div>
          </div>

          {/* 과제별 참여 */}
          <div className="edp-section">
            <h4>{year}년 과제별 참여 현황</h4>
            {empData.length === 0 ? (
              <p className="edp-empty">참여 과제 없음</p>
            ) : (
              <div className="edp-projects">
                {empData.map(d => {
                  const proj = projects.find(p => p.projectId === d.projectId);
                  const vals = Object.values(d.monthlyRates).filter(v => v > 0);
                  const avg = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
                  return (
                    <div key={d.id} className="edp-proj-item">
                      <div className="edp-proj-name">{proj?.shortName || d.projectId}</div>
                      <span className="edp-proj-role">{d.role}</span>
                      <span className="edp-proj-avg">평균 {avg}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 월별 차트 */}
          <div className="edp-section">
            <h4>월별 참여율 합계</h4>
            <div className="edp-chart">
              {MONTHS.map((m, i) => {
                const total = monthlyTotals[i];
                const h = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
                const isOver = total > 100;
                return (
                  <div key={m} className="edp-bar-col">
                    <div className="edp-bar-value">{total > 0 ? `${total}%` : ''}</div>
                    <div className="edp-bar-track">
                      <div className={`edp-bar-fill ${isOver ? 'over' : total >= 80 ? 'warn' : ''}`}
                        style={{ height: `${Math.min(h, 100)}%` }} />
                    </div>
                    <div className="edp-bar-label">{m}월</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 메모 */}
          <div className="edp-section">
            <h4>특이사항 메모</h4>
            {memoLoaded ? (
              <>
                <textarea className="edp-memo" value={memo} onChange={e => setMemo(e.target.value)}
                  placeholder="예: 2026.08 퇴사 예정, 육아휴직 2026.03~06" rows={3} />
                <button className="btn-secondary edp-memo-save" onClick={saveMemo} disabled={saving}>
                  {saving ? '저장 중...' : '메모 저장'}
                </button>
              </>
            ) : <p className="edp-empty">로딩...</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeDetailPanel;
