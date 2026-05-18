import React, { useState, useMemo, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Employee, Project, YearlyParticipation } from '../../types/project';
import { calcLaborSalary } from '../../services/payrollParserService';
import { updateBudgetDetail } from '../../services/budgetService';
import { logAction } from '../../services/auditService';
import { useAuth } from '../../hooks/useAuth';
import './LaborCostTab.css';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function formatWon(n: number): string { return n.toLocaleString() + '원'; }

function isMonthInProject(project: Project, year: number, month: number): boolean {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  for (const y of project.years) {
    if (ym >= y.start.slice(0, 7) && ym <= y.end.slice(0, 7)) return true;
  }
  return false;
}

function getYearsSinceHire(hireDate: string, targetDate: string): number {
  if (!hireDate) return 0;
  const h = new Date(hireDate);
  const t = new Date(targetDate);
  return (t.getTime() - h.getTime()) / (365.25 * 86400000);
}

// ═══ 월별 급여 데이터 타입 ═══
interface MonthlyPayroll {
  totalPay: number;
  basePay: number;
  mealAllowance: number;
  vehicleAllowance: number;
  researchAllowance: number;
  childcareAllowance: number;
}

interface MonthlyInsurance {
  nationalPension: number;
  nationalPensionCompany: number;
  healthInsurance: number;
  healthInsuranceCompany: number;
  longTermCare: number;
  longTermCareCompany: number;
  employmentInsurance: number;
  employmentInsCompany: number;
  industrialAccident: number;
  totalCompanyBurden: number;
}

// ═══ 인건비 계산 결과 ═══
interface LaborCalcRow {
  emp: Employee;
  rate: number;
  role: string;
  salary: number;         // A: 월급여
  retirement: number;     // B: 퇴직금추계
  insurance: MonthlyInsurance;
  totalCost: number;      // A+B+C
  cash: number;
  inKind: number;
  total: number;
}

interface Props {
  yearMonth: string;
  employees: Employee[];
  activeProjects: Project[];
  participations: YearlyParticipation[];
}

