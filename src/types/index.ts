import { Timestamp } from 'firebase/firestore';

/* ─── 업무 ─── */
export type TaskCategory = string; // Firestore settings에서 동적 관리
export type TaskStatus = '대기' | '진행중' | '완료' | '지연' | '보류';
export type TaskPriority = '긴급' | '높음' | '보통' | '낮음';
export type RecurrenceRule = 'weekly' | 'monthly' | null;

export const DEFAULT_TASK_CATEGORIES = ['경영관리', '재무', '인사', '기획', '일반업무'];
export const DEFAULT_KPI_CATEGORIES = ['재무', '인사', '운영', '기획', '기타'];

export interface Task {
  taskId: string;
  title: string;
  description: string;
  assignee: string;
  assigneeName: string;
  category: TaskCategory;
  status: TaskStatus;
  priority: TaskPriority;
  priorityScore: number;
  parentTaskId: string | null; // 상위 업무 연결
  startDate: Timestamp | null;
  dueDate: Timestamp | null;
  completedDate: Timestamp | null;
  progressRate: number;
  kpiLinked: string | null;
  notes: string;
  isRecurring: boolean;
  recurrenceRule: RecurrenceRule;
  ceoFlag: boolean;
  ceoFlagReason: string;
  importance: 'high' | 'normal';
  googleTaskId: string | null;
  lastModifiedBy: string | null;
  lastModifiedAt: Timestamp | null;
  isNewDismissed: boolean;
  leadTimeDays: number | null; // 완료 시 자동계산: dueDate - completedAt (양수=조기, 음수=지연, 0=정시)
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

/* ─── 앱 설정 ─── */
export interface AppSettings {
  categories: string[];       // 업무 분류 (레거시 호환)
  taskCategories: string[];
  kpiCategories: string[];
  ceoMeetingDates: string[];  // 대표이사 미팅 일정 (YYYY-MM-DD 형식)
}

export type TaskFormData = Omit<Task, 'taskId' | 'priorityScore' | 'createdAt' | 'updatedAt' | 'createdBy'>;

/* ─── 팀원 ─── */
export interface Member {
  memberId: string;
  name: string;
  email: string;
  role: '팀장' | '팀원';
  department: string;
  isActive: boolean;
}

/* ─── KPI ─── */
export type KpiPeriod = '월간' | '분기' | '반기' | '연간';
export type KpiStatus = '달성' | '진행중' | '위험';

export interface Kpi {
  kpiId: string;
  title: string;
  description: string;
  assignee: string;
  assigneeName: string;
  period: KpiPeriod;
  targetValue: number;
  currentValue: number;
  unit: string;
  achievementRate: number;
  status: KpiStatus;
  childKpiIds: string[];
  linkedTaskIds: string[];
  startDate: Timestamp | null;
  endDate: Timestamp | null;
  isParent: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ChildKpi {
  childKpiId: string;
  parentKpiId: string;
  title: string;
  description: string;
  assignee: string;
  assigneeName: string;
  period: KpiPeriod;
  targetValue: number;
  currentValue: number;
  unit: string;
  achievementRate: number;
  status: KpiStatus;
  linkedTaskIds: string[];
  startDate: Timestamp | null;
  endDate: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* ─── 회의록 ─── */
export type MeetingType = '주간' | '격주' | '월간';

export interface MeetingLog {
  meetingId: string;
  meetingType: MeetingType;
  meetingDate: Timestamp;
  attendees: string[];
  generatedReport: WeeklyReport | BiweeklyReport | MonthlyReport;
  actualNotes: string;
  decisions: string[];
  nextActions: string[];
  createdAt: Timestamp;
}

/* ─── 변경 이력 ─── */
export interface TaskHistory {
  historyId: string;
  taskId: string;
  changedBy: string;
  changedAt: Timestamp;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/* ─── 알림 ─── */
export type NotificationType = 'D-7' | 'D-3' | 'D-1' | 'D-day' | '지연' | '과부하';

export interface Notification {
  notifId: string;
  taskId: string;
  type: NotificationType;
  message: string;
  targetUserId: string;
  isRead: boolean;
  createdAt: Timestamp;
}

/* ─── 리포트 타입 ─── */
export interface CompletedTaskItem {
  title: string;
  completedDate: string;
  actualHours: number;
}

export interface AssigneeCompletedGroup {
  assigneeName: string;
  tasks: CompletedTaskItem[];
}

export interface InProgressTaskItem {
  title: string;
  assigneeName: string;
  progressRate: number;
  dueDate: string;
  daysLeft: number;
}

export interface DelayedTaskItem {
  title: string;
  assigneeName: string;
  originalDueDate: string;
  delayDays: number;
  reason: string;
}

export interface UpcomingDeadlineItem {
  title: string;
  assigneeName: string;
  dueDate: string;
}

export interface KpiStatusItem {
  title: string;
  target: number;
  current: number;
  achievementRate: number;
  status: KpiStatus;
  unit: string;
}

export interface MemberWorkloadItem {
  name: string;
  totalTasks: number;
  completedThisWeek: number;
  inProgress: number;
  delayed: number;
}

export interface WeeklyReport {
  period: string;
  completedTasks: AssigneeCompletedGroup[];
  inProgressTasks: InProgressTaskItem[];
  delayedTasks: DelayedTaskItem[];
  upcomingDeadlines: UpcomingDeadlineItem[];
  kpiStatus: KpiStatusItem[];
  memberWorkload: MemberWorkloadItem[];
}

export interface CeoDecisionItem {
  title: string;
  assigneeName: string;
  reason: string;
  ceoFlagReason: string;
}

export interface BiweeklyReport extends WeeklyReport {
  twoWeekSummary: AssigneeCompletedGroup[];
  nextTwoWeeksPlanning: UpcomingDeadlineItem[];
  ceoDecisionItems: CeoDecisionItem[];
  riskItems: DelayedTaskItem[];
}

export interface TeamPerformance {
  totalCompleted: number;
  totalDelayed: number;
  completionRate: number;
  avgProgressRate: number;
}

export interface MonthlyReport {
  period: string;
  monthlyKpiSummary: KpiStatusItem[];
  teamPerformance: TeamPerformance;
  memberSummary: MemberWorkloadItem[];
  highlights: CompletedTaskItem[];
  nextMonthPlanning: UpcomingDeadlineItem[];
  pendingItems: InProgressTaskItem[];
}
