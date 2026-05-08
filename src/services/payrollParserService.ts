/**
 * 급여대장 + 4대보험 CSV/XLSX 파싱 서비스
 * - CSV: EUC-KR / UTF-8 / CP949 자동 감지
 * - XLSX: SheetJS로 첫 시트 읽음
 * - 데이터 행 자동 감지 (row[0]이 숫자) + 헤더 키워드 매핑
 */
import * as XLSX from 'xlsx';

// ═══ CSV 라인 파서 (쌍따옴표 처리) ═══
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else current += ch;
  }
  result.push(current.trim());
  return result;
}

function parseNumber(s: string): number {
  if (!s) return 0;
  return parseInt(s.replace(/,/g, '').replace(/"/g, ''), 10) || 0;
}

// ═══ 파일 → 행 배열 통합 (CSV/XLSX 모두 지원) ═══
/** 파일이 .xlsx/.xls면 SheetJS, 그 외에는 CSV로 파싱 → string[][] 반환 */
async function readFileAsRows(file: File): Promise<string[][]> {
  const ext = file.name.toLowerCase().split('.').pop() || '';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    return data.map((row) => (Array.isArray(row) ? row : []).map((c) => String(c ?? '').trim()));
  }
  // CSV
  const text = await decodeFile(file);
  return text.split('\n').map((l) => parseCSVLine(l));
}

/** 헤더 영역(데이터 행 시작 직전까지)을 컬럼별로 합쳐 키워드 매핑용 배열 반환 */
function buildColumnHeaders(rows: string[][]): string[] {
  // 데이터 행 시작 위치 찾기: row[0]이 1자리 이상 숫자
  let dataStart = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const c0 = String(rows[i][0] || '').trim();
    if (/^\d+$/.test(c0)) { dataStart = i; break; }
  }
  if (dataStart < 0) dataStart = 1; // 데이터 행 못 찾으면 첫 행만 헤더

  const numCols = Math.max(...rows.slice(0, dataStart).map((r) => (r ? r.length : 0)), 0);
  const headers: string[] = [];
  for (let c = 0; c < numCols; c++) {
    const parts: string[] = [];
    for (let r = 0; r < dataStart; r++) {
      const cell = String(rows[r]?.[c] || '').replace(/\s+/g, '');
      if (cell && !parts.includes(cell)) parts.push(cell);
    }
    headers.push(parts.join('|'));
  }
  return headers;
}

/** 헤더에서 키워드로 컬럼 인덱스 찾기 (첫 매칭 반환) */
function findCol(headers: string[], keywords: string[]): number {
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c];
    if (keywords.some((k) => h.includes(k.replace(/\s+/g, '')))) return c;
  }
  return -1;
}

/** 데이터 행만 추출 (row[0]이 숫자, 합계/총계 제외) */
function extractDataRows(rows: string[][]): string[][] {
  return rows.filter((r) => {
    const c0 = String(r[0] || '').trim();
    if (!/^\d+$/.test(c0)) return false;
    return true;
  });
}

// ═══ 인코딩 자동 감지 + 텍스트 변환 ═══
async function decodeFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(buffer);

  // UTF-8 BOM 체크
  if (uint8[0] === 0xEF && uint8[1] === 0xBB && uint8[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(uint8);
  }

  // UTF-8 시도
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(uint8);
    return text;
  } catch {
    // EUC-KR / CP949 fallback
    try {
      return new TextDecoder('euc-kr').decode(uint8);
    } catch {
      return new TextDecoder('utf-8').decode(uint8);
    }
  }
}

// ═══ 급여대장 파싱 결과 ═══
export interface PayrollEntry {
  employeeNumber: string;
  name: string;
  basePay: number;
  mealAllowance: number;
  vehicleAllowance: number;
  researchAllowance: number;
  childcareAllowance: number;
  overtime: number;
  holidayWork: number;
  nightWork: number;
  totalPay: number;
  nationalPension: number;
  healthInsurance: number;
  employmentInsurance: number;
  longTermCare: number;
  incomeTax: number;
  localTax: number;
  totalDeduction: number;
  netPay: number;
  hireDate: string;
  position: string;
  department: string;
}

