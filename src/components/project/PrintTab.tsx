import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { FileText, Printer, Download, Package, FileDown } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Employee, Project, YearlyParticipation } from '../../types/project';
import { logAction } from '../../services/auditService';
import { calcLaborSalary } from '../../services/payrollParserService';
import { downloadPdfFromElement, getPdfBlob } from '../../services/pdfService';
import { useAuth } from '../../hooks/useAuth';
import './PrintTab.css';

const MONTHS_LABEL = ['', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

function formatWon(n: number): string { return n.toLocaleString() + '원'; }
function formatNum(n: number): number { return n; } // 엑셀은 숫자 그대로

function getYearsSinceHire(hireDate: string, target: string): number {
  if (!hireDate) return 0;
  return (new Date(target).getTime() - new Date(hireDate).getTime()) / (365.25 * 86400000);
}

function isMonthInProject(project: Project, year: number, month: number): boolean {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  for (const y of project.years) {
    if (ym >= y.start.slice(0, 7) && ym <= y.end.slice(0, 7)) return true;
  }
  return false;
}

function getCurrentYearInfo(project: Project, year: number, month: number) {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  for (const y of project.years) {
    if (ym >= y.start.slice(0, 7) && ym <= y.end.slice(0, 7)) return y;
  }
  return project.years[0];
}

// ═══ 인건비 계산 (LaborCostTab과 동일 로직) ═══
interface LaborRow {
  emp: Employee;
  rate: number;
  role: string;
  salary: number;
  retirement: number;
  npComp: number; hiComp: number; ltcComp: number; eiComp: number; iaComp: number;
  totalInsComp: number;
  totalCost: number;
  cash: number; inKind: number; total: number;
  periodStart: string; periodEnd: string;
}

function calcLabor(
  project: Project, employees: Employee[], participations: YearlyParticipation[],
  year: number, month: number, monthlyData: any
): LaborRow[] {
  const results: LaborRow[] = [];
  const projParts = participations.filter(p => p.projectId === project.projectId);
  const yearInfo = getCurrentYearInfo(project, year, month);

  for (const part of projParts) {
    const rate = part.monthlyRates[String(month)] || 0;
    if (rate === 0) continue;
    const emp = employees.find(e => e.name === part.employeeName);
    if (!emp) continue;

    const payData = monthlyData?.payroll?.data?.[emp.name];
    const insData = monthlyData?.insurance?.data?.[emp.name];

    const salary = calcLaborSalary(emp, payData);
    const yrs = getYearsSinceHire(emp.hireDate, `${year}-${String(month).padStart(2, '0')}-01`);
    // 퇴직금 추계 = 월급여/12 (1년 미만 근로자 제외)
    const retirement = yrs >= 1 ? Math.round(salary / 12) : 0;

    const ins = insData || emp.insurance || {} as any;
    const npComp = ins.nationalPensionCompany || 0;
    const hiComp = ins.healthInsuranceCompany || 0;
    const ltcComp = ins.longTermCareCompany || 0;
    const eiComp = ins.employmentInsCompany || 0;
    const iaComp = ins.industrialAccident || 0;
    const totalInsComp = npComp + hiComp + ltcComp + eiComp + iaComp;

    const totalCost = salary + retirement + totalInsComp;
    // 정부과제 인건비 집행은 천원 단위 round-down (엑셀 정산서식 관행)
    const baseTotal = Math.floor((totalCost * rate / 100) / 1000) * 1000;
    // 참여형태: 'inKind' = 100% 현물, 그 외(default 'cash') = 100% 현금
    const baseCash = part.participationType === 'inKind' ? 0 : baseTotal;
    const baseInKind = baseTotal - baseCash;
    // LaborCostTab(인건비 산출)에서 저장한 수동 조정값 우선 적용 — read-only로 그대로 출력
    const adj = monthlyData?.laborAdjustments?.[project.projectId]?.[emp.employeeNumber];
    const cash = adj?.cash ?? baseCash;
    const inKind = adj?.inKind ?? baseInKind;
    // 합계는 항상 cash + inKind로 — LaborCostTab의 수정값이 합계에도 즉시 반영
    const total = cash + inKind;

    results.push({
      emp, rate, role: part.role, salary, retirement,
      npComp, hiComp, ltcComp, eiComp, iaComp, totalInsComp,
      totalCost, cash, inKind, total,
      periodStart: yearInfo?.start || '', periodEnd: yearInfo?.end || '',
    });
  }
  return results.sort((a, b) => (a.emp.employeeNumber || '').localeCompare(b.emp.employeeNumber || ''));
}

// ═══ 엑셀 생성: 참여현황표 ═══
function createParticipationSheet(project: Project, laborRows: LaborRow[], yearMonth: string): XLSX.WorkBook {
  const year = parseInt(yearMonth.slice(0, 4), 10);
  const month = parseInt(yearMonth.slice(5), 10);
  const yearInfo = getCurrentYearInfo(project, year, month);
  const wb = XLSX.utils.book_new();

  // 시트 1: 인건비 집행
  const rows1: any[][] = [
    [`참여연구자 현황표 (${year}.${String(month).padStart(2, '0')})`],
    [],
    ['1. 연구과제 개요'],
    ['사업명', project.programName],
    ['과제명', project.projectName],
    ['사업기간', `${yearInfo?.start || ''} ~ ${yearInfo?.end || ''} (전체 ${project.period.totalStart} ~ ${project.period.totalEnd})`],
    ['사업기관명', '㈜타이로스코프'],
    [],
    ['2. 인건비 집행'],
    ['성명', '직책', '참여기간', '월급여(급여+퇴직금)', '4대보험기업부담금', '계상률(%)', '현금', '현물', '합계'],
  ];
  let sumCash = 0, sumInKind = 0, sumTotal = 0;
  for (const r of laborRows) {
    rows1.push([
      r.emp.name, r.emp.position,
      `${r.periodStart} ~ ${r.periodEnd}`,
      r.salary + r.retirement, r.totalInsComp, r.rate,
      r.cash, r.inKind, r.total,
    ]);
    sumCash += r.cash; sumInKind += r.inKind; sumTotal += r.total;
  }
  rows1.push(['합계', '', '', '', '', '', sumCash, sumInKind, sumTotal]);
  rows1.push([]);

  // 시트 2 데이터도 같은 시트에 추가
  rows1.push(['3. 인건비 상세']);
  rows1.push(['성명', '직책', '월급여(A)', '퇴직금', '국민연금', '건강보험', '장기요양보험', '고용보험', '산재보험', '합계']);
  let sumSalary = 0, sumRetire = 0, sumNp = 0, sumHi = 0, sumLtc = 0, sumEi = 0, sumIa = 0, sumTotalCost = 0;
  for (const r of laborRows) {
    const isExec = ['대표이사', '이사'].includes(r.emp.position);
    rows1.push([
      r.emp.name, r.emp.position, r.salary, r.retirement,
      r.npComp, r.hiComp, r.ltcComp,
      isExec ? '-' : r.eiComp,
      isExec ? '-' : r.iaComp,
      r.totalCost,
    ]);
    sumSalary += r.salary; sumRetire += r.retirement;
    sumNp += r.npComp; sumHi += r.hiComp; sumLtc += r.ltcComp;
    sumEi += r.eiComp; sumIa += r.iaComp; sumTotalCost += r.totalCost;
  }
  rows1.push(['합계', '', sumSalary, sumRetire, sumNp, sumHi, sumLtc, sumEi, sumIa, sumTotalCost]);

  const ws = XLSX.utils.aoa_to_sheet(rows1);
  ws['!cols'] = [{ wch: 10 }, { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  // 모든 셀 가운데 정렬
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) continue;
      ws[addr].s = { alignment: { horizontal: 'center', vertical: 'center' } };
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, '참여현황표');
  return wb;
}

// ═══ 엑셀 생성: 급여대장 ═══
function createPayrollSheet(project: Project, laborRows: LaborRow[], employees: Employee[], yearMonth: string, monthlyData: any): XLSX.WorkBook {
  const year = parseInt(yearMonth.slice(0, 4), 10);
  const month = parseInt(yearMonth.slice(5), 10);
  const wb = XLSX.utils.book_new();

  const header = ['NO', '성명', '기본급', '식대', '차량유지비', '연구수당', '육아수당',
    '연장근로', '지급합계', '국민연금', '건강보험', '고용보험', '장기요양',
    '소득세', '지방소득세', '공제합계', '실지급액'];

  const rows: any[][] = [
    [`${year}년 ${String(month).padStart(2, '0')}월 급여대장`],
    ['㈜타이로스코프'],
    [],
    header,
  ];

  const totals = {
    basePay: 0, meal: 0, vehicle: 0, research: 0, child: 0, overtime: 0, totalPay: 0,
    np: 0, hi: 0, ei: 0, ltc: 0, incomeTax: 0, localTax: 0, totalDed: 0, netPay: 0,
  };
  laborRows.forEach((r, i) => {
    const pay = monthlyData?.payroll?.data?.[r.emp.name] || {} as any;
    const emp = r.emp;
    const v = {
      basePay: pay.basePay || emp.salary?.basePay || 0,
      meal: pay.mealAllowance || emp.salary?.mealAllowance || 0,
      vehicle: pay.vehicleAllowance || emp.salary?.vehicleAllowance || 0,
      research: pay.researchAllowance || emp.salary?.researchAllowance || 0,
      child: pay.childcareAllowance || emp.salary?.childcareAllowance || 0,
      overtime: pay.overtime || 0,
      totalPay: pay.totalPay || emp.salary?.totalPay || 0,
      np: pay.nationalPension || emp.insurance?.nationalPension || 0,
      hi: pay.healthInsurance || emp.insurance?.healthInsurance || 0,
      ei: pay.employmentInsurance || emp.insurance?.employmentInsurance || 0,
      ltc: pay.longTermCare || emp.insurance?.longTermCare || 0,
      incomeTax: pay.incomeTax || 0,
      localTax: pay.localTax || 0,
      totalDed: pay.totalDeduction || 0,
      netPay: pay.netPay || emp.netPay || 0,
    };
    rows.push([
      i + 1, emp.name,
      v.basePay, v.meal, v.vehicle, v.research, v.child, v.overtime, v.totalPay,
      v.np, v.hi, v.ei, v.ltc, v.incomeTax, v.localTax, v.totalDed, v.netPay,
    ]);
    Object.keys(totals).forEach(k => { (totals as any)[k] += (v as any)[k]; });
  });
  // 합계 행
  rows.push([
    '', '합계',
    totals.basePay, totals.meal, totals.vehicle, totals.research, totals.child, totals.overtime, totals.totalPay,
    totals.np, totals.hi, totals.ei, totals.ltc, totals.incomeTax, totals.localTax, totals.totalDed, totals.netPay,
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = header.map(() => ({ wch: 14 }));
  XLSX.utils.book_append_sheet(wb, ws, '급여대장');
  return wb;
}

// ═══ Props ═══
interface Props {
  yearMonth: string;
  activeProjects: Project[];
  employees: Employee[];
  participations: YearlyParticipation[];
}

const PrintTab: React.FC<Props> = ({ yearMonth, activeProjects, employees, participations }) => {
  const { user } = useAuth();
  const year = parseInt(yearMonth.slice(0, 4), 10);
  const month = parseInt(yearMonth.slice(5), 10);
  const [selectedProjectId, setSelectedProjectId] = useState(activeProjects[0]?.projectId || '');
  const [previewType, setPreviewType] = useState<'participation' | 'payroll' | null>(null);
  const [monthlyData, setMonthlyData] = useState<any>(null);
  const [zipping, setZipping] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const project = activeProjects.find(p => p.projectId === selectedProjectId);

  useEffect(() => {
    const load = async () => {
      const snap = await getDoc(doc(db, 'monthlyData', yearMonth));
      if (snap.exists()) setMonthlyData(snap.data());
      else setMonthlyData(null);
    };
    load();
  }, [yearMonth]);

  const baseLaborRows = useMemo(() => {
    if (!project) return [];
    return calcLabor(project, employees, participations, year, month, monthlyData);
  }, [project, employees, participations, year, month, monthlyData]);

  // 사용자가 현금/현물 보정 가능 — 의존성 변경 시 base로 리셋
  const [laborRows, setLaborRows] = useState<LaborRow[]>([]);
  useEffect(() => {
    setLaborRows(baseLaborRows);
  }, [baseLaborRows]);

  const updateRowAmount = (employeeNumber: string, field: 'cash' | 'inKind', value: number) => {
    setLaborRows((prev) => prev.map((r) => {
      if (r.emp.employeeNumber !== employeeNumber) return r;
      const next = { ...r, [field]: Math.max(0, value || 0) };
      next.total = next.cash + next.inKind;
      return next;
    }));
  };

  const resetLaborRows = () => setLaborRows(baseLaborRows);

  const downloadPdf = useCallback(async (type: 'participation' | 'payroll', proj: Project) => {
    if (!previewRef.current) return;
    setPdfGenerating(true);
    try {
      const suffix = type === 'participation' ? '참여현황표' : '급여대장';
      const filename = `${proj.shortName}_${suffix}_${yearMonth}.pdf`;
      await downloadPdfFromElement(previewRef.current, { filename, orientation: 'landscape', margin: 10 });
      await logAction('download', 'payroll', proj.projectId, `${type}_pdf`, null, filename, user?.email || '');
    } catch (e: any) {
      alert('PDF 생성 실패: ' + e.message);
    }
    setPdfGenerating(false);
  }, [yearMonth, user?.email]);

  const downloadFile = async (type: 'participation' | 'payroll', proj: Project) => {
    // 현재 선택된 프로젝트는 보정값(laborRows) 적용, 다른 프로젝트는 새로 계산
    const rows = (proj.projectId === selectedProjectId && laborRows.length > 0)
      ? laborRows
      : calcLabor(proj, employees, participations, year, month, monthlyData);
    let wb: XLSX.WorkBook;
    let filename: string;

    if (type === 'participation') {
      wb = createParticipationSheet(proj, rows, yearMonth);
      filename = `${proj.shortName}_참여현황표_${yearMonth}.xlsx`;
    } else {
      wb = createPayrollSheet(proj, rows, employees, yearMonth, monthlyData);
      filename = `${proj.shortName}_급여대장_${yearMonth}.xlsx`;
    }

    XLSX.writeFile(wb, filename);
    await logAction('download', 'payroll', proj.projectId, type, null, filename, user?.email || '');
  };

  // ZIP 다운로드
  // 숨겨진 PDF 렌더링용 ref
  const hiddenRef = useRef<HTMLDivElement>(null);

  const downloadZip = async () => {
    setZipping(true);
    try {
      const zip = new JSZip();

      for (const proj of activeProjects) {
        const rows = calcLabor(proj, employees, participations, year, month, monthlyData);
        if (rows.length === 0) continue;

        // 엑셀
        const wb1 = createParticipationSheet(proj, rows, yearMonth);
        const buf1 = XLSX.write(wb1, { type: 'array', bookType: 'xlsx' });
        zip.file(`${proj.shortName}_참여현황표_${yearMonth}.xlsx`, buf1);

        const wb2 = createPayrollSheet(proj, rows, employees, yearMonth, monthlyData);
        const buf2 = XLSX.write(wb2, { type: 'array', bookType: 'xlsx' });
        zip.file(`${proj.shortName}_급여대장_${yearMonth}.xlsx`, buf2);
      }

      // PDF: 현재 미리보기가 열려 있으면 해당 PDF도 포함
      if (previewRef.current && previewType && project) {
        try {
          const suffix = previewType === 'participation' ? '참여현황표' : '급여대장';
          const pdfBlob = await getPdfBlob(previewRef.current, {
            filename: `${project.shortName}_${suffix}_${yearMonth}.pdf`, orientation: 'landscape', margin: 10,
          });
          zip.file(`${project.shortName}_${suffix}_${yearMonth}.pdf`, pdfBlob);
        } catch {}
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, `인건비증빙_${yearMonth}.zip`);
      await logAction('download', 'payroll', 'all', 'zip', null, `인건비증빙_${yearMonth}.zip`, user?.email || '');
    } catch (e: any) {
      alert('ZIP 생성 실패: ' + e.message);
    }
    setZipping(false);
  };

  const yearInfo = project ? getCurrentYearInfo(project, year, month) : null;

  return (
    <div className="pt-container">
      <div className="pt-header">
        <h3 className="pp-tab-title">서류 출력 / 다운로드</h3>
        <button className="btn-primary pt-zip-btn" onClick={downloadZip} disabled={zipping}>
          <Package size={15} /> {zipping ? 'ZIP 생성 중...' : '전체 서류 다운로드 (ZIP)'}
        </button>
      </div>

      {/* 과제 선택 */}
      <div className="pt-project-tabs">
        {activeProjects.map(p => {
          const count = participations.filter(d =>
            d.projectId === p.projectId && (d.monthlyRates[String(month)] || 0) > 0
          ).length;
          return (
            <button key={p.projectId}
              className={`pt-proj-tab ${selectedProjectId === p.projectId ? 'active' : ''}`}
              onClick={() => { setSelectedProjectId(p.projectId); setPreviewType(null); }}>
              {p.shortName} <span className="pt-proj-count">{count}명</span>
            </button>
          );
        })}
      </div>

      {/* 과제별 카드 */}
      {project && (
        <div className="pt-actions-row">
          <div className="pt-action-card card" onClick={() => setPreviewType('participation')}>
            <FileText size={24} className="pt-action-icon" />
            <div>
              <div className="pt-action-label">참여현황표</div>
              <div className="pt-action-desc">{project.shortName} · {yearMonth} · {laborRows.length}명</div>
            </div>
            <button className="btn-secondary pt-dl-btn" onClick={e => { e.stopPropagation(); downloadFile('participation', project); }}>
              <Download size={14} />
            </button>
          </div>
          <div className="pt-action-card card" onClick={() => setPreviewType('payroll')}>
            <Printer size={24} className="pt-action-icon" />
            <div>
              <div className="pt-action-label">급여대장</div>
              <div className="pt-action-desc">{project.shortName} · {yearMonth} · {laborRows.length}명</div>
            </div>
            <button className="btn-secondary pt-dl-btn" onClick={e => { e.stopPropagation(); downloadFile('payroll', project); }}>
              <Download size={14} />
            </button>
          </div>
        </div>
      )}

      {/* 미리보기 (참여현황표) */}
      {previewType === 'participation' && project && (
        <>
          {/* 다운로드 버튼 — 미리보기 영역 밖 (PDF 캡처 제외) */}
          <div className="pt-dl-bar">
            <button className="btn-secondary" onClick={() => downloadFile('participation', project)}>
              <Download size={14} /> 엑셀
            </button>
            <button className="btn-secondary pt-pdf-btn" onClick={() => downloadPdf('participation', project)} disabled={pdfGenerating}>
              <FileDown size={14} /> {pdfGenerating ? 'PDF 생성중...' : 'PDF'}
            </button>
          </div>

          <div className="pt-preview card pt-preview-doc" ref={previewRef}>
            <h4 className="pt-doc-title">참여연구자 현황표 ({year}.{String(month).padStart(2, '0')})</h4>

            <div className="pt-doc-section">
              <h5 className="pt-doc-section-title">1. 연구과제 개요</h5>
              <div className="pt-doc-grid">
                <span>사업명</span><span>{project.programName}</span>
                <span>과제명</span><span>{project.projectName}</span>
                <span>사업기간</span><span>{yearInfo?.start} ~ {yearInfo?.end}</span>
                <span>사업기관명</span><span>㈜타이로스코프</span>
              </div>
            </div>

            <div className="pt-doc-section">
              <div className="pt-section-row">
                <h5 className="pt-doc-section-title">2. 인건비 집행</h5>
                <span className="pt-pdf-hide" style={{ fontSize: 12, color: 'var(--text-hint)' }}>
                  ※ 현금/현물 수정은 <strong>인건비 산출 탭</strong>에서
                </span>
              </div>
              <div className="pt-table-wrap">
                <table className="table pt-doc-table pt-doc-table-centered">
                  <thead>
                    <tr><th>성명</th><th>직책</th><th>참여기간</th><th className="money">월급여<br/>(급여+퇴직금)</th><th className="money">4대보험</th><th className="money">계상률</th><th className="money">현금</th><th className="money">현물</th><th className="money">합계</th></tr>
                  </thead>
                  <tbody>
                    {laborRows.map(r => (
                      <tr key={r.emp.employeeNumber}>
                        <td>{r.emp.name}</td><td>{r.emp.position}</td>
                        <td className="pt-nowrap">{r.periodStart}~{r.periodEnd}</td>
                        <td className="money">{formatWon(r.salary + r.retirement)}</td>
                        <td className="money">{formatWon(r.totalInsComp)}</td>
                        <td className="money">{r.rate}%</td>
                        <td className="money">{formatWon(r.cash)}</td>
                        <td className="money">{formatWon(r.inKind)}</td>
                        <td className="money">{formatWon(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6}><strong>합계</strong></td>
                      <td className="money"><strong>{formatWon(laborRows.reduce((s, r) => s + r.cash, 0))}</strong></td>
                      <td className="money"><strong>{formatWon(laborRows.reduce((s, r) => s + r.inKind, 0))}</strong></td>
                      <td className="money"><strong>{formatWon(laborRows.reduce((s, r) => s + r.total, 0))}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="pt-doc-section">
              <h5 className="pt-doc-section-title">3. 인건비 상세</h5>
              <div className="pt-table-wrap">
                <table className="table pt-doc-table pt-doc-table-centered">
                  <thead>
                    <tr>
                      <th>성명</th><th>직책</th>
                      <th className="money">월급여(A)</th>
                      <th className="money">퇴직금</th>
                      <th className="money">국민연금</th><th className="money">건강보험</th><th className="money">장기요양보험</th>
                      <th className="money">고용보험</th><th className="money">산재보험</th>
                      <th className="money">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {laborRows.map(r => {
                      const isExec = ['대표이사', '이사'].includes(r.emp.position);
                      return (
                      <tr key={r.emp.employeeNumber}>
                        <td>{r.emp.name}</td><td>{r.emp.position}</td>
                        <td className="money">{formatWon(r.salary)}</td>
                        <td className="money">{r.retirement > 0 ? formatWon(r.retirement) : '-'}</td>
                        <td className="money">{formatWon(r.npComp)}</td>
                        <td className="money">{formatWon(r.hiComp)}</td>
                        <td className="money">{formatWon(r.ltcComp)}</td>
                        <td className="money">{isExec ? '-' : formatWon(r.eiComp)}</td>
                        <td className="money">{isExec ? '-' : formatWon(r.iaComp)}</td>
                        <td className="money">{formatWon(r.totalCost)}</td>
                      </tr>
                      );
                    })}
                    <tr className="pt-doc-foot">
                      <td colSpan={2}><strong>합계</strong></td>
                      <td className="money"><strong>{formatWon(laborRows.reduce((s, r) => s + r.salary, 0))}</strong></td>
                      <td className="money"><strong>{formatWon(laborRows.reduce((s, r) => s + r.retirement, 0))}</strong></td>
                      <td className="money"><strong>{formatWon(laborRows.reduce((s, r) => s + r.npComp, 0))}</strong></td>
                      <td className="money"><strong>{formatWon(laborRows.reduce((s, r) => s + r.hiComp, 0))}</strong></td>
                      <td className="money"><strong>{formatWon(laborRows.reduce((s, r) => s + r.ltcComp, 0))}</strong></td>
                      <td className="money"><strong>{formatWon(laborRows.reduce((s, r) => s + r.eiComp, 0))}</strong></td>
                      <td className="money"><strong>{formatWon(laborRows.reduce((s, r) => s + r.iaComp, 0))}</strong></td>
                      <td className="money"><strong>{formatWon(laborRows.reduce((s, r) => s + r.totalCost, 0))}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 미리보기 (급여대장) */}
      {previewType === 'payroll' && project && (
        <>
          <div className="pt-dl-bar">
            <button className="btn-secondary" onClick={() => downloadFile('payroll', project)}>
              <Download size={14} /> 엑셀
            </button>
            <button className="btn-secondary pt-pdf-btn" onClick={() => downloadPdf('payroll', project)} disabled={pdfGenerating}>
              <FileDown size={14} /> {pdfGenerating ? 'PDF 생성중...' : 'PDF'}
            </button>
          </div>

          {(() => {
            // 기본급(통합) = 기본급 + 식대 + 차량 + 연구수당 + 육아
            // 추가 항목(초과근로/휴일근로/야간근로)은 한 명이라도 값 있으면 컬럼 추가
            const getPay = (r: typeof laborRows[number]) => monthlyData?.payroll?.data?.[r.emp.name] || ({} as any);
            const calcBase = (r: typeof laborRows[number]) => {
              const pay = getPay(r);
              return (pay.basePay || r.emp.salary?.basePay || 0) +
                (pay.mealAllowance || r.emp.salary?.mealAllowance || 0) +
                (pay.vehicleAllowance || r.emp.salary?.vehicleAllowance || 0) +
                (pay.researchAllowance || r.emp.salary?.researchAllowance || 0) +
                (pay.childcareAllowance || r.emp.salary?.childcareAllowance || 0);
            };
            const showOvertime = laborRows.some((r) => (getPay(r).overtime || 0) > 0);
            const showHoliday = laborRows.some((r) => (getPay(r).holidayWork || 0) > 0);
            const showNight = laborRows.some((r) => (getPay(r).nightWork || 0) > 0);

            const totals = laborRows.reduce((acc, r) => {
              const pay = getPay(r);
              acc.base += calcBase(r);
              acc.overtime += pay.overtime || 0;
              acc.holiday += pay.holidayWork || 0;
              acc.night += pay.nightWork || 0;
              acc.totalPay += pay.totalPay || r.emp.salary?.totalPay || 0;
              acc.nationalPension += pay.nationalPension || r.emp.insurance?.nationalPension || 0;
              acc.healthInsurance += pay.healthInsurance || r.emp.insurance?.healthInsurance || 0;
              acc.employmentInsurance += pay.employmentInsurance || r.emp.insurance?.employmentInsurance || 0;
              acc.longTermCare += pay.longTermCare || r.emp.insurance?.longTermCare || 0;
              acc.incomeTax += pay.incomeTax || 0;
              acc.localTax += pay.localTax || 0;
              acc.totalDeduction += pay.totalDeduction || 0;
              acc.netPay += pay.netPay || r.emp.netPay || 0;
              return acc;
            }, {
              base: 0, overtime: 0, holiday: 0, night: 0, totalPay: 0,
              nationalPension: 0, healthInsurance: 0, employmentInsurance: 0, longTermCare: 0,
              incomeTax: 0, localTax: 0, totalDeduction: 0, netPay: 0,
            });
            // 기타 공제 합계 = 공제합계 - (4대보험 + 세금 6개 합)
            const totalsOther = Math.max(0,
              totals.totalDeduction - totals.nationalPension - totals.healthInsurance
              - totals.employmentInsurance - totals.longTermCare - totals.incomeTax - totals.localTax
            );

            return (
              <div className="pt-preview card pt-preview-doc" ref={previewRef}>
                <h4 className="pt-doc-title">{year}년 {String(month).padStart(2, '0')}월 급여대장</h4>
                <div className="pt-table-wrap">
                  <table className="table pt-doc-table pt-payroll-table pt-doc-table-centered">
                    <thead>
                      <tr>
                        <th>NO</th>
                        <th>성명</th>
                        <th className="money">기본급</th>
                        {showOvertime && <th className="money">초과근로</th>}
                        {showHoliday && <th className="money">휴일근로</th>}
                        {showNight && <th className="money">야간근로</th>}
                        <th className="money">지급합계</th>
                        <th className="money">국민연금</th>
                        <th className="money">건강보험</th>
                        <th className="money">고용보험</th>
                        <th className="money">장기요양</th>
                        <th className="money">소득세</th>
                        <th className="money">지방세</th>
                        <th className="money">기타</th>
                        <th className="money">실지급액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {laborRows.map((r, i) => {
                        const pay = getPay(r);
                        // 기타 공제 = 공제합계 - (4대보험 + 소득세 + 지방세)
                        const np = pay.nationalPension || r.emp.insurance?.nationalPension || 0;
                        const hi = pay.healthInsurance || r.emp.insurance?.healthInsurance || 0;
                        const ei = pay.employmentInsurance || r.emp.insurance?.employmentInsurance || 0;
                        const ltc = pay.longTermCare || r.emp.insurance?.longTermCare || 0;
                        const it = pay.incomeTax || 0;
                        const lt = pay.localTax || 0;
                        const other = Math.max(0, (pay.totalDeduction || 0) - np - hi - ei - ltc - it - lt);
                        return (
                          <tr key={r.emp.employeeNumber}>
                            <td>{i + 1}</td>
                            <td className="pt-name">{r.emp.name}</td>
                            <td className="money">{formatWon(calcBase(r))}</td>
                            {showOvertime && <td className="money">{formatWon(pay.overtime || 0)}</td>}
                            {showHoliday && <td className="money">{formatWon(pay.holidayWork || 0)}</td>}
                            {showNight && <td className="money">{formatWon(pay.nightWork || 0)}</td>}
                            <td className="money pt-highlight">{formatWon(pay.totalPay || r.emp.salary?.totalPay || 0)}</td>
                            <td className="money">{formatWon(np)}</td>
                            <td className="money">{formatWon(hi)}</td>
                            <td className="money">{formatWon(ei)}</td>
                            <td className="money">{formatWon(ltc)}</td>
                            <td className="money">{formatWon(it)}</td>
                            <td className="money">{formatWon(lt)}</td>
                            <td className="money">{formatWon(other)}</td>
                            <td className="money pt-highlight">{formatWon(pay.netPay || r.emp.netPay || 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}><strong>합계</strong></td>
                        <td className="money"><strong>{formatWon(totals.base)}</strong></td>
                        {showOvertime && <td className="money"><strong>{formatWon(totals.overtime)}</strong></td>}
                        {showHoliday && <td className="money"><strong>{formatWon(totals.holiday)}</strong></td>}
                        {showNight && <td className="money"><strong>{formatWon(totals.night)}</strong></td>}
                        <td className="money pt-highlight"><strong>{formatWon(totals.totalPay)}</strong></td>
                        <td className="money"><strong>{formatWon(totals.nationalPension)}</strong></td>
                        <td className="money"><strong>{formatWon(totals.healthInsurance)}</strong></td>
                        <td className="money"><strong>{formatWon(totals.employmentInsurance)}</strong></td>
                        <td className="money"><strong>{formatWon(totals.longTermCare)}</strong></td>
                        <td className="money"><strong>{formatWon(totals.incomeTax)}</strong></td>
                        <td className="money"><strong>{formatWon(totals.localTax)}</strong></td>
                        <td className="money"><strong>{formatWon(totalsOther)}</strong></td>
                        <td className="money pt-highlight"><strong>{formatWon(totals.netPay)}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })()}
          {/* 안내 문구는 미리보기 영역 밖 — PDF 캡처에서 자동 제외 */}
          <p style={{ fontSize: 11, color: '#666', marginTop: 8, textAlign: 'left' }}>
            ※ 기본급 = 기본급 + 식대 + 차량유지비 + 연구수당 + 육아수당 통합 (PDF 출력에는 표시되지 않음)
          </p>
        </>
      )}

      {!previewType && laborRows.length === 0 && project && (
        <div className="pt-empty">
          <p>{project.shortName}에 {month}월 참여 연구원이 없습니다.</p>
        </div>
      )}
    </div>
  );
};

export default PrintTab;
