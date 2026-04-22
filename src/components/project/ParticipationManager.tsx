import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Download, Upload, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, AlertCircle, Plus, X, UserPlus } from 'lucide-react';
import ParticipationUploadModal from './ParticipationUploadModal';
import EmployeeDetailPanel from './EmployeeDetailPanel';
import { useProjects } from '../../hooks/useProjects';
import { useEmployees } from '../../hooks/useEmployees';
import {
  subscribeYearlyParticipations, updateMonthlyRate, applyRateRange,
  saveParticipation, deleteParticipation,
} from '../../services/yearlyParticipationService';
import { addEmployee } from '../../services/employeeService';
import { YearlyParticipation, Project, Employee, EmployeeSalary, EmployeeInsurance } from '../../types/project';
import { useAuth } from '../../hooks/useAuth';
import './ParticipationManager.css';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/* ─── 신규 직원 기본값 (급여/보험은 월별 급여대장 업로드 시 채워짐) ─── */
const EMPTY_SALARY: EmployeeSalary = {
  basePay: 0, mealAllowance: 0, vehicleAllowance: 0,
  researchAllowance: 0, childcareAllowance: 0, totalPay: 0,
};
const EMPTY_INSURANCE: EmployeeInsurance = {
  nationalPension: 0, nationalPensionCompany: 0,
  healthInsurance: 0, healthInsuranceCompany: 0,
  longTermCare: 0, longTermCareCompany: 0,
  employmentInsurance: 0, employmentInsCompany: 0,
  industrialAccident: 0, totalCompanyBurden: 0,
};

// ═══ 과제 연차 기간 내 월인지 판별 ═══
function isMonthInProject(project: Project, year: number, month: number): boolean {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  for (const y of project.years) {
    const startYM = y.start.slice(0, 7);
    const endYM = y.end.slice(0, 7);
    if (ym >= startYM && ym <= endYM) return true;
  }
  return false;
}

// ═══ 3책5공 제외 대상 판별 ═══
function isExcludedProject(project: Project): boolean {
  const reason = (project.excludeReason || '').toLowerCase();
  return reason.includes('6개월') || reason.includes('5천만') || reason.includes('기획') || reason.includes('평가');
}

// ═══ 검증 결과 타입 ═══
export interface ValidationSummary {
  normal: string[];
  caution: string[];     // 80~100%
  overTotal: string[];   // >100%
  over3Resp: { name: string; count: number; excluded: number }[];
  over5Co: { name: string; count: number; excluded: number }[];
  minRateViolations: { name: string; project: string; role: string; rate: number; min: number }[];
  totalViolations: number;
}

// ═══ 검증 로직 ═══
function runValidation(
  data: YearlyParticipation[],
  projects: Project[],
  employees: Employee[],
  month: number,
): ValidationSummary {
  const mKey = String(month);
  const byEmployee = new Map<string, YearlyParticipation[]>();
  for (const p of data) {
    const list = byEmployee.get(p.employeeName) || [];
    list.push(p);
    byEmployee.set(p.employeeName, list);
  }

  const normal: string[] = [];
  const caution: string[] = [];
  const overTotal: string[] = [];
  const over3Resp: ValidationSummary['over3Resp'] = [];
  const over5Co: ValidationSummary['over5Co'] = [];
  const minRateViolations: ValidationSummary['minRateViolations'] = [];

  byEmployee.forEach((parts, name) => {
    const total = parts.reduce((s, p) => s + (p.monthlyRates[mKey] || 0), 0);

    // 합계 검증
    if (total > 100) overTotal.push(name);
    else if (total >= 80) caution.push(name);
    else if (total > 0) normal.push(name);

    // 3책5공
    const activeParts = parts.filter(p => (p.monthlyRates[mKey] || 0) > 0);
    const respParts = activeParts.filter(p => p.role === '책임연구원');
    const coParts = activeParts.filter(p => p.role === '연구원');

    const respExcluded = respParts.filter(p => {
      const proj = projects.find(pr => pr.projectId === p.projectId);
      return proj ? isExcludedProject(proj) : false;
    }).length;
    const respCount = respParts.length - respExcluded;
    if (respCount > 3) over3Resp.push({ name, count: respCount, excluded: respExcluded });

    const coExcluded = coParts.filter(p => {
      const proj = projects.find(pr => pr.projectId === p.projectId);
      return proj ? isExcludedProject(proj) : false;
    }).length;
    const coCount = coParts.length - coExcluded;
    if (coCount > 5) over5Co.push({ name, count: coCount, excluded: coExcluded });

    // 최소 참여율
    for (const part of activeParts) {
      const proj = projects.find(pr => pr.projectId === part.projectId);
      if (!proj?.minRates) continue;
      const minRate = proj.minRates[part.role];
      if (minRate && (part.monthlyRates[mKey] || 0) < minRate) {
        minRateViolations.push({
          name, project: proj.shortName, role: part.role,
          rate: part.monthlyRates[mKey] || 0, min: minRate,
        });
      }
    }
  });

  const totalViolations = overTotal.length + over3Resp.length + over5Co.length + minRateViolations.length;
  return { normal, caution, overTotal, over3Resp, over5Co, minRateViolations, totalViolations };
}

