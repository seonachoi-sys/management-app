import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { X } from 'lucide-react';
import { addProject } from '../../services/projectService';
import { useEmployees } from '../../hooks/useEmployees';

interface AddProjectModalProps {
  open: boolean;
  onClose: () => void;
}

const INITIAL = {
  status: '진행' as const,
  category: 'R&D사업' as const,
  programName: '',
  projectName: '',
  shortName: '',
  agency: '',
  hostOrg: '타이로스코프',
  participationType: '주관' as const,
  pi: '',
  piRole: '책임' as const,
  totalStart: '',
  totalEnd: '',
  yearCount: 1,
  government: 0,
  privateCash: 0,
  privateInKind: 0,
  contactManager: '',
  contactPhone: '',
  contactEmail: '',
  excludeReason: '',
};

const AddProjectModal: React.FC<AddProjectModalProps> = ({ open, onClose }) => {
  const { employees } = useEmployees();
  const [form, setForm] = useState(INITIAL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const set = (key: string, value: any) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.projectName.trim()) { setError('과제명을 입력해주세요.'); return; }
    if (!form.shortName.trim()) { setError('약어를 입력해주세요.'); return; }
    if (!form.totalStart || !form.totalEnd) { setError('사업기간을 입력해주세요.'); return; }

    setSaving(true);
    try {
      // 연차 자동 생성
      const years = [];
      const startDate = new Date(form.totalStart);
      const total = form.government + form.privateCash + form.privateInKind;
      const govPerYear = Math.round(form.government / form.yearCount);
      const cashPerYear = Math.round(form.privateCash / form.yearCount);
      const inkindPerYear = Math.round(form.privateInKind / form.yearCount);

      for (let i = 0; i < form.yearCount; i++) {
        const yStart = new Date(startDate);
        yStart.setFullYear(yStart.getFullYear() + i);
        const yEnd = new Date(yStart);
        yEnd.setFullYear(yEnd.getFullYear() + 1);
        yEnd.setDate(yEnd.getDate() - 1);

        // 마지막 연차는 totalEnd를 넘지 않도록
        const endDate = new Date(form.totalEnd);
        const actualEnd = yEnd > endDate ? endDate : yEnd;

        const diffMs = actualEnd.getTime() - yStart.getTime();
        const months = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24 * 30)));

        years.push({
          yearNumber: i + 1,
          start: yStart.toISOString().slice(0, 10),
          end: actualEnd.toISOString().slice(0, 10),
          months,
          budget: {
            government: govPerYear,
            privateCash: cashPerYear,
            privateInKind: inkindPerYear,
            total: govPerYear + cashPerYear + inkindPerYear,
          },
          budgetExecution: { executed: 0, planned: 0, unplanned: 0, remaining: govPerYear + cashPerYear + inkindPerYear },
        });
      }

      await addProject({
        status: form.status,
        category: form.category,
        programName: form.programName,
        projectName: form.projectName,
        shortName: form.shortName,
        agency: form.agency,
        hostOrg: form.hostOrg,
        participationType: form.participationType,
        pi: form.pi,
        piRole: form.piRole,
        period: { totalStart: form.totalStart, totalEnd: form.totalEnd },
        years,
        contact: { manager: form.contactManager, phone: form.contactPhone, email: form.contactEmail },
        excludeReason: form.excludeReason,
      });

      setForm(INITIAL);
      onClose();
    } catch (err: any) {
      setError(err.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  };
  const modal: React.CSSProperties = {
    background: '#fff', borderRadius: 12, width: '95%', maxWidth: 640,
    maxHeight: '90vh', overflowY: 'auto', padding: 28, position: 'relative',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  };
  const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 };
  const input: React.CSSProperties = {
    width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6,
    fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  };
  const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 };
  const row3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 };
  const full: React.CSSProperties = { marginBottom: 14 };

  return ReactDOM.createPortal(
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{
          position: 'absolute', top: 16, right: 16, background: 'none',
          border: 'none', cursor: 'pointer', color: '#9CA3AF',
        }}><X size={20} /></button>

        <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700, color: '#111827' }}>신규 과제 추가</h2>

        {error && <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '8px 12px', borderRadius: 6, marginBottom: 14, fontSize: 13 }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          {/* 기본 정보 */}
          <div style={row}>
            <div>
              <label style={label}>구분 *</label>
              <select style={input} value={form.category} onChange={e => set('category', e.target.value)}>
                <option value="R&D사업">R&D사업</option>
                <option value="지원사업">지원사업</option>
              </select>
            </div>
            <div>
              <label style={label}>상태</label>
              <select style={input} value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="진행">진행</option>
                <option value="신규수주">신규수주</option>
              </select>
            </div>
          </div>

          <div style={full}>
            <label style={label}>사업명</label>
            <input style={input} value={form.programName} onChange={e => set('programName', e.target.value)} placeholder="예: 인공지능 핵심기술 개발" />
          </div>

          <div style={row}>
            <div>
              <label style={label}>과제명 *</label>
              <input style={input} value={form.projectName} onChange={e => set('projectName', e.target.value)} placeholder="과제명 입력" />
            </div>
            <div>
              <label style={label}>약어 *</label>
              <input style={input} value={form.shortName} onChange={e => set('shortName', e.target.value)} placeholder="예: AI빅테크" />
            </div>
          </div>

          <div style={row}>
            <div>
              <label style={label}>전문기관</label>
              <input style={input} value={form.agency} onChange={e => set('agency', e.target.value)} placeholder="예: 정보통신기획평가원" />
            </div>
            <div>
              <label style={label}>주관기관</label>
              <input style={input} value={form.hostOrg} onChange={e => set('hostOrg', e.target.value)} />
            </div>
          </div>

          <div style={row3}>
            <div>
              <label style={label}>참여형태</label>
              <select style={input} value={form.participationType} onChange={e => set('participationType', e.target.value)}>
                <option value="주관">주관</option>
                <option value="공동">공동</option>
              </select>
            </div>
            <div>
              <label style={label}>연구책임자</label>
              <select style={input} value={form.pi} onChange={e => set('pi', e.target.value)}>
                <option value="">선택</option>
                {employees.map(emp => <option key={emp.employeeId} value={emp.name}>{emp.name}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>책임자 역할</label>
              <select style={input} value={form.piRole} onChange={e => set('piRole', e.target.value)}>
                <option value="책임">책임</option>
                <option value="공동">공동</option>
              </select>
            </div>
          </div>

          {/* 기간 */}
          <div style={row3}>
            <div>
              <label style={label}>시작일 *</label>
              <input type="date" style={input} value={form.totalStart} onChange={e => set('totalStart', e.target.value)} />
            </div>
            <div>
              <label style={label}>종료일 *</label>
              <input type="date" style={input} value={form.totalEnd} onChange={e => set('totalEnd', e.target.value)} />
            </div>
            <div>
              <label style={label}>연차 수</label>
              <select style={input} value={form.yearCount} onChange={e => set('yearCount', Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}개년</option>)}
              </select>
            </div>
          </div>

          {/* 예산 */}
          <div style={row3}>
            <div>
              <label style={label}>정부출연금 (원)</label>
              <input type="number" style={input} value={form.government || ''} onChange={e => set('government', Number(e.target.value))} placeholder="0" />
            </div>
            <div>
              <label style={label}>기업부담 현금 (원)</label>
              <input type="number" style={input} value={form.privateCash || ''} onChange={e => set('privateCash', Number(e.target.value))} placeholder="0" />
            </div>
            <div>
              <label style={label}>기업부담 현물 (원)</label>
              <input type="number" style={input} value={form.privateInKind || ''} onChange={e => set('privateInKind', Number(e.target.value))} placeholder="0" />
            </div>
          </div>

          {/* 담당자 */}
          <div style={row3}>
            <div>
              <label style={label}>전담기관 담당자</label>
              <input style={input} value={form.contactManager} onChange={e => set('contactManager', e.target.value)} />
            </div>
            <div>
              <label style={label}>연락처</label>
              <input style={input} value={form.contactPhone} onChange={e => set('contactPhone', e.target.value)} />
            </div>
            <div>
              <label style={label}>이메일</label>
              <input style={input} value={form.contactEmail} onChange={e => set('contactEmail', e.target.value)} />
            </div>
          </div>

          <div style={full}>
            <label style={label}>3책5공 제외사유</label>
            <input style={input} value={form.excludeReason} onChange={e => set('excludeReason', e.target.value)} placeholder="예: 6개월 이내 / 5천만원 이하 / 기획과제" />
          </div>

          {/* 버튼 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button type="button" onClick={onClose} style={{
              padding: '10px 20px', background: '#F3F4F6', color: '#374151',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>취소</button>
            <button type="submit" disabled={saving} style={{
              padding: '10px 20px', background: saving ? '#93C5FD' : '#3B82F6', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>{saving ? '저장 중...' : '과제 등록'}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default AddProjectModal;
