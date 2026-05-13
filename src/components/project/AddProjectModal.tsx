import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { X, Plus, Trash2 } from 'lucide-react';
import { addProject, updateProject } from '../../services/projectService';
import { useEmployees } from '../../hooks/useEmployees';
import { useToast } from '../common/Toast';
import { Project } from '../../types/project';

interface AddProjectModalProps {
  open: boolean;
  onClose: () => void;
  editProject?: Project | null;
}

// 천단위 콤마 포맷
function fmtComma(n: number): string {
  if (!n) return '';
  return n.toLocaleString('ko-KR');
}
function parseComma(s: string): number {
  return parseInt(s.replace(/[^0-9]/g, ''), 10) || 0;
}

interface YearBudget {
  yearNumber: number;
  start: string;
  end: string;
  government: number;
  privateCash: number;
  privateInKind: number;
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
  contactManager: '',
  contactPhone: '',
  contactEmail: '',
  excludeReason: '',
};

function MoneyInput({ value, onChange, placeholder, style }: {
  value: number; onChange: (v: number) => void; placeholder?: string; style: React.CSSProperties;
}) {
  const [display, setDisplay] = useState(fmtComma(value));

  useEffect(() => { setDisplay(fmtComma(value)); }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      style={style}
      value={display}
      placeholder={placeholder || '0'}
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9]/g, '');
        const num = parseInt(raw, 10) || 0;
        setDisplay(num ? num.toLocaleString('ko-KR') : '');
        onChange(num);
      }}
    />
  );
}