// ═══ 급여대장 파싱 (3행마다 1명) ═══
export async function parsePayrollCSV(file: File): Promise<PayrollEntry[]> {
  const text = await decodeFile(file);
  const lines = text.split('\n').map(l => parseCSVLine(l));
  const employees: PayrollEntry[] = [];
  let i = 0;

  while (i < lines.length) {
    const row = lines[i];
    if (row[0] && /^\d{7}$/.test(row[0].trim())) {
      const row1 = lines[i];
      const row2 = lines[i + 1] || [];
      const row3 = lines[i + 2] || [];

      employees.push({
        employeeNumber: row1[0].trim(),
        name: row1[1].trim(),
        basePay: parseNumber(row1[2]),
        mealAllowance: parseNumber(row1[3]),
        vehicleAllowance: parseNumber(row1[4]),
        researchAllowance: parseNumber(row1[5]),
        childcareAllowance: parseNumber(row1[6]),
        overtime: parseNumber(row1[7]),
        holidayWork: 0,
        nightWork: parseNumber(row1[8]),
        totalPay: parseNumber(row3[8]),
        nationalPension: parseNumber(row1[9]),
        healthInsurance: parseNumber(row1[10]),
        employmentInsurance: parseNumber(row1[11]),
        longTermCare: parseNumber(row1[12]),
        incomeTax: parseNumber(row1[13]),
        localTax: parseNumber(row1[14]),
        totalDeduction: parseNumber(row2[14]),
        netPay: parseNumber(row3[14]),
        hireDate: (row2[0] || '').trim(),
        position: (row2[1] || '').trim(),
        department: (row3[1] || '').trim(),
      });
      i += 3;
    } else {
      i++;
    }
  }
  return employees;
}

// ═══ 건강보험 고지서 ═══
export interface HealthInsuranceEntry {
  name: string;
  healthInsurance: number;      // 본인
  healthInsuranceCompany: number;
  longTermCare: number;
  longTermCareCompany: number;
}

export async function parseHealthInsuranceCSV(file: File): Promise<HealthInsuranceEntry[]> {
  const rows = await readFileAsRows(file);
  const results: HealthInsuranceEntry[] = [];

  // 건강보험공단 EDI 구조: 31개 컬럼, 건강(0~17) + 장기요양(18~30) 나란히
  // 같은 헤더("산출보험료", "고지보험료" 등)가 두 번씩 나오므로 첫 번째=건강, 두 번째=장기요양
  // 헤더 텍스트로 첫 두 개의 "고지보험료" 컬럼 인덱스 찾기 (양식 변경에 강건)
  const headers = buildColumnHeaders(rows);
  const nameCol = findCol(headers, ['성명']);
  const ssnCol = findCol(headers, ['주민번호', '주민등록번호']);

  // "고지보험료" 컬럼 모두 찾기
  const noticeCols: number[] = [];
  for (let c = 0; c < headers.length; c++) {
    if (headers[c].includes('고지보험료')) noticeCols.push(c);
  }
  // 첫 번째 = 건강, 두 번째 = 장기요양
  const hiCol = noticeCols[0] ?? 13;
  const ltcCol = noticeCols[1] ?? 26;

  for (const row of extractDataRows(rows)) {
    const name = String(row[nameCol >= 0 ? nameCol : 3] || '').trim();
    if (!name) continue;
    // 주민번호 패턴 검증 (있으면)
    if (ssnCol >= 0) {
      const ssn = String(row[ssnCol] || '');
      if (!/\d{6}-/.test(ssn)) continue;
    }
    const hiCompany = parseNumber(row[hiCol]);
    const ltcCompany = parseNumber(row[ltcCol]);
    if (hiCompany === 0 && ltcCompany === 0) continue;

    results.push({
      name,
      healthInsurance: hiCompany,
      healthInsuranceCompany: hiCompany,
      longTermCare: ltcCompany,
      longTermCareCompany: ltcCompany,
    });
  }
  return results;
}

// ═══ 국민연금 고지서 ═══
export interface PensionEntry {
  name: string;
  nationalPension: number;
  nationalPensionCompany: number;
}

export async function parsePensionCSV(file: File): Promise<PensionEntry[]> {
  const rows = await readFileAsRows(file);
  const results: PensionEntry[] = [];

  // 헤더 키워드: 성명 / 근로자기여금 (본인) / 사용자부담금 (회사)
  const headers = buildColumnHeaders(rows);
  const nameCol = findCol(headers, ['성명', '근로자명']);
  const empCol = findCol(headers, ['근로자기여금']);
  const compCol = findCol(headers, ['사용자부담금']);

  for (const row of extractDataRows(rows)) {
    const name = String(row[nameCol >= 0 ? nameCol : 1] || '').trim();
    if (!name || name === '합계') continue;
    results.push({
      name,
      nationalPension: parseNumber(row[empCol >= 0 ? empCol : 5]),
      nationalPensionCompany: parseNumber(row[compCol >= 0 ? compCol : 6]),
    });
  }
  return results;
}

// ═══ 고용보험 고지서 ═══
export interface EmploymentInsuranceEntry {
  name: string;
  employmentInsurance: number;     // 근로자
  employmentInsCompany: number;    // 사업주 합계
}

