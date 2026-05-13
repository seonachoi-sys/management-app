import React, { useState, useMemo, useEffect } from 'react';
import { FlaskConical, Sparkles, Plus, Trash2, Play, Save, CheckCircle, AlertTriangle } from 'lucide-react';
import { collection, doc, setDoc, getDocs, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useProjects } from '../../hooks/useProjects';
import { useEmployees } from '../../hooks/useEmployees';
import { subscribeYearlyParticipations, saveParticipation } from '../../services/yearlyParticipationService';
import { addProject } from '../../services/projectService';
import { calcLaborSalary } from '../../services/payrollParserService';
import { logAction } from '../../services/auditService';
import { useAuth } from '../../hooks/useAuth';
import { Employee, Project, YearlyParticipation } from '../../types/project';
import './Simulator.css';

function formatWon(n: number): string { return n.toLocaleString() + '원'; }

const MONTHS = [1,2,3,4,5,6,7,8,9,10,11,12];

function isExcludedProject(p: Project): boolean {
  const r = (p.excludeReason || '').toLowerCase();
  return r.includes('6개월') || r.includes('5천만') || r.includes('기획') || r.includes('평가');
}

// ═══ 잔여 참여율 테이블 ═══
interface EmpStatus {
  emp: Employee;
  currentTotal: number;
  remaining: number;
  respCount: number;
  coCount: number;
  available: boolean;
}

function calcEmpStatuses(
  employees: Employee[], participations: YearlyParticipation[],
  projects: Project[], month: number
): EmpStatus[] {
  const mKey = String(month);
  return employees.map(emp => {
    const parts = participations.filter(p => p.employeeName === emp.name);
    const currentTotal = parts.reduce((s, p) => s + (p.monthlyRates[mKey] || 0), 0);
    const remaining = 100 - currentTotal;

    const active = parts.filter(p => (p.monthlyRates[mKey] || 0) > 0);
    const respExcl = active.filter(p => {
      if (p.role !== '책임연구원') return false;
      const proj = projects.find(pr => pr.projectId === p.projectId);
      return proj ? isExcludedProject(proj) : false;
    }).length;
    const respCount = active.filter(p => p.role === '책임연구원').length - respExcl;
    const coCount = active.filter(p => p.role === '연구원').length;
    const available = remaining > 0 && respCount <= 3 && coCount <= 5;

    return { emp, currentTotal, remaining, respCount, coCount, available };
  }).sort((a, b) => (a.emp.employeeNumber || '').localeCompare(b.emp.employeeNumber || ''));
}

// ═══ 시뮬 멤버 ═══
interface SimMember {
  empName: string;
  empId: string;
  rate: number;
  role: '책임연구원' | '연구원';
}

// ═══ 시뮬 과제 정보 ═══
interface SimProject {
  name: string;
  shortName: string;
  agency: string;
  hostOrg: string;
  participationType: '주관' | '공동';
  pi: string;
  piRole: '책임' | '공동';
  periodStart: string;
  periodEnd: string;
  yearCount: number;
  govBudget: number;
  privateCash: number;
  privateInKind: number;
  laborCash: number;
  laborInKind: number;
}

const defaultSimProject: SimProject = {
  name: '', shortName: '', agency: '', hostOrg: '타이로스코프',
  participationType: '주관', pi: '', piRole: '책임',
  periodStart: '', periodEnd: '', yearCount: 1,
  govBudget: 0, privateCash: 0, privateInKind: 0,
  laborCash: 0, laborInKind: 0,
};