// ═══ 3책5공 뱃지 ═══
function RoleBadges({ name, data, projects, month }: {
  name: string; data: YearlyParticipation[]; projects: Project[]; month: number;
}) {
  const mKey = String(month);
  const parts = data.filter(d => d.employeeName === name && (d.monthlyRates[mKey] || 0) > 0);

  const respParts = parts.filter(p => p.role === '책임연구원');
  const coParts = parts.filter(p => p.role === '연구원');

  const respExcl = respParts.filter(p => { const pr = projects.find(x => x.projectId === p.projectId); return pr ? isExcludedProject(pr) : false; }).length;
  const coExcl = coParts.filter(p => { const pr = projects.find(x => x.projectId === p.projectId); return pr ? isExcludedProject(pr) : false; }).length;

  const respCount = respParts.length - respExcl;
  const coCount = coParts.length - coExcl;

  if (respParts.length === 0 && coParts.length === 0) return null;

  return (
    <span className="pm-role-badges">
      {respParts.length > 0 && (
        <span className={`pm-role-badge ${respCount > 3 ? 'danger' : ''}`}>
          책{respCount}/3{respExcl > 0 && <span className="pm-excl">(-{respExcl})</span>}
        </span>
      )}
      {coParts.length > 0 && (
        <span className={`pm-role-badge ${coCount > 5 ? 'danger' : ''}`}>
          공{coCount}/5{coExcl > 0 && <span className="pm-excl">(-{coExcl})</span>}
        </span>
      )}
    </span>
  );
}