export async function parseEmploymentInsuranceCSV(file: File): Promise<EmploymentInsuranceEntry[]> {
  const rows = await readFileAsRows(file);
  const results: EmploymentInsuranceEntry[] = [];

  // 헤더는 보통 2행 병합 — buildColumnHeaders가 합쳐서 처리
  // 키워드:
  //   근로자명/성명, 근로자실업급여보험료 (본인 부담),
  //   사업주실업급여보험료 + 사업주고안직능보험료 (사업주 부담)
  // 같은 키워드가 여러 번 나오면 (해당월/재산정/정산), findCol은 첫 번째만 반환 — 해당월이 첫 번째라 OK
  const headers = buildColumnHeaders(rows);
  const nameCol = findCol(headers, ['근로자명', '성명']);
  const empCol = findCol(headers, ['근로자실업급여']);
  const compEmpInsCol = findCol(headers, ['사업주실업급여']);
  const compStabilityCol = findCol(headers, ['사업주고안', '고안직능']);

  for (const row of extractDataRows(rows)) {
    const name = String(row[nameCol >= 0 ? nameCol : 2] || '').trim();
    if (!name || name === '합계') continue;
    const empBurden = parseNumber(row[empCol >= 0 ? empCol : 9]);
    const compBurden =
      parseNumber(row[compEmpInsCol >= 0 ? compEmpInsCol : 10]) +
      parseNumber(row[compStabilityCol >= 0 ? compStabilityCol : 11]);
    results.push({
      name,
      employmentInsurance: empBurden,
      employmentInsCompany: compBurden,
    });
  }
  return results;
}

// ═══ 산재보험 고지서 ═══
export interface AccidentInsuranceEntry {
  name: string;
  industrialAccident: number;
}

export async function parseAccidentInsuranceCSV(file: File): Promise<AccidentInsuranceEntry[]> {
  const rows = await readFileAsRows(file);
  const results: AccidentInsuranceEntry[] = [];

  // 헤더: 근로자명/성명, 산정보험료(해당월) — 산재는 회사 100% 부담
  const headers = buildColumnHeaders(rows);
  const nameCol = findCol(headers, ['근로자명', '성명']);
  const compCol = findCol(headers, ['산정보험료']);

  for (const row of extractDataRows(rows)) {
    const name = String(row[nameCol >= 0 ? nameCol : 2] || '').trim();
    if (!name || name === '합계') continue;
    results.push({
      name,
      industrialAccident: parseNumber(row[compCol >= 0 ? compCol : 9]),
    });
  }
  return results;
}

// ═══ 변동 감지 ═══
export interface ChangeItem {
  name: string;
  field: string;
  fieldLabel: string;
  oldValue: number;
  newValue: number;
  diff: number;
  type: 'increase' | 'decrease' | 'new';
}

export function detectChanges(
  prevData: Record<string, any> | null,
  newData: Record<string, PayrollEntry>,
): ChangeItem[] {
  if (!prevData) return [];
  const changes: ChangeItem[] = [];
  const fields: [string, string][] = [
    ['basePay', '기본급'], ['mealAllowance', '식대'], ['vehicleAllowance', '차량유지비'],
    ['researchAllowance', '연구수당'], ['childcareAllowance', '육아수당'],
    ['totalPay', '지급합계'], ['netPay', '실지급액'],
  ];

  for (const [name, entry] of Object.entries(newData)) {
    const prev = prevData[name];
    if (!prev) {
      changes.push({ name, field: 'new', fieldLabel: '신규', oldValue: 0, newValue: entry.totalPay, diff: entry.totalPay, type: 'new' });
      continue;
    }
    for (const [field, label] of fields) {
      const oldVal = prev[field] || 0;
      const newVal = (entry as any)[field] || 0;
      if (oldVal !== newVal) {
        changes.push({
          name, field, fieldLabel: label, oldValue: oldVal, newValue: newVal,
          diff: newVal - oldVal, type: newVal > oldVal ? 'increase' : 'decrease',
        });
      }
    }
  }
  return changes;
}

// ═══ 인건비 월급여 계산 (연장/휴일/야간근로 제외) ═══
// 월급여 = 기본급 + 식대 + 차량유지비 + 연구수당 + 육아수당
export function calcLaborSalary(emp: {
  salary?: { basePay?: number; mealAllowance?: number; vehicleAllowance?: number;
    researchAllowance?: number; childcareAllowance?: number; totalPay?: number };
}, payrollData?: {
  basePay?: number; mealAllowance?: number; vehicleAllowance?: number;
  researchAllowance?: number; childcareAllowance?: number;
} | null): number {
  const src = payrollData || emp.salary || {};
  return (src.basePay || 0) + (src.mealAllowance || 0) + (src.vehicleAllowance || 0)
    + (src.researchAllowance || 0) + (src.childcareAllowance || 0);
}
