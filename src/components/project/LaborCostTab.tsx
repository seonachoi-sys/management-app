import React, { useState, useMemo, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Employee, Project, YearlyParticipation, isExecutive } from '../../types/project';
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

    // 연차별 예산에서 현금/현물 비율 산출
    const curYear = project.years.find(y => {
      const today = new Date().toISOString().slice(0, 10);
      return today >= y.start && today <= y.end;
    }) || project.years[0];
    const cashBudget = curYear?.budget?.privateCash || 0;
    const inkindBudget = curYear?.budget?.privateInKind || 0;
    const budgetTotal = cashBudget + inkindBudget;
    const cashRatio = budgetTotal > 0 ? cashBudget / budgetTotal : 0;

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
      const retirement = 0; // 퇴직금 추계 미반영

      const insurance: MonthlyInsurance = insData || emp.insurance || {
        nationalPension: 0, nationalPensionCompany: 0,
        healthInsurance: 0, healthInsuranceCompany: 0,
        longTermCare: 0, longTermCareCompany: 0,
        employmentInsurance: 0, employmentInsCompany: 0,
        industrialAccident: 0, totalCompanyBurden: 0,
      };

      const companyBurden = insurance.totalCompanyBurden || (
        (insurance.nationalPensionCompany || 0) +
        (insurance.healthInsuranceCompany || 0) +
        (insurance.longTermCareCompany || 0) +
        (insurance.employmentInsCompany || 0) +
        (insurance.industrialAccident || 0)
      );

      const totalCost = salary + retirement + companyBurden;
      const total = Math.round(totalCost * rate / 100);

      // 임원(박재민/문재훈/안준/신규보)은 100% 현물, 그 외는 과제 예산 비율
      const cash = isExecutive(emp.name) ? 0 : Math.round(total * cashRatio);
      const inKind = total - cash;

      results.push({ emp, rate, role: part.role, salary, retirement, insurance, totalCost, cash, inKind, total });
    }
    return results.sort((a, b) => (a.emp.employeeNumber || '').localeCompare(b.emp.employeeNumber || ''));
  }, [selectedProjectId, month, participations, employees, project, monthlyData]);

  const totals = useMemo(() => laborData.reduce((acc, d) => ({
    salary: acc.salary + d.salary,
    retirement: acc.retirement + d.retirement,
    companyBurden: acc.companyBurden + (d.insurance.totalCompanyBurden || 0),
    totalCost: acc.totalCost + d.totalCost,
    cash: acc.cash + d.cash,
    inKind: acc.inKind + d.inKind,
    total: acc.total + d.total,
  }), { salary: 0, retirement: 0, companyBurden: 0, totalCost: 0, cash: 0, inKind: 0, total: 0 }), [laborData]);

  // 월별 누적 계산
  const monthlyCumulative = useMemo(() => {
    if (!project) return [];
    const rows: { month: number; cash: number; inKind: number; total: number; cumulative: number }[] = [];
    let cumul = 0;

    for (const m of MONTHS) {
      if (!isMonthInProject(project, year, m)) continue;
      const projParts = participations.filter(p => p.projectId === selectedProjectId);
      let mCash = 0, mInKind = 0;

      // 연차별 예산에서 현금/현물 비율 산출
      const curY = project.years.find(y => {
        const d = `${year}-${String(m).padStart(2, '0')}-15`;
        return d >= y.start && d <= y.end;
      }) || project.years[0];
      const cBudget = curY?.budget?.privateCash || 0;
      const iBudget = curY?.budget?.privateInKind || 0;
      const bTotal = cBudget + iBudget;
      const cRatio = bTotal > 0 ? cBudget / bTotal : 0;

      for (const part of projParts) {
        const rate = part.monthlyRates[String(m)] || 0;
        if (rate === 0) continue;
        const emp = employees.find(e => e.name === part.employeeName);
        if (!emp) continue;

        const salary = calcLaborSalary(emp);
        const yearsWorked = getYearsSinceHire(emp.hireDate, `${year}-${String(m).padStart(2, '0')}-01`);
        const ret = 0; // 퇴직금 추계 미반영
        const ins = emp.insurance?.totalCompanyBurden || 0;
        const cost = salary + ret + ins;
        const total = Math.round(cost * rate / 100);

        // 임원은 100% 현물, 그 외는 과제 예산 비율
        const cashShare = isExecutive(emp.name) ? 0 : Math.round(total * cRatio);
        mCash += cashShare;
        mInKind += total - cashShare;
      }

      cumul += mCash + mInKind;
      rows.push({ month: m, cash: mCash, inKind: mInKind, total: mCash + mInKind, cumulative: cumul });
    }
    return rows;
  }, [selectedProjectId, year, participations, employees, project]);

  const hasPayrollData = !!monthlyData?.payroll;

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
            <div className="lct-table-wrap">
              <table className="table lct-table">
                <thead>
                  <tr>
                    <th>성명</th><th>직책</th>
                    <th style={{ textAlign: 'right' }}>월급여(A)</th>
                    <th style={{ textAlign: 'right' }}>국민연금</th>
                    <th style={{ textAlign: 'right' }}>건강보험</th>
                    <th style={{ textAlign: 'right' }}>장기요양</th>
                    <th style={{ textAlign: 'right' }}>고용보험</th>
                    <th style={{ textAlign: 'right' }}>산재보험</th>
                    <th style={{ textAlign: 'right' }}>합계(A+C)</th>
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
                      <td className="money">{formatWon(d.insurance.nationalPensionCompany || 0)}</td>
                      <td className="money">{formatWon(d.insurance.healthInsuranceCompany || 0)}</td>
                      <td className="money">{formatWon(d.insurance.longTermCareCompany || 0)}</td>
                      <td className="money">{isExec ? '-' : formatWon(d.insurance.employmentInsCompany || 0)}</td>
                      <td className="money">{isExec ? '-' : formatWon(d.insurance.industrialAccident || 0)}</td>
                      <td className="money lct-total">{formatWon(d.totalCost)}</td>
                    </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><strong>합계</strong></td>
                    <td className="money"><strong>{formatWon(totals.salary)}</strong></td>
                    <td colSpan={5} />
                    <td className="money lct-total"><strong>{formatWon(totals.totalCost)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
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