const LaborCostTab: React.FC<Props> = ({ yearMonth, employees, activeProjects, participations }) => {
  const { user } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState(activeProjects[0]?.projectId || '');
  const [monthlyData, setMonthlyData] = useState<any>(null);
  const [autoSync, setAutoSync] = useState(true);
  const [view, setView] = useState<'summary' | 'detail' | 'monthly'>('summary');

  const year = parseInt(yearMonth.slice(0, 4), 10);
  const month = parseInt(yearMonth.slice(5), 10);
  const project = activeProjects.find(p => p.projectId === selectedProjectId);

  // 월별 급여/보험 데이터 로드
  useEffect(() => {
    const load = async () => {
      const snap = await getDoc(doc(db, 'monthlyData', yearMonth));
      if (snap.exists()) setMonthlyData(snap.data());
      else setMonthlyData(null);
    };
    load();
  }, [yearMonth]);

  // 인건비 계산
  const laborData = useMemo((): LaborCalcRow[] => {
    if (!project) return [];
    const results: LaborCalcRow[] = [];
    const projParts = participations.filter(p => p.projectId === selectedProjectId);

    for (const part of projParts) {
      const rate = part.monthlyRates[String(month)] || 0;
      if (rate === 0) continue;

      const emp = employees.find(e => e.name === part.employeeName);
      if (!emp) continue;

      // 급여 데이터: monthlyData 우선, 없으면 employees 마스터
      const payrollData = monthlyData?.payroll?.data?.[emp.name];
      const insData = monthlyData?.insurance?.data?.[emp.name];

      const salary = calcLaborSalary(emp, payrollData);
      const yearsWorked = getYearsSinceHire(emp.hireDate, `${yearMonth}-01`);
      // 퇴직금 추계 = 월급여/12 (1년 이상 근로자만, 기본 자동값)
      const autoRetirement = yearsWorked >= 1 ? Math.round(salary / 12) : 0;
      // 직원별 수동 조정값(adj.retirement) 있으면 우선 적용 — 1년 이상이라도 0으로 빼거나 임의 값으로 강제 가능
      const retirementAdj = monthlyData?.laborAdjustments?.[selectedProjectId]?.[emp.employeeNumber]?.retirement;
      const retirement = retirementAdj ?? autoRetirement;

      // 보험별 fallback: 일부 보험만 업로드된 경우 나머지는 직원 마스터(emp.insurance)에서 보충
      // — 4대보험 중 한 종이라도 EDI 누락되어도 0으로 빠지지 않도록
      const m: any = insData || {};
      const ie: any = emp.insurance || {};
      const insurance: MonthlyInsurance = {
        nationalPension: m.nationalPension ?? ie.nationalPension ?? 0,
        nationalPensionCompany: m.nationalPensionCompany ?? ie.nationalPensionCompany ?? 0,
        healthInsurance: m.healthInsurance ?? ie.healthInsurance ?? 0,
        healthInsuranceCompany: m.healthInsuranceCompany ?? ie.healthInsuranceCompany ?? 0,
        longTermCare: m.longTermCare ?? ie.longTermCare ?? 0,
        longTermCareCompany: m.longTermCareCompany ?? ie.longTermCareCompany ?? 0,
        employmentInsurance: m.employmentInsurance ?? ie.employmentInsurance ?? 0,
        employmentInsCompany: m.employmentInsCompany ?? ie.employmentInsCompany ?? 0,
        industrialAccident: m.industrialAccident ?? ie.industrialAccident ?? 0,
        totalCompanyBurden: 0,
      };

      const companyBurden =
        (insurance.nationalPensionCompany || 0) +
        (insurance.healthInsuranceCompany || 0) +
        (insurance.longTermCareCompany || 0) +
        (insurance.employmentInsCompany || 0) +
        (insurance.industrialAccident || 0);
      insurance.totalCompanyBurden = companyBurden;

      const totalCost = salary + retirement + companyBurden;
      // 정부과제 인건비 집행은 천원 단위 round-down (엑셀 정산서식 관행)
      const baseTotal = Math.floor((totalCost * rate / 100) / 1000) * 1000;

      // 참여형태: 'inKind' = 100% 현물, 그 외(default 'cash') = 100% 현금
      const baseCash = part.participationType === 'inKind' ? 0 : baseTotal;
      const baseInKind = baseTotal - baseCash;
      // 사용자 수동 조정값(firestore에 영구 저장) 우선 적용
      const adj = monthlyData?.laborAdjustments?.[selectedProjectId]?.[emp.employeeNumber];
      const cash = adj?.cash ?? baseCash;
      const inKind = adj?.inKind ?? baseInKind;
      // 합계는 항상 cash + inKind로 — 수동 수정값이 합계에 즉시 반영되도록
      const total = cash + inKind;

      results.push({ emp, rate, role: part.role, salary, retirement, insurance, totalCost, cash, inKind, total });
    }
    return results.sort((a, b) => (a.emp.employeeNumber || '').localeCompare(b.emp.employeeNumber || ''));
  }, [selectedProjectId, month, participations, employees, project, monthlyData]);

  const totals = useMemo(() => laborData.reduce((acc, d) => ({
    salary: acc.salary + d.salary,
    retirement: acc.retirement + d.retirement,
    np: acc.np + (d.insurance.nationalPensionCompany || 0),
    hi: acc.hi + (d.insurance.healthInsuranceCompany || 0),
    ltc: acc.ltc + (d.insurance.longTermCareCompany || 0),
    ei: acc.ei + (d.insurance.employmentInsCompany || 0),
    ia: acc.ia + (d.insurance.industrialAccident || 0),
    companyBurden: acc.companyBurden + (d.insurance.totalCompanyBurden || 0),
    totalCost: acc.totalCost + d.totalCost,
    cash: acc.cash + d.cash,
    inKind: acc.inKind + d.inKind,
    total: acc.total + d.total,
  }), { salary: 0, retirement: 0, np: 0, hi: 0, ltc: 0, ei: 0, ia: 0, companyBurden: 0, totalCost: 0, cash: 0, inKind: 0, total: 0 }), [laborData]);

  // 월별 누적 계산
  const monthlyCumulative = useMemo(() => {
    if (!project) return [];
    const rows: { month: number; cash: number; inKind: number; total: number; cumulative: number }[] = [];
    let cumul = 0;

    for (const m of MONTHS) {
      if (!isMonthInProject(project, year, m)) continue;
      const projParts = participations.filter(p => p.projectId === selectedProjectId);
      let mCash = 0, mInKind = 0;

      for (const part of projParts) {
        const rate = part.monthlyRates[String(m)] || 0;
        if (rate === 0) continue;
        const emp = employees.find(e => e.name === part.employeeName);
        if (!emp) continue;

        const salary = calcLaborSalary(emp);
        const yearsWorked = getYearsSinceHire(emp.hireDate, `${year}-${String(m).padStart(2, '0')}-01`);
        // 퇴직금 추계 = 월급여/12 (1년 이상 근로자만) — PrintTab과 동일 로직
        const ret = yearsWorked >= 1 ? Math.round(salary / 12) : 0;
        const ins = emp.insurance?.totalCompanyBurden || 0;
        const cost = salary + ret + ins;
        // 천원 단위 round-down (정부과제 정산서식)
        const total = Math.floor((cost * rate / 100) / 1000) * 1000;

        // 참여형태: 'inKind' = 100% 현물, default 'cash'
        const cashShare = part.participationType === 'inKind' ? 0 : total;
        mCash += cashShare;
        mInKind += total - cashShare;
      }

      cumul += mCash + mInKind;
      rows.push({ month: m, cash: mCash, inKind: mInKind, total: mCash + mInKind, cumulative: cumul });
    }
    return rows;
  }, [selectedProjectId, year, participations, employees, project]);

  const hasPayrollData = !!monthlyData?.payroll;

  // 현금/현물 수동 조정값 firestore 저장 (LaborCostTab이 데이터 마스터 — PrintTab은 read-only)
  const saveAdjustment = async (empNumber: string, field: 'cash' | 'inKind' | 'retirement', value: number) => {
    console.log('[saveAdjustment]', { yearMonth, projectId: selectedProjectId, empNumber, field, value });
    if (!selectedProjectId) {
      console.warn('[saveAdjustment] selectedProjectId 비어있음 — 저장 안 함');
      return;
    }
    const next = { ...(monthlyData || {}) };
    next.laborAdjustments = { ...(next.laborAdjustments || {}) };
    next.laborAdjustments[selectedProjectId] = { ...(next.laborAdjustments[selectedProjectId] || {}) };
    next.laborAdjustments[selectedProjectId][empNumber] = {
      ...(next.laborAdjustments[selectedProjectId][empNumber] || {}),
      [field]: Math.max(0, value || 0),
    };
    setMonthlyData(next);
    try {
      await setDoc(doc(db, 'monthlyData', yearMonth),
        { laborAdjustments: next.laborAdjustments }, { merge: true });
      console.log('[saveAdjustment] firestore 저장 성공');
      logAction('update', 'laborAdjustment', selectedProjectId, `${empNumber}.${field}`, null, value, user?.email || '');
    } catch (e: any) {
      console.error('[saveAdjustment] firestore 저장 실패:', e);
      alert('인건비 조정값 저장 실패: ' + (e?.message || e));
    }
  };

  const resetAdjustments = async () => {
    if (!window.confirm(`${project?.shortName} ${yearMonth} 현금/현물 조정값을 모두 초기화하시겠습니까?`)) return;
    const next = { ...(monthlyData || {}) };
    next.laborAdjustments = { ...(next.laborAdjustments || {}) };
    delete next.laborAdjustments[selectedProjectId];
    setMonthlyData(next);
    await setDoc(doc(db, 'monthlyData', yearMonth),
      { laborAdjustments: next.laborAdjustments }, { merge: true });
  };

  return (
    <div className="lct-container">
      <div className="lct-header">
        <h3 className="pp-tab-title">과제별 인건비 산출</h3>
        <div className="lct-controls">
          <div className="lct-project-tabs">
            {activeProjects.map(p => (
              <button key={p.projectId} className={`lct-proj-tab ${selectedProjectId === p.projectId ? 'active' : ''}`}
                onClick={() => setSelectedProjectId(p.projectId)}>{p.shortName}</button>
            ))}
          </div>
        </div>
      </div>

      {project && (
        <div className="lct-info-bar">
          <span>{project.shortName} · {yearMonth} · 참여연구원 {laborData.length}명</span>
          <div className="lct-view-tabs">
            <button className={`lct-view-tab ${view === 'summary' ? 'active' : ''}`} onClick={() => setView('summary')}>인건비 집행</button>
            <button className={`lct-view-tab ${view === 'detail' ? 'active' : ''}`} onClick={() => setView('detail')}>단가 상세</button>
            <button className={`lct-view-tab ${view === 'monthly' ? 'active' : ''}`} onClick={() => setView('monthly')}>월별 누적</button>
          </div>
          <label className="lct-sync-toggle">
            <input type="checkbox" checked={autoSync} onChange={e => setAutoSync(e.target.checked)} />
            예산 자동 반영
          </label>
        </div>
      )}

      {!hasPayrollData && (
        <div className="lct-warning">급여대장을 먼저 업로드해주세요. 현재 직원 마스터 데이터를 사용합니다.</div>
      )}

      {laborData.length === 0 ? (
        <div className="lct-empty">
          <p>이 과제에 {month}월 참여 연구원이 없습니다.</p>
          <p className="pp-tab-desc">참여율관리에서 참여율을 먼저 입력해주세요.</p>
        </div>
      ) : (
        <>
          {/* 표 1: 인건비 집행 */}
          {view === 'summary' && (
            <div className="lct-table-wrap">
              <table className="table lct-table">
                <thead>
                  <tr>
                    <th>성명</th><th>직책</th><th>역할</th>
                    <th style={{ textAlign: 'right' }}>참여율</th>
                    <th style={{ textAlign: 'right' }}>월급여</th>
                    <th style={{ textAlign: 'right' }}>4대보험</th>
                    <th style={{ textAlign: 'right' }}>현금</th>
                    <th style={{ textAlign: 'right' }}>현물</th>
                    <th style={{ textAlign: 'right' }}>합계</th>
                  </tr>
                </thead>
                <tbody>
                  {laborData.map(d => (
                    <tr key={d.emp.employeeNumber}>
                      <td className="lct-name">{d.emp.name}</td>
                      <td>{d.emp.position}</td>
                      <td><span className="lct-role">{d.role}</span></td>
                      <td className="money">{d.rate}%</td>
                      <td className="money">{formatWon(d.salary)}</td>
                      <td className="money">{formatWon(d.insurance.totalCompanyBurden || 0)}</td>
                      <td className="money">{formatWon(d.cash)}</td>
                      <td className="money">{formatWon(d.inKind)}</td>
                      <td className="money lct-total">{formatWon(d.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}><strong>합계 ({laborData.length}명)</strong></td>
                    <td className="money"><strong>{formatWon(totals.salary)}</strong></td>
                    <td className="money"><strong>{formatWon(totals.companyBurden)}</strong></td>
                    <td className="money"><strong>{formatWon(totals.cash)}</strong></td>
                    <td className="money"><strong>{formatWon(totals.inKind)}</strong></td>
                    <td className="money lct-total"><strong>{formatWon(totals.total)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* 표 2: 인건비 단가 상세 */}
          {view === 'detail' && (
            <>
            <div className="lct-detail-header">
              <span style={{ fontSize: 12, color: 'var(--text-hint)' }}>
                ※ 현금/현물 셀 클릭하여 직접 수정 — 변경값은 즉시 저장되며 <strong>서류 출력</strong>에도 그대로 반영됩니다
              </span>
              <button type="button" className="lct-reset-btn" onClick={resetAdjustments}
                title="현재 과제·월의 수동 조정값 초기화">↺ 초기화</button>
            </div>
            <div className="lct-table-wrap">
              <table className="table lct-table">
                <thead>
                  <tr>
                    <th>성명</th><th>직책</th>
                    <th style={{ textAlign: 'right' }}>월급여(A)</th>
                    <th style={{ textAlign: 'right' }}>퇴직금(B)</th>
                    <th style={{ textAlign: 'right' }}>국민연금</th>
                    <th style={{ textAlign: 'right' }}>건강보험</th>
                    <th style={{ textAlign: 'right' }}>장기요양</th>
                    <th style={{ textAlign: 'right' }}>고용보험</th>
                    <th style={{ textAlign: 'right' }}>산재보험</th>
                    <th style={{ textAlign: 'right' }}>합계(A+B+C)</th>
                    <th style={{ textAlign: 'right' }}>참여율</th>
                    <th style={{ textAlign: 'right' }}>현금</th>
                    <th style={{ textAlign: 'right' }}>현물</th>
                    <th style={{ textAlign: 'right' }}>집행액</th>
                  </tr>
                </thead>
                <tbody>
                  {laborData.map(d => {
                    const isExec = ['대표이사', '이사'].includes(d.emp.position);
                    return (
                    <tr key={d.emp.employeeNumber}>
                      <td className="lct-name">{d.emp.name}</td>
                      <td>{d.emp.position}</td>
                      <td className="money">{formatWon(d.salary)}</td>
                      <td className="money">
                        <input type="text" inputMode="numeric" className="lct-edit-cell"
                          value={d.retirement.toLocaleString()}
                          onChange={(e) => {
                            const num = parseInt(e.target.value.replace(/[^\d-]/g, ''), 10) || 0;
                            saveAdjustment(d.emp.employeeNumber, 'retirement', num);
                          }}
                          title="퇴직금 — 클릭하여 수정 (0 입력 시 미산정)" />
                      </td>
                      <td className="money">{formatWon(d.insurance.nationalPensionCompany || 0)}</td>
                      <td className="money">{formatWon(d.insurance.healthInsuranceCompany || 0)}</td>
                      <td className="money">{formatWon(d.insurance.longTermCareCompany || 0)}</td>
                      <td className="money">{isExec ? '-' : formatWon(d.insurance.employmentInsCompany || 0)}</td>
                      <td className="money">{isExec ? '-' : formatWon(d.insurance.industrialAccident || 0)}</td>
                      <td className="money lct-total">{formatWon(d.totalCost)}</td>
                      <td className="money">{d.rate}%</td>
                      <td className="money">
                        <input type="text" inputMode="numeric" className="lct-edit-cell"
                          value={d.cash.toLocaleString()}
                          onChange={(e) => {
                            const num = parseInt(e.target.value.replace(/[^\d-]/g, ''), 10) || 0;
                            saveAdjustment(d.emp.employeeNumber, 'cash', num);
                          }}
                          title="현금 — 클릭하여 수정" />
                      </td>
                      <td className="money">
                        <input type="text" inputMode="numeric" className="lct-edit-cell"
                          value={d.inKind.toLocaleString()}
                          onChange={(e) => {
                            const num = parseInt(e.target.value.replace(/[^\d-]/g, ''), 10) || 0;
                            saveAdjustment(d.emp.employeeNumber, 'inKind', num);
                          }}
                          title="현물 — 클릭하여 수정" />
                      </td>
                      <td className="money lct-total">{formatWon(d.cash + d.inKind)}</td>
                    </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><strong>합계</strong></td>
                    <td className="money"><strong>{formatWon(totals.salary)}</strong></td>
                    <td className="money"><strong>{formatWon(totals.retirement)}</strong></td>
                    <td className="money"><strong>{formatWon(totals.np)}</strong></td>
                    <td className="money"><strong>{formatWon(totals.hi)}</strong></td>
                    <td className="money"><strong>{formatWon(totals.ltc)}</strong></td>
                    <td className="money"><strong>{formatWon(totals.ei)}</strong></td>
                    <td className="money"><strong>{formatWon(totals.ia)}</strong></td>
                    <td className="money lct-total"><strong>{formatWon(totals.totalCost)}</strong></td>
                    <td />
                    <td className="money"><strong>{formatWon(totals.cash)}</strong></td>
                    <td className="money"><strong>{formatWon(totals.inKind)}</strong></td>
                    <td className="money lct-total"><strong>{formatWon(totals.total)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            </>
          )}

          {/* 표 3: 월별 누적 */}
          {view === 'monthly' && (
            <div className="lct-table-wrap">
              <table className="table lct-table">
                <thead>
                  <tr>
                    <th>월</th>
                    <th style={{ textAlign: 'right' }}>인건비(현금)</th>
                    <th style={{ textAlign: 'right' }}>인건비(현물)</th>
                    <th style={{ textAlign: 'right' }}>합계</th>
                    <th style={{ textAlign: 'right' }}>누적합계</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyCumulative.map(r => (
                    <tr key={r.month} className={r.month === month ? 'lct-current-month' : ''}>
                      <td>{r.month}월 {r.month === month && <span className="lct-current-badge">현재</span>}</td>
                      <td className="money">{formatWon(r.cash)}</td>
                      <td className="money">{formatWon(r.inKind)}</td>
                      <td className="money">{formatWon(r.total)}</td>
                      <td className="money lct-total">{formatWon(r.cumulative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default LaborCostTab;
