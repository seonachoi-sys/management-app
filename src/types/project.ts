import { Timestamp } from 'firebase/firestore';

/* ─── 직원 마스터 ─── */
/** 임원(이사 이상) — 인건비 자동 100% 현물 처리, 인건비 분류상 자동 제외 등 */
export const EXECUTIVE_NAMES = ['박재민', '문재훈', '안준', '신규보'] as const;
export function isExecutive(name: string): boolean {
  return (EXECUTIVE_NAMES as readonly string[]).includes(name);
}

export interface EmployeeSalary {
  basePay: number;           // 기본급
  mealAllowance: number;     // 식대
  vehicleAllowance: number;  // 차량유지비
  researchAllowance: number; // 연구수당
  childcareAllowance: number;// 육아수당
  totalPay: number;          // 지급합계
}

export interface EmployeeInsurance {
  nationalPension: number;          // 국민연금 (본인)
  nationalPensionCompany: number;   // 국민연금 (회사)
  healthInsurance: number;          // 건강보험 (본인)
  healthInsuranceCompany: number;   // 건강보험 (회사)
  longTermCare: number;             // 장기요양 (본인)
  longTermCareCompany: number;      // 장기요양 (회사)
  employmentInsurance: number;      // 고용보험 (본인)
  employmentInsCompany: number;     // 고용보험 (회사)
  industrialAccident: number;       // 산재보험 (회사만)
  totalCompanyBurden: number;       // 4대보험 회사부담 합계
}

export interface Employee {
  employeeId: string;
  name: string;
  position: string;        // 대표이사, 이사, 소장, 팀장, 팀원 등
  department: string;
  employeeNumber: string;
  hireDate: string;
  salary: EmployeeSalary;
  insurance: EmployeeInsurance;
  netPay: number;          // 실지급액 (세후)
  updatedAt: Timestamp;
}

/* ─── 과제 마스터 ─── */
export type ProjectStatus = '진행' | '종료' | '신규수주';
export type ProjectCategory = 'R&D사업' | '지원사업';
export type ParticipationType = '주관' | '공동';
export type PiRole = '책임' | '공동';

export interface Budget {
  government: number;     // 정부출연금
  privateCash: number;    // 기업부담 현금
  privateInKind: number;  // 기업부담 현물
  total: number;          // 총사업비
}

export interface BudgetExecution {
  executed: number;       // 집행완료
  planned: number;        // 집행예정 (확정)
  unplanned: number;      // 미정
  remaining: number;      // 잔액
}

/* ─── 예산 세부 항목 (budgetDetail) ─── */
export interface BudgetSubItem {
  id: string;
  name: string;
  budget: number;
  executed: number;
}

export interface BudgetItem {
  id: string;
  name: string;
  type: 'fixed' | 'optional';
  budget: number;
  executed: number;
  subItems: BudgetSubItem[];
}

export interface BudgetCategory {
  id: string;
  name: string;
  type: 'fixed' | 'optional';
  items: BudgetItem[];
}

export interface BudgetDetail {
  categories: BudgetCategory[];
}

export interface ProjectYear {
  yearNumber: number;
  start: string;          // YYYY-MM-DD
  end: string;
  months: number;
  budget: Budget;
  budgetExecution: BudgetExecution;
  budgetDetail?: BudgetDetail; // 세부 항목 (없으면 기존 단순 구조 폴백)
}

export interface ProjectContact {
  manager: string;
  phone: string;
  email: string;
}

export interface Project {
  projectId: string;
  status: ProjectStatus;
  category: ProjectCategory;
  programName: string;     // 사업명
  projectName: string;     // 과제명
  shortName: string;       // 약어
  agency: string;          // 부처/전문기관
  hostOrg: string;         // 주관기관
  participationType: ParticipationType;
  pi: string;              // 연구책임자
  piRole: PiRole;
  period: {
    totalStart: string;
    totalEnd: string;
  };
  years: ProjectYear[];
  contact: ProjectContact;
  excludeReason: string;   // 3책5공 제외사유
  rcmsProjectNumber?: string; // 이지바로 과제번호
  minRates?: Record<string, number>; // 최소 참여율 { "책임연구원": 10, "전담인력": 50 }

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* ─── 과제별 참여율 ─── */
export interface ParticipationLaborCost {
  salary: number;              // 월급여
  companyInsurance: number;    // 4대보험 회사부담
  retirementReserve: number;   // 퇴직금 추계
  totalMonthlyCost: number;    // 인건비 단가 (A+B+C)
  cash: number;                // 현금 인건비
  inKind: number;              // 현물 인건비
  total: number;               // 합계
}

export interface Participation {
  participationId: string;
  projectId: string;
  employeeId: string;
  yearMonth: string;           // YYYY-MM
  role: '책임연구원' | '연구원';
  participationRate: number;   // 참여율 (%)
  period: {
    start: string;
    end: string;
  };
  laborCost: ParticipationLaborCost;
  updatedAt: Timestamp;
}

/* ─── 연간 참여율 (새 구조) ─── */
export interface YearlyParticipation {
  id: string;                     // "{projectId}_{employeeName}_{year}"
  projectId: string;
  employeeId: string;             // employeeNumber
  employeeName: string;
  year: number;
  role: '책임연구원' | '연구원';
  monthlyRates: Record<string, number>;  // { "1": 20, "2": 20, ... "12": 20 }
  averageRate: number;            // 자동계산
  updatedAt: Timestamp;
  updatedBy: string;
}

/* ─── 월별 데이터 스냅샷 ─── */
export interface MonthlyDataChange {
  employee: string;
  field: string;
  old: number;
  new: number;
}

export interface MonthlyData {
  yearMonth: string;
  payrollUploadDate: Timestamp | null;
  insuranceUploadDate: Timestamp | null;
  employees: Record<string, EmployeeSalary>;
  insurance: Record<string, EmployeeInsurance>;
  changeLog: MonthlyDataChange[];
}

/* ─── 감사 로그 ─── */
export interface AuditLog {
  auditId: string;
  action: string;
  collection: string;
  documentId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  userEmail: string;
  createdAt: Timestamp;
}