// ═══ 검증 결과 패널 ═══
function ValidationPanel({ v }: { v: ValidationSummary }) {
  return (
    <div className="pm-validation-panel">
      <h4>검증 결과</h4>
      <div className="pm-val-grid">
        <div className="pm-val-item ok">
          <CheckCircle size={14} /> 정상: {v.normal.length}명
        </div>
        <div className={`pm-val-item ${v.caution.length > 0 ? 'warn' : 'ok'}`}>
          <AlertCircle size={14} /> 주의 (80~100%): {v.caution.length}명
          {v.caution.length > 0 && <span className="pm-val-names">{v.caution.join(', ')}</span>}
        </div>
        <div className={`pm-val-item ${v.overTotal.length > 0 ? 'error' : 'ok'}`}>
          <AlertTriangle size={14} /> 합계 초과 (&gt;100%): {v.overTotal.length}명
          {v.overTotal.length > 0 && <span className="pm-val-names">{v.overTotal.join(', ')}</span>}
        </div>
        <div className={`pm-val-item ${v.over3Resp.length > 0 ? 'error' : 'ok'}`}>
          <AlertTriangle size={14} /> 3책 위반: {v.over3Resp.length}명
          {v.over3Resp.map(r => (
            <span key={r.name} className="pm-val-names">{r.name} ({r.count}개{r.excluded > 0 ? `, 제외${r.excluded}` : ''})</span>
          ))}
        </div>
        <div className={`pm-val-item ${v.over5Co.length > 0 ? 'error' : 'ok'}`}>
          <AlertTriangle size={14} /> 5공 위반: {v.over5Co.length}명
          {v.over5Co.map(r => (
            <span key={r.name} className="pm-val-names">{r.name} ({r.count}개{r.excluded > 0 ? `, 제외${r.excluded}` : ''})</span>
          ))}
        </div>
        <div className={`pm-val-item ${v.minRateViolations.length > 0 ? 'warn' : 'ok'}`}>
          <AlertCircle size={14} /> 최소 참여율 미달: {v.minRateViolations.length}명
          {v.minRateViolations.map((r, i) => (
            <span key={i} className="pm-val-names">{r.name} ({r.project} {r.role}: {r.rate}% &lt; {r.min}%)</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══ 인라인 참여율 셀 ═══
function RateCell({ value, disabled, onChange, highlight, warnMin }: {
  value: number; disabled: boolean; onChange: (v: number) => void; highlight?: boolean; warnMin?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');

  const startEdit = () => { if (disabled) return; setInput(value > 0 ? value.toString() : ''); setEditing(true); };
  const save = () => {
    const v = parseInt(input, 10);
    if (input.trim() === '') { if (value !== 0) onChange(0); }
    else if (!isNaN(v) && v >= 0 && v <= 100 && v !== value) { onChange(v); }
    setEditing(false);
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save();
    else if (e.key === 'Escape') setEditing(false);
    else if (e.key === 'Tab') { e.preventDefault(); save(); }
  };

  if (editing) {
    return <input className="pm-rate-input" value={input} onChange={e => setInput(e.target.value)}
      onBlur={save} onKeyDown={handleKeyDown} autoFocus />;
  }
  if (disabled) return <span className="pm-rate-cell hm-disabled" />;

  const hm = value === 0 ? 'hm-0'
    : value <= 20 ? 'hm-20'
    : value <= 50 ? 'hm-50'
    : value <= 80 ? 'hm-80'
    : value < 100 ? 'hm-99'
    : value === 100 ? 'hm-100' : 'hm-over';

  return (
    <span className={`pm-rate-cell ${hm} ${highlight ? 'pm-highlight' : ''} ${warnMin ? 'pm-warn-min' : ''}`}
      onClick={startEdit}>
      {value > 0 ? value : '-'}
    </span>
  );
}

// ═══ 요약 보기 ═══
function SummaryView({
  projects, employees, data, month, year, email, onExpandProject, recentChanges, onEmployeeClick,
}: {
  projects: Project[]; employees: Employee[]; data: YearlyParticipation[];
  month: number; year: number; email: string;
  onExpandProject: (id: string) => void; recentChanges: Set<string>;
  onEmployeeClick: (emp: Employee) => void;
}) {
  const mKey = String(month);
  const displayEmployees = employees;

  const getRecord = (name: string, projId: string) => data.find(d => d.employeeName === name && d.projectId === projId);
  const getRate = (name: string, projId: string) => getRecord(name, projId)?.monthlyRates[mKey] || 0;

  const handleChange = async (emp: Employee, projId: string, rate: number) => {
    const existing = getRecord(emp.name, projId);
    await updateMonthlyRate(projId, emp.name, emp.employeeNumber, year, month, rate, '연구원', email, existing);
  };

  // 최소 참여율 위반 체크
  const isMinViolation = (empName: string, projId: string) => {
    const proj = projects.find(p => p.projectId === projId);
    if (!proj?.minRates) return false;
    const rec = getRecord(empName, projId);
    if (!rec) return false;
    const min = proj.minRates[rec.role];
    const rate = rec.monthlyRates[mKey] || 0;
    return min && rate > 0 && rate < min;
  };

  // 해당 직원의 모든 참여율 레코드 삭제
  const handleRemoveEmployee = async (emp: Employee) => {
    const recs = data.filter(d => d.employeeName === emp.name);
    if (recs.length === 0) return;
    if (!window.confirm(`${emp.name} 연구원의 참여율 데이터 ${recs.length}건을 모두 삭제하시겠습니까?\n(이후 매트릭스에서 제외됩니다)`)) return;
    await Promise.all(recs.map(r => deleteParticipation(r.id)));
  };

  return (
    <div className="pm-table-wrap">
      <table className="table pm-matrix">
        <thead>
          <tr>
            <th className="pm-sticky-col">연구원</th>
            <th>소속</th>
            {projects.map(p => (
              <th key={p.projectId} className="pm-proj-header" onClick={() => onExpandProject(p.projectId)}>{p.shortName} ▸</th>
            ))}
            <th className="pm-total-col">합계</th>
            <th>상태</th>
            <th className="pm-action-col">관리</th>
          </tr>
        </thead>
        <tbody>
          {displayEmployees.length === 0 && (
            <tr><td colSpan={projects.length + 5} className="pm-empty-row">셀을 클릭하여 참여율을 입력하세요.</td></tr>
          )}
          {displayEmployees.map(emp => {
            const total = projects.reduce((s, p) => s + getRate(emp.name, p.projectId), 0);
            const hasData = data.some(d => d.employeeName === emp.name);
            const isOver = total > 100;
            const isCaution = total >= 80 && total <= 100;
            return (
              <tr key={emp.employeeNumber} className={isOver ? 'pm-row-over' : ''}>
                <td className="pm-sticky-col pm-emp-name">
                  <span className="pm-emp-link" onClick={() => onEmployeeClick(emp)}>{emp.name}</span>
                  <RoleBadges name={emp.name} data={data} projects={projects} month={month} />
                </td>
                <td className="pm-dept">{emp.department}</td>
                {projects.map(p => {
                  const inRange = isMonthInProject(p, year, month);
                  const changeKey = `${emp.name}_${p.projectId}_${month}`;
                  return (
                    <td key={p.projectId} className="pm-rate-td">
                      <RateCell value={getRate(emp.name, p.projectId)} disabled={!inRange}
                        highlight={recentChanges.has(changeKey)}
                        warnMin={isMinViolation(emp.name, p.projectId)}
                        onChange={v => handleChange(emp, p.projectId, v)} />
                    </td>
                  );
                })}
                <td className={`pm-total-col ${isOver ? 'pm-over' : isCaution ? 'pm-caution' : ''}`}>
                  {total > 0 ? `${total}%` : '-'}
                </td>
                <td>
                  {isOver ? <span className="badge badge-danger">초과</span>
                    : isCaution ? <span className="badge badge-warning">주의</span>
                    : total > 0 ? <span className="badge badge-success">정상</span> : null}
                </td>
                <td className="pm-action-col">
                  {hasData && (
                    <button
                      className="pm-row-remove-btn"
                      onClick={() => handleRemoveEmployee(emp)}
                      title="이 연구원의 모든 참여율 데이터 삭제"
                    >
                      <X size={14} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══ 상세 보기 ═══
function DetailView({
  project, employees, data, year, email, onClose,
}: {
  project: Project; employees: Employee[]; data: YearlyParticipation[];
  year: number; email: string; onClose: () => void;
}) {
  const [bulkRate, setBulkRate] = useState('');
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(12);
  const [rangeRate, setRangeRate] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // 연구원 추가 폼
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState('');
  const [addRole, setAddRole] = useState<'책임연구원' | '연구원'>('연구원');

  // 신규 직원 등록 폼
  const [showNewEmpForm, setShowNewEmpForm] = useState(false);
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpNumber, setNewEmpNumber] = useState('');
  const [newEmpDept, setNewEmpDept] = useState('');
  const [newEmpPosition, setNewEmpPosition] = useState('');
  const [newEmpHireDate, setNewEmpHireDate] = useState('');
  const [savingNewEmp, setSavingNewEmp] = useState(false);

  const projData = useMemo(
    () => data.filter(d => d.projectId === project.projectId),
    [data, project.projectId],
  );
  const participatingNames = useMemo(
    () => new Set(projData.map(d => d.employeeName)),
    [projData],
  );
  const displayEmployees = showAll ? employees : employees.filter(e => participatingNames.has(e.name));

  // 추가 가능한 직원 (현재 미참여)
  const notParticipating = useMemo(
    () => employees.filter(e => !participatingNames.has(e.name)),
    [employees, participatingNames],
  );

  const getRecord = (name: string) => projData.find(d => d.employeeName === name);
  const getRate = (name: string, m: number) => getRecord(name)?.monthlyRates[String(m)] || 0;
  const getAvg = (name: string) => {
    const rec = getRecord(name);
    if (!rec) return 0;
    const vals = MONTHS.filter(m => isMonthInProject(project, year, m)).map(m => rec.monthlyRates[String(m)] || 0);
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };

  const handleChange = async (emp: Employee, month: number, rate: number) => {
    const rec = getRecord(emp.name);
    await updateMonthlyRate(project.projectId, emp.name, emp.employeeNumber, year, month, rate, rec?.role || '연구원', email, rec);
  };
  const handleBulk = async (emp: Employee) => {
    const r = parseInt(bulkRate, 10); if (isNaN(r) || r < 0 || r > 100) return;
    const valid = MONTHS.filter(m => isMonthInProject(project, year, m));
    if (valid.length === 0) return;
    const rec = getRecord(emp.name);
    await applyRateRange(project.projectId, emp.name, emp.employeeNumber, year, valid[0], valid[valid.length - 1], r, rec?.role || '연구원', email, rec);
  };
  const handleRange = async (emp: Employee) => {
    const r = parseInt(rangeRate, 10); if (isNaN(r) || r < 0 || r > 100) return;
    const rec = getRecord(emp.name);
    await applyRateRange(project.projectId, emp.name, emp.employeeNumber, year, rangeStart, rangeEnd, r, rec?.role || '연구원', email, rec);
  };

  // 연구원 추가 (빈 레코드 생성)
  const handleAddResearcher = async () => {
    const emp = employees.find(e => e.name === addName);
    if (!emp) { alert('직원을 선택하세요.'); return; }
    await saveParticipation({
      id: `${project.projectId}_${emp.name}_${year}`,
      projectId: project.projectId,
      employeeId: emp.employeeNumber,
      employeeName: emp.name,
      year,
      role: addRole,
      monthlyRates: {},
      averageRate: 0,
    }, email);
    setAddName('');
    setAddRole('연구원');
    setShowAddForm(false);
  };

  // 연구원 제거 (참여율 레코드 삭제)
  const handleRemoveResearcher = async (emp: Employee) => {
    const rec = getRecord(emp.name);
    if (!rec) return;
    if (!window.confirm(`${emp.name} 연구원을 이 과제에서 제거하시겠습니까?\n(${year}년 모든 월 참여율이 삭제됩니다)`)) return;
    await deleteParticipation(rec.id);
  };

  // 역할 토글 (책임연구원 ↔ 연구원)
  const handleToggleRole = async (emp: Employee) => {
    const rec = getRecord(emp.name);
    if (!rec) return;
    const newRole = rec.role === '책임연구원' ? '연구원' : '책임연구원';
    await saveParticipation({
      ...rec,
      role: newRole,
    }, email);
  };

  // 신규 직원을 /employees 마스터에 등록
  const handleCreateNewEmployee = async () => {
    const name = newEmpName.trim();
    const empNo = newEmpNumber.trim();
    if (!name || !empNo) {
      alert('이름과 사번은 필수입니다.');
      return;
    }
    if (employees.some(e => e.name === name)) {
      alert(`"${name}" 이름의 직원이 이미 존재합니다.`);
      return;
    }
    if (employees.some(e => e.employeeNumber === empNo)) {
      alert(`사번 "${empNo}"이 이미 존재합니다.`);
      return;
    }
    setSavingNewEmp(true);
    try {
      await addEmployee({
        name,
        employeeNumber: empNo,
        department: newEmpDept.trim(),
        position: newEmpPosition.trim(),
        hireDate: newEmpHireDate || '',
        salary: { ...EMPTY_SALARY },
        insurance: { ...EMPTY_INSURANCE },
        netPay: 0,
      });
      // 방금 등록한 직원을 참여 드롭다운에 자동 선택 (실시간 구독이 반영되면 나타남)
      setAddName(name);
      // 폼 리셋 + 닫기
      setNewEmpName('');
      setNewEmpNumber('');
      setNewEmpDept('');
      setNewEmpPosition('');
      setNewEmpHireDate('');
      setShowNewEmpForm(false);
      alert(`신규 직원 "${name}" 등록 완료. 역할 선택 후 "추가" 버튼을 눌러 참여시키세요.`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '직원 등록 실패');
    } finally {
      setSavingNewEmp(false);
    }
  };

  return (
    <div className="pm-detail-view">
      <div className="pm-detail-header">
        <button className="btn-secondary" onClick={onClose} style={{ height: 32, fontSize: 13 }}>← 요약 보기</button>
        <h3>{project.shortName} — {year}년 월별 참여율</h3>
        <button
          className="btn-secondary"
          onClick={() => setShowAddForm(!showAddForm)}
          style={{ height: 32, fontSize: 13, marginLeft: 'auto' }}
        >
          <UserPlus size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
          {showAddForm ? '추가 닫기' : '연구원 추가'}
        </button>
        <button className="btn-secondary" onClick={() => setShowBulk(!showBulk)} style={{ height: 32, fontSize: 13 }}>
          {showBulk ? '일괄 적용 닫기' : '일괄 적용'}
        </button>
      </div>

      {showAddForm && (
        <div className="pm-add-panel card">
          <div className="pm-add-row">
            <label>직원 선택</label>
            <select
              className="input pm-add-select"
              value={addName}
              onChange={e => setAddName(e.target.value)}
            >
              <option value="">-- 연구원 선택 --</option>
              {notParticipating.map(e => (
                <option key={e.employeeNumber} value={e.name}>
                  {e.name} ({e.department || '-'})
                </option>
              ))}
            </select>
            <label>역할</label>
            <select
              className="input pm-add-select"
              value={addRole}
              onChange={e => setAddRole(e.target.value as '책임연구원' | '연구원')}
            >
              <option value="연구원">연구원</option>
              <option value="책임연구원">책임연구원</option>
            </select>
            <button
              className="pm-apply-btn"
              onClick={handleAddResearcher}
              disabled={!addName}
              style={{ height: 32, padding: '0 14px' }}
            >
              <Plus size={14} style={{ verticalAlign: -2 }} /> 추가
            </button>
          </div>
          {notParticipating.length === 0 && (
            <div className="pm-add-hint">모든 직원이 이미 이 과제에 등록되어 있습니다.</div>
          )}

          {/* 신규 직원 등록 토글 */}
          <div className="pm-new-emp-toggle">
            <button
              type="button"
              className="pm-new-emp-link"
              onClick={() => setShowNewEmpForm(!showNewEmpForm)}
            >
              {showNewEmpForm ? '− 신규 직원 등록 닫기' : '＋ 목록에 없는 신규 직원인가요? 등록하기'}
            </button>
          </div>

          {showNewEmpForm && (
            <div className="pm-new-emp-panel">
              <div className="pm-new-emp-title">신규 직원 등록</div>
              <div className="pm-new-emp-grid">
                <div className="pm-new-emp-field">
                  <label>이름 *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="홍길동"
                    value={newEmpName}
                    onChange={e => setNewEmpName(e.target.value)}
                  />
                </div>
                <div className="pm-new-emp-field">
                  <label>사번 *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="예: 2026-0012"
                    value={newEmpNumber}
                    onChange={e => setNewEmpNumber(e.target.value)}
                  />
                </div>
                <div className="pm-new-emp-field">
                  <label>부서</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="예: 연구개발팀"
                    value={newEmpDept}
                    onChange={e => setNewEmpDept(e.target.value)}
                  />
                </div>
                <div className="pm-new-emp-field">
                  <label>직급</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="예: 선임연구원"
                    value={newEmpPosition}
                    onChange={e => setNewEmpPosition(e.target.value)}
                  />
                </div>
                <div className="pm-new-emp-field">
                  <label>입사일</label>
                  <input
                    type="date"
                    className="input"
                    value={newEmpHireDate}
                    onChange={e => setNewEmpHireDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="pm-new-emp-actions">
                <div className="pm-new-emp-hint">
                  급여·4대보험은 월별 급여대장 업로드 시 자동으로 매칭됩니다.
                </div>
                <button
                  className="pm-apply-btn"
                  onClick={handleCreateNewEmployee}
                  disabled={savingNewEmp || !newEmpName.trim() || !newEmpNumber.trim()}
                  style={{ height: 32, padding: '0 16px' }}
                >
                  {savingNewEmp ? '등록 중...' : '직원 등록'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showBulk && (
        <div className="pm-bulk-panel card">
          <div className="pm-bulk-row">
            <label>전체 월 적용:</label>
            <input className="input pm-bulk-input" placeholder="%" value={bulkRate} onChange={e => setBulkRate(e.target.value)} />
          </div>
          <div className="pm-bulk-row">
            <label>범위 적용:</label>
            <select className="input pm-bulk-select" value={rangeStart} onChange={e => setRangeStart(Number(e.target.value))}>
              {MONTHS.map(m => <option key={m} value={m}>{m}월</option>)}
            </select><span>~</span>
            <select className="input pm-bulk-select" value={rangeEnd} onChange={e => setRangeEnd(Number(e.target.value))}>
              {MONTHS.map(m => <option key={m} value={m}>{m}월</option>)}
            </select>
            <input className="input pm-bulk-input" placeholder="%" value={rangeRate} onChange={e => setRangeRate(e.target.value)} />
          </div>
        </div>
      )}
      <div className="pm-show-all"><label><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> 전체 직원 표시</label></div>
      <div className="pm-table-wrap">
        <table className="table pm-matrix pm-detail-table">
          <thead>
            <tr>
              <th className="pm-sticky-col">연구원</th>
              <th className="pm-role-col">역할</th>
              {MONTHS.map(m => <th key={m} className={!isMonthInProject(project, year, m) ? 'pm-disabled-header' : ''}>{m}월</th>)}
              <th>평균</th>
              {showBulk && <th>일괄</th>}
              <th className="pm-action-col">관리</th>
            </tr>
          </thead>
          <tbody>
            {displayEmployees.length === 0 && <tr><td colSpan={MONTHS.length + 5} className="pm-empty-row">연구원을 추가하거나 "전체 직원 표시"를 체크하세요.</td></tr>}
            {displayEmployees.map(emp => {
              const rec = getRecord(emp.name);
              const role = rec?.role || '-';
              return (
                <tr key={emp.employeeNumber}>
                  <td className="pm-sticky-col pm-emp-name">{emp.name}</td>
                  <td className="pm-role-col">
                    {rec ? (
                      <button
                        className={`pm-role-toggle ${role === '책임연구원' ? 'pm-role-resp' : 'pm-role-co'}`}
                        onClick={() => handleToggleRole(emp)}
                        title="클릭하여 역할 변경"
                      >
                        {role === '책임연구원' ? '책임' : '연구'}
                      </button>
                    ) : (
                      <span style={{ color: 'var(--c-text-4,#bbb)', fontSize: 11 }}>-</span>
                    )}
                  </td>
                  {MONTHS.map(m => (
                    <td key={m} className="pm-rate-td">
                      <RateCell value={getRate(emp.name, m)} disabled={!isMonthInProject(project, year, m)}
                        onChange={v => handleChange(emp, m, v)} />
                    </td>
                  ))}
                  <td className="pm-avg">{getAvg(emp.name) > 0 ? `${getAvg(emp.name)}%` : '-'}</td>
                  {showBulk && (
                    <td className="pm-bulk-actions">
                      {bulkRate && <button className="pm-apply-btn" onClick={() => handleBulk(emp)}>전체</button>}
                      {rangeRate && <button className="pm-apply-btn" onClick={() => handleRange(emp)}>범위</button>}
                    </td>
                  )}
                  <td className="pm-action-col">
                    {rec && (
                      <button
                        className="pm-row-remove-btn"
                        onClick={() => handleRemoveResearcher(emp)}
                        title="이 과제에서 연구원 제거"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══ 메인 ═══
const ParticipationManager: React.FC = () => {
  const { user } = useAuth();
  const email = user?.email || '';
  const { activeProjects } = useProjects();
  const { employees } = useEmployees();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [data, setData] = useState<YearlyParticipation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'participating' | 'over80' | 'over100'>('participating');
  const [filterDept, setFilterDept] = useState<string>('');
  const [recentChanges, setRecentChanges] = useState<Set<string>>(new Set());
  const years = [currentYear - 1, currentYear, currentYear + 1];

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeYearlyParticipations(selectedYear, newData => {
      setData(prev => {
        const changes = new Set<string>();
        for (const d of newData) {
          const old = prev.find(p => p.id === d.id);
          if (old) { for (const m of MONTHS) { const mk = String(m); if ((old.monthlyRates[mk] || 0) !== (d.monthlyRates[mk] || 0)) changes.add(`${d.employeeName}_${d.projectId}_${m}`); } }
        }
        if (changes.size > 0) { setRecentChanges(changes); setTimeout(() => setRecentChanges(new Set()), 2000); }
        return newData;
      });
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [selectedYear]);

  const validation = useMemo(() => runValidation(data, activeProjects, employees, selectedMonth), [data, activeProjects, employees, selectedMonth]);

  const downloadExcel = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const mKey = String(selectedMonth);

    // 시트 1: 요약
    const summaryRows: Record<string, any>[] = [];
    let no = 0;
    for (const emp of employees) {
      const row: Record<string, any> = {};
      let total = 0;
      let hasData = false;
      for (const proj of activeProjects) {
        const rec = data.find(d => d.employeeName === emp.name && d.projectId === proj.projectId);
        const rate = rec?.monthlyRates[mKey] || 0;
        row[proj.shortName] = rate > 0 ? `${rate}%` : '';
        total += rate;
        if (rate > 0) hasData = true;
      }
      if (!hasData) continue;
      no++;
      summaryRows.push({ 'NO': no, '이름': emp.name, '소속': emp.department,
        '수행과제수': Object.values(row).filter(v => v && v !== '').length,
        ...row, '합계': `${total}%` });
    }
    const ws1 = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, ws1, '요약');

    // 시트 2: 상세
    const detailRows: Record<string, any>[] = [];
    let dno = 0;
    for (const emp of employees) {
      for (const proj of activeProjects) {
        const rec = data.find(d => d.employeeName === emp.name && d.projectId === proj.projectId);
        if (!rec) continue;
        const hasAny = MONTHS.some(m => (rec.monthlyRates[String(m)] || 0) > 0);
        if (!hasAny) continue;
        dno++;
        const row: Record<string, any> = { 'NO': dno, '이름': emp.name, '소속': emp.department,
          '과제': proj.shortName, '역할': rec.role };
        const rates: number[] = [];
        for (const m of MONTHS) {
          const inRange = isMonthInProject(proj, selectedYear, m);
          const rate = rec.monthlyRates[String(m)] || 0;
          row[`${m}월`] = inRange ? (rate > 0 ? `${rate}%` : '0%') : '';
          if (inRange) rates.push(rate);
        }
        row['평균'] = rates.length > 0 ? `${Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)}%` : '';
        detailRows.push(row);
      }
    }
    const ws2 = XLSX.utils.json_to_sheet(detailRows);
    XLSX.utils.book_append_sheet(wb, ws2, '상세');

    XLSX.writeFile(wb, `참여율현황_${selectedYear}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [employees, activeProjects, data, selectedYear, selectedMonth]);

  const departments = useMemo(() => {
    const depts = new Set(employees.map(e => e.department).filter(Boolean));
    return Array.from(depts).sort();
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const mKey = String(selectedMonth);
    let list = [...employees];

    // 부서 필터
    if (filterDept) list = list.filter(e => e.department === filterDept);

    // 모드 필터
    if (filterMode === 'participating') {
      const names = new Set(data.map(d => d.employeeName));
      list = list.filter(e => names.has(e.name));
    } else if (filterMode === 'over80' || filterMode === 'over100') {
      const threshold = filterMode === 'over80' ? 80 : 100;
      list = list.filter(e => {
        const total = activeProjects.reduce((s, p) => {
          const rec = data.find(d => d.employeeName === e.name && d.projectId === p.projectId);
          return s + (rec?.monthlyRates[mKey] || 0);
        }, 0);
        return total >= threshold;
      });
    }
    return list;
  }, [employees, data, activeProjects, selectedMonth, filterMode, filterDept]);

  const expandedProject = activeProjects.find(p => p.projectId === expandedProjectId);

  return (
    <div className="pm-container">
      <div className="pm-toolbar">
        <div className="pm-year-tabs">
          {years.map(y => (
            <button key={y} className={`pm-year-tab ${y === selectedYear ? 'active' : ''}`}
              onClick={() => { setSelectedYear(y); setExpandedProjectId(null); }}>{y}</button>
          ))}
        </div>
        {!expandedProjectId && (
          <div className="pm-month-selector">
            <button className="pm-month-btn" onClick={() => setSelectedMonth(Math.max(1, selectedMonth - 1))}><ChevronLeft size={16} /></button>
            <span className="pm-month-label">{selectedMonth}월</span>
            <button className="pm-month-btn" onClick={() => setSelectedMonth(Math.min(12, selectedMonth + 1))}><ChevronRight size={16} /></button>
          </div>
        )}
        <button className="btn-secondary pm-excel-btn" onClick={() => setShowUpload(true)}><Upload size={15} /> 업로드</button>
        <button className="btn-secondary pm-excel-btn" onClick={downloadExcel}><Download size={15} /> 다운로드</button>
      </div>
      {/* 필터 바 */}
      <div className="pm-filters">
        <div className="pm-filter-group">
          <select className="input pm-filter-select" value={filterMode}
            onChange={e => setFilterMode(e.target.value as any)}>
            <option value="all">전체 직원</option>
            <option value="participating">참여중만</option>
            <option value="over80">합계 80% 이상</option>
            <option value="over100">합계 100% 초과</option>
          </select>
          <select className="input pm-filter-select" value={filterDept}
            onChange={e => setFilterDept(e.target.value)}>
            <option value="">전체 소속</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <span className="pm-filter-count">{filteredEmployees.length}명</span>
        </div>
      </div>

      {loading ? (
        <div className="pm-skeleton">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="pm-skeleton-row" style={{ width: `${85 + Math.random() * 15}%`, animationDelay: `${i * 0.1}s` }} />)}
        </div>
      )
        : expandedProject ? <DetailView project={expandedProject} employees={employees} data={data} year={selectedYear} email={email} onClose={() => setExpandedProjectId(null)} />
        : <SummaryView projects={activeProjects} employees={filteredEmployees} data={data} month={selectedMonth} year={selectedYear} email={email} onExpandProject={id => setExpandedProjectId(id)} recentChanges={recentChanges} onEmployeeClick={emp => setSelectedEmployee(emp)} />}

      {!loading && data.length > 0 && <ValidationPanel v={validation} />}

      {!loading && data.length === 0 && (
        <div className="pm-empty">
          <p>아직 {selectedYear}년 참여율 데이터가 없습니다.</p>
          <p className="pm-empty-sub">매트릭스 셀을 클릭하여 직접 입력하거나, 엑셀을 업로드하세요.</p>
        </div>
      )}

      {showUpload && (
        <ParticipationUploadModal
          projects={activeProjects}
          employees={employees}
          existingData={data}
          year={selectedYear}
          onClose={() => setShowUpload(false)}
          onComplete={() => {}}
        />
      )}

      {selectedEmployee && (
        <EmployeeDetailPanel
          employee={selectedEmployee}
          data={data}
          projects={activeProjects}
          year={selectedYear}
          onClose={() => setSelectedEmployee(null)}
        />
      )}
    </div>
  );
};

// 외부에서 violation count 접근용 export
export { runValidation };
export default ParticipationManager;
