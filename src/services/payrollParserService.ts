/**
 * 급여대장 + 4대보험 CSV 파싱 서비스
 * EUC-KR / UTF-8 / CP949 자동 감지
 */

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
  const text = await decodeFile(file);
  const lines = text.split('\n').map(l => parseCSVLine(l));
  const results: HealthInsuranceEntry[] = [];

  // CSV 구조 (건강보험공단 EDI):
  //   row[0] 순번, [1] 증번호, [2] 주민번호, [3] 성명, [4] 보수월액,
  //   ── 건강보험: [5] 구분, [6] 산출, [7] 정산, [8] 정산사유, [9] 정산기간,
  //              [10] 감면사유, [11] 연말정산, [12] 환급이자, [13] 고지보험료,
  //              [14] 회계, [15] 영업소, [16] 직종, [17] 취득/상실일,
  //   ── 장기요양: [18] 구분, [19] 산출, [20] 정산, [21] 사유, [22] 기간,
  //              [23] 감면사유, [24] 연말정산, [25] 환급, [26] 고지보험료,
  //              [27] 회계, [28] 영업소, [29] 직종, [30] 취득/상실일
  //
  // 회사 부담분 = 고지보험료 (회사로 청구되는 금액) — 본인 부담은 별도 (보통 50:50)

  for (const row of lines) {
    if (row.length < 14) continue; // 헤더/빈 행/주석 행 스킵
    const name = (row[3] || '').trim();
    if (!name || name === '성명' || name === '합계' || name === '총계' || name === '소계') continue;
    // 주민번호 패턴이 row[2]에 없으면 데이터 행이 아님
    if (!/\d{6}-/.test(row[2] || '')) continue;

    const hiCompany = parseNumber(row[13]);   // 건강 고지보험료 (회사 부담)
    const ltcCompany = parseNumber(row[26]);  // 장기요양 고지보험료 (회사 부담)
    if (hiCompany === 0 && ltcCompany === 0) continue;

    results.push({
      name,
      healthInsurance: hiCompany,        // 본인 부담분은 별도 (50:50 추정 가능)
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
  const text = await decodeFile(file);
  const lines = text.split('\n').map(l => parseCSVLine(l));
  const results: PensionEntry[] = [];

  for (const row of lines) {
    if (row[0] && /^\d+$/.test(row[0].trim()) && row[1]) {
      const name = row[1].trim();
      if (name === '합계') continue;
      results.push({
        name,
        nationalPension: parseNumber(row[5]),
        nationalPensionCompany: parseNumber(row[6]),
      });
    }
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
  const text = await decodeFile(file);
  const lines = text.split('\n').map(l => parseCSVLine(l));
  const results: EmploymentInsuranceEntry[] = [];

  for (const row of lines) {
    if (row[0] && /^\d+$/.test(row[0].trim()) && row[2]) {
      const name = row[2].trim();
      if (name === '합계') continue;
      results.push({
        name,
        employmentInsurance: parseNumber(row[9]),
        employmentInsCompany: parseNumber(row[10]) + parseNumber(row[11]),
      });
    }
  }
  return results;
}

// ═══ 산재보험 고지서 ═══
export interface AccidentInsuranceEntry {
  name: string;
  industrialAccident: number;
}

export async function parseAccidentInsuranceCSV(file: File): Promise<AccidentInsuranceEntry[]> {
  const text = await decodeFile(file);
  const lines = text.split('\n').map(l => parseCSVLine(l));
  const results: AccidentInsuranceEntry[] = [];

  for (const row of lines) {
    if (row[0] && /^\d+$/.test(row[0].trim()) && row[2]) {
      const name = row[2].trim();
      if (name === '합계') continue;
      results.push({
        name,
        industrialAccident: parseNumber(row[9]),
      });
    }
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