// ═══ 탭 1: 신규과제 시뮬레이션 ═══
function NewProjectSimTab({ employees, activeProjects, participations }: {
  employees: Employee[]; activeProjects: Project[]; participations: YearlyParticipation[];
}) {
  const { user } = useAuth();
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  const [sim, setSim] = useState<SimProject>(defaultSimProject);
  const [members, setMembers] = useState<SimMember[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [savedSims, setSavedSims] = useState<any[]>([]);

  // 연구원 현황
  const empStatuses = useMemo(() =>
    calcEmpStatuses(employees, participations, activeProjects, currentMonth),
    [employees, participations, activeProjects, currentMonth]
  );

  // 저장된 시뮬레이션 로드
  useEffect(() => {
    getDocs(collection(db, 'simulations')).then(snap => {
      setSavedSims(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    });
  }, []);

  const update = (key: keyof SimProject, val: any) => setSim(prev => ({ ...prev, [key]: val }));

  const addMember = (emp: Employee) => {
    if (members.find(m => m.empName === emp.name)) return;
    setMembers([...members, { empName: emp.name, empId: emp.employeeNumber, rate: 10, role: '연구원' }]);
  };

  const removeMember = (name: string) => setMembers(members.filter(m => m.empName !== name));
  const updateMember = (name: string, field: string, val: any) =>
    setMembers(members.map(m => m.empName === name ? { ...m, [field]: val } : m));

  // 인건비 계산
  const laborResult = useMemo(() => {
    const rows = members.map(m => {
      const emp = employees.find(e => e.name === m.empName);
      if (!emp) return null;
      const salary = calcLaborSalary(emp);
      const ins = emp.insurance?.totalCompanyBurden || 0;
      const cost = salary + ins;
      const total = Math.round(cost * m.rate / 100);
      // privateCash/privateInKind 예산 비율로 배분
      const cBudget = sim.privateCash || 0;
      const iBudget = sim.privateInKind || 0;
      const bTotal = cBudget + iBudget;
      const cRatio = bTotal > 0 ? cBudget / bTotal : 0;
      const cash = Math.round(total * cRatio);
      const inKind = total - cash;
      return { ...m, emp, salary, ins, cost, total, cash, inKind };
    }).filter(Boolean) as any[];

    const monthlyCash = rows.reduce((s: number, r: any) => s + r.cash, 0);
    const monthlyInKind = rows.reduce((s: number, r: any) => s + r.inKind, 0);
    const monthlyTotal = monthlyCash + monthlyInKind;
    const months = sim.yearCount * 12;
    const annualCash = monthlyCash * months;
    const annualInKind = monthlyInKind * months;
    const annualTotal = annualCash + annualInKind;
    const budgetTotal = sim.laborCash + sim.laborInKind;
    const overBudget = budgetTotal > 0 && annualTotal > budgetTotal;

    return { rows, monthlyCash, monthlyInKind, monthlyTotal, annualCash, annualInKind, annualTotal, budgetTotal, overBudget };
  }, [members, employees, sim]);

  // 시뮬레이션 저장
  const handleSave = async () => {
    setSaving(true);
    const docData = {
      name: `${sim.shortName || sim.name} 시뮬레이션`,
      status: '시뮬레이션',
      createdAt: Timestamp.now(),
      createdBy: user?.email || '',
      projectInfo: {
        name: sim.name, shortName: sim.shortName, agency: sim.agency,
        hostOrg: sim.hostOrg, participationType: sim.participationType,
        pi: sim.pi, piRole: sim.piRole,
        period: { start: sim.periodStart, end: sim.periodEnd },
        yearCount: sim.yearCount,
        budget: { government: sim.govBudget, privateCash: sim.privateCash, privateInKind: sim.privateInKind },
        laborBudget: { cash: sim.laborCash, inKind: sim.laborInKind },
      },
      participants: members.map(m => ({ employeeId: m.empId, name: m.empName, rate: m.rate, role: m.role })),
      laborCostSummary: {
        monthlyCash: laborResult.monthlyCash, monthlyInKind: laborResult.monthlyInKind,
        monthlyTotal: laborResult.monthlyTotal, annualTotal: laborResult.annualTotal,
      },
    };
    await addDoc(collection(db, 'simulations'), docData);
    // 목록 새로고침
    const snap = await getDocs(collection(db, 'simulations'));
    setSavedSims(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    setSaving(false);
    alert('시뮬레이션이 저장되었습니다.');
  };

  // 과제 확정
  const handleConfirm = async () => {
    if (!window.confirm('이 시뮬레이션을 실제 과제로 등록하시겠습니까?')) return;
    setConfirming(true);
    try {
      const years = [];
      let start = sim.periodStart;
      for (let i = 0; i < sim.yearCount; i++) {
        const yStart = i === 0 ? start : `${parseInt(start.slice(0, 4), 10) + i}-01-01`;
        const yEnd = `${parseInt(yStart.slice(0, 4), 10)}-12-31`;
        years.push({
          yearNumber: i + 1, start: yStart, end: yEnd, months: 12,
          budget: { government: Math.round(sim.govBudget / sim.yearCount), privateCash: Math.round(sim.privateCash / sim.yearCount), privateInKind: Math.round(sim.privateInKind / sim.yearCount), total: Math.round((sim.govBudget + sim.privateCash + sim.privateInKind) / sim.yearCount) },
          budgetExecution: { executed: 0, planned: 0, unplanned: 0, remaining: 0 },
        });
      }

      await addProject({
        status: '진행', category: 'R&D사업',
        programName: sim.name, projectName: sim.name, shortName: sim.shortName,
        agency: sim.agency, hostOrg: sim.hostOrg,
        participationType: sim.participationType, pi: sim.pi, piRole: sim.piRole,
        period: { totalStart: sim.periodStart, totalEnd: sim.periodEnd },
        years: years as any, contact: { manager: '', phone: '', email: '' },
        excludeReason: '',
      } as any);

      // 참여율 저장
      for (const m of members) {
        const rates: Record<string, number> = {};
        MONTHS.forEach(mo => { rates[String(mo)] = m.rate; });
        await saveParticipation({
          id: `${sim.shortName}_${m.empName}_${currentYear}`,
          projectId: sim.shortName, employeeId: m.empId, employeeName: m.empName,
          year: currentYear, role: m.role, monthlyRates: rates, averageRate: m.rate,
        }, user?.email || '');
      }

      await logAction('confirm_simulation', 'simulations', sim.shortName, 'project', null, sim.name, user?.email || '');
      alert('과제가 등록되었습니다! 수주현황에 반영됩니다.');
    } catch (e: any) {
      alert('등록 실패: ' + e.message);
    }
    setConfirming(false);
  };

  // 저장된 시뮬레이션 불러오기
  const loadSim = (saved: any) => {
    const pi = saved.projectInfo || saved;
    setSim({
      name: pi.name || saved.name || '', shortName: pi.shortName || saved.shortName || '',
      agency: pi.agency || saved.agency || '', hostOrg: pi.hostOrg || saved.hostOrg || '타이로스코프',
      participationType: pi.participationType || saved.participationType || '주관',
      pi: pi.pi || saved.pi || '', piRole: pi.piRole || saved.piRole || '책임',
      periodStart: pi.period?.start || saved.periodStart || '',
      periodEnd: pi.period?.end || saved.periodEnd || '',
      yearCount: pi.yearCount || saved.yearCount || 1,
      govBudget: pi.budget?.government || saved.govBudget || 0,
      privateCash: pi.budget?.privateCash || saved.privateCash || 0,
      privateInKind: pi.budget?.privateInKind || saved.privateInKind || 0,
      laborCash: pi.laborBudget?.cash || saved.laborCash || 0,
      laborInKind: pi.laborBudget?.inKind || saved.laborInKind || 0,
    });
    const parts = saved.participants || saved.members || [];
    setMembers(parts.map((p: any) => ({ empName: p.name || p.empName, empId: p.employeeId || p.empId || '', rate: p.rate, role: p.role || '연구원' })));
  };

  const deleteSim = async (id: string, status: string) => {
    if (status === '확정') { alert('확정된 시뮬레이션은 삭제할 수 없습니다.'); return; }
    if (!window.confirm('이 시뮬레이션을 삭제하시겠습니까?')) return;
    const { deleteDoc } = await import('firebase/firestore');
    await deleteDoc(doc(db, 'simulations', id));
    setSavedSims(savedSims.filter(s => s.id !== id));
  };

  return (
    <div className="sim-tab">
      <div className="sim-layout">
        {/* 좌측: 입력 폼 */}
        <div className="sim-form card">
          <h4>신규 과제 정보</h4>
          <div className="sim-fg">
            <label>과제명</label><input className="input" value={sim.name} onChange={e => update('name', e.target.value)} placeholder="예: AI 의료기기 연구개발" />
            <label>약어</label><input className="input" value={sim.shortName} onChange={e => update('shortName', e.target.value)} placeholder="예: AI의료" />
            <label>전문기관</label><input className="input" value={sim.agency} onChange={e => update('agency', e.target.value)} />
            <label>주관기관</label><input className="input" value={sim.hostOrg} onChange={e => update('hostOrg', e.target.value)} />
            <label>참여형태</label>
            <div className="sim-radios">
              <label><input type="radio" checked={sim.participationType === '주관'} onChange={() => update('participationType', '주관')} /> 주관</label>
              <label><input type="radio" checked={sim.participationType === '공동'} onChange={() => update('participationType', '공동')} /> 공동</label>
            </div>
            <label>연구책임자</label>
            <select className="input" value={sim.pi} onChange={e => update('pi', e.target.value)}>
              <option value="">선택</option>
              {employees.map(e => <option key={e.employeeNumber} value={e.name}>{e.name} ({e.position})</option>)}
            </select>
            <label>사업기간</label>
            <div className="sim-period">
              <input className="input" type="date" value={sim.periodStart} onChange={e => update('periodStart', e.target.value)} />
              <span>~</span>
              <input className="input" type="date" value={sim.periodEnd} onChange={e => update('periodEnd', e.target.value)} />
            </div>
            <label>연차 수</label><input className="input" type="number" min={1} max={5} value={sim.yearCount} onChange={e => update('yearCount', parseInt(e.target.value, 10) || 1)} />
          </div>
          <h4 style={{ marginTop: 16 }}>예산</h4>
          <div className="sim-fg">
            <label>정부출연금</label><input className="input" value={sim.govBudget || ''} onChange={e => update('govBudget', parseInt(e.target.value.replace(/,/g, ''), 10) || 0)} />
            <label>기업현금</label><input className="input" value={sim.privateCash || ''} onChange={e => update('privateCash', parseInt(e.target.value.replace(/,/g, ''), 10) || 0)} />
            <label>기업현물</label><input className="input" value={sim.privateInKind || ''} onChange={e => update('privateInKind', parseInt(e.target.value.replace(/,/g, ''), 10) || 0)} />
            <label>인건비(현금)</label><input className="input" value={sim.laborCash || ''} onChange={e => update('laborCash', parseInt(e.target.value.replace(/,/g, ''), 10) || 0)} />
            <label>인건비(현물)</label><input className="input" value={sim.laborInKind || ''} onChange={e => update('laborInKind', parseInt(e.target.value.replace(/,/g, ''), 10) || 0)} />
          </div>
        </div>

        {/* 우측: 잔여 참여율 */}
        <div className="sim-avail card">
          <h4>잔여 참여율 현황 <span className="sim-month-badge">{currentMonth}월 기준</span></h4>
          <div className="sim-avail-scroll">
            <table className="table sim-avail-table">
              <thead>
                <tr><th>연구원</th><th>소속</th><th>현재</th><th>잔여</th><th>3책5공</th><th></th></tr>
              </thead>
              <tbody>
                {empStatuses.map(s => {
                  const isMember = members.find(m => m.empName === s.emp.name);
                  const remCls = s.remaining >= 50 ? 'hi' : s.remaining >= 20 ? 'mid' : s.remaining > 0 ? 'lo' : 'zero';
                  return (
                    <tr key={s.emp.employeeNumber} className={isMember ? 'sim-selected' : ''}>
                      <td className="sim-emp-name">{s.emp.name}</td>
                      <td className="sim-dept">{s.emp.department}</td>
                      <td className="sim-num">{s.currentTotal}%</td>
                      <td className={`sim-num sim-rem-${remCls}`}>{s.remaining}%</td>
                      <td className="sim-badges">
                        {s.respCount > 0 && <span className={`sim-badge ${s.respCount > 3 ? 'over' : ''}`}>책{s.respCount}/3</span>}
                        {s.coCount > 0 && <span className={`sim-badge ${s.coCount > 5 ? 'over' : ''}`}>공{s.coCount}/5</span>}
                      </td>
                      <td>
                        {isMember ? (
                          <button className="sim-rm-btn" onClick={() => removeMember(s.emp.name)}>제거</button>
                        ) : s.available ? (
                          <button className="sim-add-emp-btn" onClick={() => addMember(s.emp)}>+ 추가</button>
                        ) : (
                          <span className="sim-unavail">불가</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 선택된 연구원 + 참여율 배정 */}
      {members.length > 0 && (
        <div className="sim-members-card card">
          <h4>참여연구원 편성 ({members.length}명)</h4>
          <table className="table sim-members-table">
            <thead>
              <tr><th>연구원</th><th>역할</th><th>참여율</th><th>월급여</th><th>4대보험</th><th>인건비단가</th><th>월인건비</th><th>현금</th><th>현물</th><th></th></tr>
            </thead>
            <tbody>
              {laborResult.rows.map((r: any) => {
                const status = empStatuses.find(s => s.emp.name === r.empName);
                const overRate = status && r.rate > status.remaining;
                return (
                  <tr key={r.empName} className={overRate ? 'sim-over-row' : ''}>
                    <td className="sim-emp-name">{r.empName}</td>
                    <td>
                      <select className="input sim-role-sel" value={r.role} onChange={e => updateMember(r.empName, 'role', e.target.value)}>
                        <option value="책임연구원">책임연구원</option>
                        <option value="연구원">연구원</option>
                      </select>
                    </td>
                    <td>
                      <div className="sim-rate-cell">
                        <input className="input sim-rate-inp" type="number" min={0} max={100} value={r.rate}
                          onChange={e => updateMember(r.empName, 'rate', parseInt(e.target.value, 10) || 0)} />
                        <span>%</span>
                        {overRate && <AlertTriangle size={14} className="sim-warn-icon" />}
                      </div>
                    </td>
                    <td className="money">{formatWon(r.salary)}</td>
                    <td className="money">{formatWon(r.ins)}</td>
                    <td className="money">{formatWon(r.cost)}</td>
                    <td className="money sim-total">{formatWon(r.total)}</td>
                    <td className="money">{formatWon(r.cash)}</td>
                    <td className="money">{formatWon(r.inKind)}</td>
                    <td><button className="sim-rm-btn" onClick={() => removeMember(r.empName)}><Trash2 size={13} /></button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}><strong>월 합계</strong></td>
                <td className="money sim-total"><strong>{formatWon(laborResult.monthlyTotal)}</strong></td>
                <td className="money"><strong>{formatWon(laborResult.monthlyCash)}</strong></td>
                <td className="money"><strong>{formatWon(laborResult.monthlyInKind)}</strong></td>
                <td />
              </tr>
            </tfoot>
          </table>

          {/* 요약 */}
          <div className="sim-summary">
            <div className="sim-sum-card">
              <span>연간 인건비 (추정)</span>
              <strong>{formatWon(laborResult.annualTotal)}</strong>
              <small>현금 {formatWon(laborResult.annualCash)} + 현물 {formatWon(laborResult.annualInKind)}</small>
            </div>
            {laborResult.budgetTotal > 0 && (
              <div className={`sim-sum-card ${laborResult.overBudget ? 'over' : 'ok'}`}>
                <span>인건비 예산 대비</span>
                <strong>{laborResult.overBudget ? '❌ 예산 초과' : '✅ 예산 내'}</strong>
                <small>예산 {formatWon(laborResult.budgetTotal)} / 시뮬 {formatWon(laborResult.annualTotal)} → 잔여 {formatWon(laborResult.budgetTotal - laborResult.annualTotal)}</small>
              </div>
            )}
          </div>

          <div className="sim-actions">
            <button className="btn-secondary" onClick={handleSave} disabled={saving}>
              <Save size={14} /> {saving ? '저장 중...' : '시뮬레이션 저장'}
            </button>
            <button className="btn-primary" onClick={handleConfirm} disabled={confirming || !sim.shortName}>
              <CheckCircle size={14} /> {confirming ? '등록 중...' : '과제 확정 → 수주현황 반영'}
            </button>
          </div>
        </div>
      )}

      {/* 저장된 시뮬레이션 */}
      {savedSims.length > 0 && (
        <div className="sim-saved card">
          <h4>시뮬레이션 이력 ({savedSims.length}건)</h4>
          <div className="sim-saved-list">
            {savedSims.map((s: any) => {
              const pi = s.projectInfo || {};
              const lc = s.laborCostSummary || s.laborResult || {};
              const pCount = (s.participants || s.members || []).length;
              const isConfirmed = s.status === '확정';
              const dateStr = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString('ko-KR') : '';
              return (
                <div key={s.id} className={`sim-saved-card ${isConfirmed ? 'confirmed' : ''}`}>
                  <div className="sim-saved-main" onClick={() => loadSim(s)}>
                    <div className="sim-saved-top">
                      <strong>{pi.shortName || pi.name || s.shortName || s.name || '시뮬레이션'}</strong>
                      <span className={`sim-saved-status ${isConfirmed ? 'done' : ''}`}>
                        {isConfirmed ? '✅ 확정' : '📝 시뮬레이션'}
                      </span>
                    </div>
                    <div className="sim-saved-meta">
                      <span>{pCount}명 참여</span>
                      <span>연간 {formatWon(lc.annualTotal || 0)}</span>
                      <span>{dateStr}</span>
                      <span className="sim-saved-by">{s.createdBy || ''}</span>
                    </div>
                    {pi.period?.start && (
                      <div className="sim-saved-period">{pi.period.start} ~ {pi.period.end}</div>
                    )}
                  </div>
                  {!isConfirmed && (
                    <button className="sim-saved-delete" onClick={e => { e.stopPropagation(); deleteSim(s.id, s.status); }}
                      title="삭제"><Trash2 size={14} /></button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ 탭 2: 참여율 최적화 (AI) ═══
function OptimizeTab({ employees, activeProjects, participations }: {
  employees: Employee[]; activeProjects: Project[]; participations: YearlyParticipation[];
}) {
  const { user } = useAuth();
  const currentMonth = new Date().getMonth() + 1;
  const mKey = String(currentMonth);

  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set(activeProjects.map(p => p.projectId)));
  const [goal, setGoal] = useState<'efficiency' | 'balanced' | 'priority'>('efficiency');
  const [priorityId, setPriorityId] = useState('');
  const [constraints, setConstraints] = useState<string[]>([]);
  const [newConstraint, setNewConstraint] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<import('../../services/geminiService').OptimizationResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [selectedApply, setSelectedApply] = useState<Set<string>>(new Set());

  const hasApiKey = !!process.env.REACT_APP_GEMINI_API_KEY;

  const toggleProject = (id: string) => {
    const s = new Set(selectedProjects);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelectedProjects(s);
  };

  const addConstraint = () => {
    if (newConstraint.trim()) { setConstraints([...constraints, newConstraint.trim()]); setNewConstraint(''); }
  };

  const runOptimization = async () => {
    setLoading(true); setError(''); setResult(null);
    try {
      const { optimizeParticipation } = await import('../../services/geminiService');
      const input: import('../../services/geminiService').OptimizationInput = {
        projects: activeProjects.filter(p => selectedProjects.has(p.projectId)).map(p => ({
          id: p.projectId, name: p.shortName,
          laborBudgetCash: (p.years[0]?.budget?.privateCash || 0),
          laborBudgetInKind: 500000000,
        })),
        employees: employees.map(emp => {
          const parts = participations.filter(p => p.employeeName === emp.name);
          const currentRates: Record<string, number> = {};
          parts.forEach(p => { currentRates[p.projectId] = p.monthlyRates[mKey] || 0; });
          const total = Object.values(currentRates).reduce((s, v) => s + v, 0);
          const respCount = parts.filter(p => p.role === '책임연구원' && (p.monthlyRates[mKey] || 0) > 0).length;
          const coCount = parts.filter(p => p.role === '연구원' && (p.monthlyRates[mKey] || 0) > 0).length;
          return {
            name: emp.name, position: emp.position,
            salary: calcLaborSalary(emp), insurance: emp.insurance?.totalCompanyBurden || 0,
            currentRates, remaining: 100 - total, respCount, coCount,
          };
        }),
        goal, priorityProjectId: priorityId, constraints,
      };
      const res = await optimizeParticipation(input);
      setResult(res);
      // 전체 선택 기본값
      setSelectedApply(new Set(res.assignments.map(a => `${a.employee}_${a.project}`)));
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const handleApply = async () => {
    if (!result || !window.confirm('AI 추천을 참여율에 반영하시겠습니까?')) return;
    setApplying(true);
    try {
      for (const a of result.assignments) {
        if (!selectedApply.has(`${a.employee}_${a.project}`)) continue;
        const emp = employees.find(e => e.name === a.employee);
        if (!emp) continue;
        const existing = participations.find(p => p.employeeName === a.employee && p.projectId === a.project);
        const { updateMonthlyRate } = await import('../../services/yearlyParticipationService');
        await updateMonthlyRate(a.project, a.employee, emp.employeeNumber, new Date().getFullYear(),
          currentMonth, a.rate, (a.role === '책임연구원' ? '책임연구원' : '연구원') as any,
          user?.email || '', existing);
      }
      await logAction('ai_optimize', 'yearlyParticipations', 'all', 'apply', null,
        `AI 최적화 적용 (${result.assignments.length}건)`, user?.email || '');
      alert('AI 추천이 적용되었습니다!');
    } catch (e: any) {
      alert('적용 실패: ' + e.message);
    }
    setApplying(false);
  };

  if (!hasApiKey) {
    return (
      <div className="sim-tab">
        <div className="sim-ai-card card">
          <div className="sim-ai-icon"><Sparkles size={32} /></div>
          <h3>AI 참여율 최적화</h3>
          <p>Gemini API Key가 필요합니다.</p>
          <div className="sim-ai-setup">
            <code>.env</code> 파일에 다음을 추가하세요:<br />
            <code>REACT_APP_GEMINI_API_KEY=your_api_key_here</code>
          </div>
          <p className="sim-ai-note">API Key 없이도 시뮬레이터의 수동 기능은 정상 동작합니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sim-tab">
      <div className="sim-opt-layout">
        {/* 입력 */}
        <div className="sim-opt-input card">
          <h4><Sparkles size={16} /> 최적화 설정</h4>

          <div className="sim-opt-section">
            <label className="sim-opt-label">대상 과제</label>
            <div className="sim-opt-projects">
              {activeProjects.map(p => (
                <label key={p.projectId} className={`sim-opt-proj ${selectedProjects.has(p.projectId) ? 'selected' : ''}`}>
                  <input type="checkbox" checked={selectedProjects.has(p.projectId)} onChange={() => toggleProject(p.projectId)} />
                  {p.shortName}
                </label>
              ))}
            </div>
          </div>

          <div className="sim-opt-section">
            <label className="sim-opt-label">최적화 목표</label>
            <div className="sim-opt-goals">
              <label className={goal === 'efficiency' ? 'active' : ''}><input type="radio" checked={goal === 'efficiency'} onChange={() => setGoal('efficiency')} /> 예산 효율 최대화</label>
              <label className={goal === 'balanced' ? 'active' : ''}><input type="radio" checked={goal === 'balanced'} onChange={() => setGoal('balanced')} /> 참여율 균등 배분</label>
              <label className={goal === 'priority' ? 'active' : ''}><input type="radio" checked={goal === 'priority'} onChange={() => setGoal('priority')} /> 특정 과제 우선</label>
            </div>
            {goal === 'priority' && (
              <select className="input" value={priorityId} onChange={e => setPriorityId(e.target.value)} style={{ marginTop: 8 }}>
                <option value="">과제 선택</option>
                {activeProjects.map(p => <option key={p.projectId} value={p.projectId}>{p.shortName}</option>)}
              </select>
            )}
          </div>

          <div className="sim-opt-section">
            <label className="sim-opt-label">추가 제약조건</label>
            <div className="sim-opt-constraints">
              {constraints.map((c, i) => (
                <div key={i} className="sim-constraint-tag">
                  {c} <button onClick={() => setConstraints(constraints.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
            <div className="sim-constraint-input">
              <input className="input" placeholder='예: 박재민은 AI빅테크 80% 이상 유지' value={newConstraint}
                onChange={e => setNewConstraint(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addConstraint(); }} />
              <button className="btn-secondary" onClick={addConstraint} style={{ height: 34 }}>추가</button>
            </div>
          </div>

          <button className="btn-primary sim-opt-run" onClick={runOptimization} disabled={loading || selectedProjects.size === 0}>
            <Sparkles size={14} /> {loading ? 'AI 분석 중...' : 'AI 최적화 실행'}
          </button>
          {error && <div className="sim-opt-error"><AlertTriangle size={14} /> {error}</div>}
        </div>

        {/* 결과 */}
        {result && (
          <div className="sim-opt-result card">
            <h4>AI 추천 결과</h4>

            {result.reasoning && (
              <div className="sim-opt-reasoning">{result.reasoning}</div>
            )}

            <div className="sim-opt-table-wrap">
              <table className="table sim-opt-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" checked={selectedApply.size === result.assignments.length}
                      onChange={e => setSelectedApply(e.target.checked ? new Set(result.assignments.map(a => `${a.employee}_${a.project}`)) : new Set())} /></th>
                    <th>연구원</th><th>과제</th><th>역할</th>
                    <th className="money">현재</th><th className="money">추천</th><th className="money">변경</th><th className="money">월인건비</th>
                  </tr>
                </thead>
                <tbody>
                  {result.assignments.map((a, i) => {
                    const key = `${a.employee}_${a.project}`;
                    const current = participations.find(p => p.employeeName === a.employee && p.projectId === a.project)?.monthlyRates[mKey] || 0;
                    const diff = a.rate - current;
                    return (
                      <tr key={i}>
                        <td><input type="checkbox" checked={selectedApply.has(key)}
                          onChange={e => { const s = new Set(selectedApply); if (e.target.checked) s.add(key); else s.delete(key); setSelectedApply(s); }} /></td>
                        <td className="sim-emp-name">{a.employee}</td>
                        <td>{a.project}</td>
                        <td>{a.role}</td>
                        <td className="money">{current}%</td>
                        <td className="money sim-total">{a.rate}%</td>
                        <td className={`money ${diff > 0 ? 'sim-diff-up' : diff < 0 ? 'sim-diff-down' : ''}`}>
                          {diff > 0 ? `↑${diff}%` : diff < 0 ? `↓${Math.abs(diff)}%` : '-'}
                        </td>
                        <td className="money">{formatWon(a.monthlyCost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {result.summary && (
              <div className="sim-opt-summary">
                {result.summary.map(s => (
                  <div key={s.projectId} className="sim-opt-sum-item">
                    <strong>{s.projectId}</strong>
                    <span>현금 {formatWon(s.totalCash)} + 현물 {formatWon(s.totalInKind)}</span>
                    <span>예산사용 {s.budgetUsage}%</span>
                  </div>
                ))}
              </div>
            )}

            <div className="sim-actions">
              <button className="btn-primary" onClick={handleApply} disabled={applying || selectedApply.size === 0}>
                <CheckCircle size={14} /> {applying ? '적용 중...' : `선택항목 적용 (${selectedApply.size}건)`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ 메인 ═══
type TabId = 'simulate' | 'optimize';

const Simulator: React.FC = () => {
  const { activeProjects } = useProjects();
  const { employees } = useEmployees();
  const [activeTab, setActiveTab] = useState<TabId>('simulate');
  const [participations, setParticipations] = useState<YearlyParticipation[]>([]);

  useEffect(() => {
    const year = new Date().getFullYear();
    const unsub = subscribeYearlyParticipations(year, setParticipations, () => {});
    return unsub;
  }, []);

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'simulate', label: '신규과제 시뮬레이션', icon: <FlaskConical size={15} /> },
    { id: 'optimize', label: '참여율 최적화 (AI)', icon: <Sparkles size={15} /> },
  ];

  return (
    <div className="sim-container">
      <p className="sim-subtitle">신규과제 참여율 및 인건비 시뮬레이션</p>
      <div className="sim-tabs">
        {tabs.map(t => (
          <button key={t.id} className={`sim-tab-btn ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      {activeTab === 'simulate' && <NewProjectSimTab employees={employees} activeProjects={activeProjects} participations={participations} />}
      {activeTab === 'optimize' && <OptimizeTab employees={employees} activeProjects={activeProjects} participations={participations} />}
    </div>
  );
};

export default Simulator;