const AddProjectModal: React.FC<AddProjectModalProps> = ({ open, onClose, editProject }) => {
  const { employees } = useEmployees();
  const { addToast } = useToast();
  const [form, setForm] = useState(INITIAL);
  const [yearBudgets, setYearBudgets] = useState<YearBudget[]>([
    { yearNumber: 1, start: '', end: '', government: 0, privateCash: 0, privateInKind: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activeYearTab, setActiveYearTab] = useState(0);

  const isEdit = !!editProject;

  // 수정 모드: 기존 데이터로 폼 채우기
  useEffect(() => {
    if (editProject && open) {
      const p = editProject;
      setForm({
        status: (p.status as any) || '진행',
        category: (p.category as any) || 'R&D사업',
        programName: p.programName || '',
        projectName: p.projectName || '',
        shortName: p.shortName || '',
        agency: p.agency || '',
        hostOrg: p.hostOrg || '타이로스코프',
        participationType: (p.participationType as any) || '주관',
        pi: p.pi || '',
        piRole: (p.piRole as any) || '책임',
        totalStart: p.period?.totalStart || '',
        totalEnd: p.period?.totalEnd || '',
        contactManager: p.contact?.manager || '',
        contactPhone: p.contact?.phone || '',
        contactEmail: p.contact?.email || '',
        excludeReason: (p as any).excludeReason || '',
      });
      if (p.years && p.years.length > 0) {
        setYearBudgets(p.years.map(y => ({
          yearNumber: y.yearNumber,
          start: y.start,
          end: y.end,
          government: y.budget.government || 0,
          privateCash: y.budget.privateCash || 0,
          privateInKind: y.budget.privateInKind || 0,
        })));
      }
      setActiveYearTab(0);
    } else if (!open) {
      setForm(INITIAL);
      setYearBudgets([{ yearNumber: 1, start: '', end: '', government: 0, privateCash: 0, privateInKind: 0 }]);
      setError('');
      setActiveYearTab(0);
    }
  }, [editProject, open]);

  if (!open) return null;

  const set = (key: string, value: any) => setForm(prev => ({ ...prev, [key]: value }));

  const updateYearBudget = (idx: number, key: keyof YearBudget, value: any) => {
    setYearBudgets(prev => prev.map((y, i) => i === idx ? { ...y, [key]: value } : y));
  };

  const addYear = () => {
    const last = yearBudgets[yearBudgets.length - 1];
    let newStart = '';
    let newEnd = '';
    if (last?.end) {
      const d = new Date(last.end);
      d.setDate(d.getDate() + 1);
      newStart = d.toISOString().slice(0, 10);
      const e = new Date(d);
      e.setFullYear(e.getFullYear() + 1);
      e.setDate(e.getDate() - 1);
      newEnd = e.toISOString().slice(0, 10);
    }
    setYearBudgets(prev => [...prev, {
      yearNumber: prev.length + 1, start: newStart, end: newEnd,
      government: 0, privateCash: 0, privateInKind: 0,
    }]);
    setActiveYearTab(yearBudgets.length);
  };

  const removeYear = (idx: number) => {
    if (yearBudgets.length <= 1) return;
    setYearBudgets(prev => prev.filter((_, i) => i !== idx).map((y, i) => ({ ...y, yearNumber: i + 1 })));
    setActiveYearTab(Math.max(0, activeYearTab - 1));
  };

  // 합계
  const totals = yearBudgets.reduce((acc, y) => ({
    gov: acc.gov + y.government,
    cash: acc.cash + y.privateCash,
    inKind: acc.inKind + y.privateInKind,
  }), { gov: 0, cash: 0, inKind: 0 });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.projectName.trim()) { setError('과제명을 입력해주세요.'); return; }
    if (!form.shortName.trim()) { setError('약어를 입력해주세요.'); return; }

    // 연차별 날짜 검증
    for (const yb of yearBudgets) {
      if (!yb.start || !yb.end) { setError(`${yb.yearNumber}차 기간을 입력해주세요.`); return; }
    }

    setSaving(true);
    try {
      const years = yearBudgets.map(yb => ({
        yearNumber: yb.yearNumber,
        start: yb.start,
        end: yb.end,
        months: Math.max(1, Math.round((new Date(yb.end).getTime() - new Date(yb.start).getTime()) / (1000 * 60 * 60 * 24 * 30))),
        budget: {
          government: yb.government,
          privateCash: yb.privateCash,
          privateInKind: yb.privateInKind,
          total: yb.government + yb.privateCash + yb.privateInKind,
        },
        budgetExecution: { executed: 0, planned: 0, unplanned: 0, remaining: yb.government + yb.privateCash + yb.privateInKind },
      }));

      const projectData = {
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
        period: { totalStart: yearBudgets[0]?.start || '', totalEnd: yearBudgets[yearBudgets.length - 1]?.end || '' },
        years,
        totalBudget: {
          government: totals.gov,
          privateCash: totals.cash,
          privateInKind: totals.inKind,
          total: totals.gov + totals.cash + totals.inKind,
        },
        contact: { manager: form.contactManager, phone: form.contactPhone, email: form.contactEmail },
        excludeReason: form.excludeReason,
      };

      if (isEdit && editProject) {
        await updateProject(editProject.projectId, projectData);
        addToast('과제가 수정되었습니다', 'success');
      } else {
        await addProject(projectData);
        addToast('과제가 추가되었습니다', 'success');
      }

      setForm(INITIAL);
      setYearBudgets([{ yearNumber: 1, start: '', end: '', government: 0, privateCash: 0, privateInKind: 0 }]);
      onClose();
    } catch (err: any) {
      console.error('과제 저장 실패:', err);
      setError(err.message || '저장 실패');
      addToast(isEdit ? '과제 수정에 실패했습니다' : '과제 저장에 실패했습니다', 'error');
    } finally {
      setSaving(false);
    }
  };

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  };
  const modal: React.CSSProperties = {
    background: '#fff', borderRadius: 12, width: '95%', maxWidth: 720,
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

  const cur = yearBudgets[activeYearTab];

  return ReactDOM.createPortal(
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{
          position: 'absolute', top: 16, right: 16, background: 'none',
          border: 'none', cursor: 'pointer', color: '#9CA3AF',
        }}><X size={20} /></button>

        <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700, color: '#111827' }}>
          {isEdit ? '과제 정보 수정' : '신규 과제 추가'}
        </h2>

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

          {/* ═══ 연차별 예산 ═══ */}
          <div style={{ background: '#F9FAFB', borderRadius: 8, padding: 16, marginBottom: 14, border: '1px solid #E5E7EB' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>연차별 예산</span>
              <button type="button" onClick={addYear} style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                background: '#EFF6FF', color: '#3B82F6', border: '1px solid #BFDBFE',
                borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}><Plus size={14} /> 연차 추가</button>
            </div>

            {/* 연차 탭 */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
              {yearBudgets.map((yb, i) => (
                <button key={i} type="button" onClick={() => setActiveYearTab(i)} style={{
                  padding: '6px 14px', fontSize: 13, fontWeight: activeYearTab === i ? 700 : 500,
                  background: activeYearTab === i ? '#3B82F6' : '#fff',
                  color: activeYearTab === i ? '#fff' : '#6B7280',
                  border: `1px solid ${activeYearTab === i ? '#3B82F6' : '#D1D5DB'}`,
                  borderRadius: 6, cursor: 'pointer',
                }}>{yb.yearNumber}차</button>
              ))}
            </div>

            {/* 현재 연차 편집 */}
            {cur && (
              <div>
                <div style={row}>
                  <div>
                    <label style={label}>{cur.yearNumber}차 시작일</label>
                    <input type="date" style={input} value={cur.start}
                      onChange={e => updateYearBudget(activeYearTab, 'start', e.target.value)} />
                  </div>
                  <div>
                    <label style={label}>{cur.yearNumber}차 종료일</label>
                    <input type="date" style={input} value={cur.end}
                      onChange={e => updateYearBudget(activeYearTab, 'end', e.target.value)} />
                  </div>
                </div>
                <div style={row3}>
                  <div>
                    <label style={label}>정부출연금</label>
                    <MoneyInput style={input} value={cur.government}
                      onChange={v => updateYearBudget(activeYearTab, 'government', v)} />
                  </div>
                  <div>
                    <label style={label}>기업부담 현금</label>
                    <MoneyInput style={input} value={cur.privateCash}
                      onChange={v => updateYearBudget(activeYearTab, 'privateCash', v)} />
                  </div>
                  <div>
                    <label style={label}>기업부담 현물</label>
                    <MoneyInput style={input} value={cur.privateInKind}
                      onChange={v => updateYearBudget(activeYearTab, 'privateInKind', v)} />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#6B7280' }}>
                    {cur.yearNumber}차 총사업비: <strong style={{ color: '#111827' }}>{fmtComma(cur.government + cur.privateCash + cur.privateInKind)}원</strong>
                  </span>
                  {yearBudgets.length > 1 && (
                    <button type="button" onClick={() => removeYear(activeYearTab)} style={{
                      display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                      background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA',
                      borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}><Trash2 size={12} /> {cur.yearNumber}차 삭제</button>
                  )}
                </div>
              </div>
            )}

            {/* 전체 합계 */}
            {yearBudgets.length > 1 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #E5E7EB', fontSize: 13 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
                  <div><span style={{ color: '#6B7280' }}>정부출연금</span><br/><strong>{fmtComma(totals.gov)}원</strong></div>
                  <div><span style={{ color: '#6B7280' }}>현금</span><br/><strong>{fmtComma(totals.cash)}원</strong></div>
                  <div><span style={{ color: '#6B7280' }}>현물</span><br/><strong>{fmtComma(totals.inKind)}원</strong></div>
                  <div><span style={{ color: '#6B7280' }}>총합계</span><br/><strong style={{ color: '#3B82F6' }}>{fmtComma(totals.gov + totals.cash + totals.inKind)}원</strong></div>
                </div>
              </div>
            )}
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
            }}>{saving ? '저장 중...' : isEdit ? '수정 저장' : '과제 등록'}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default AddProjectModal;
