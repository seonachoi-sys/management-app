import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Timestamp } from 'firebase/firestore';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addWeeks,
  addDays,
  addMonths,
  subMonths,
  differenceInDays,
} from 'date-fns';
import type { Task, MeetingType } from '../types';
import { fetchAllTasks } from '../services/taskService';
import { saveReportToObsidian, formatReportMarkdown } from '../services/obsidianService';
import {
  subscribeSavedReports,
  saveReport,
  updateSavedReport,
  deleteSavedReport,
  type SavedReportRecord,
} from '../services/meetingReportService';

/* ─── 아코디언 블록 ─── */
function Block({
  title,
  count,
  dotColor,
  danger,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  dotColor?: string;
  danger?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rpt-block ${danger ? 'rpt-block-danger' : ''}`}>
      <button className="rpt-block-header" onClick={() => setOpen(!open)} type="button">
        {dotColor && <span className={`rpt-dot rpt-dot-${dotColor}`} />}
        <span style={{ flex: 1, textAlign: 'left' }}>{title}</span>
        {count !== undefined && <span className="rpt-count">{count}</span>}
        <span className={`rpt-toggle ${open ? 'open' : ''}`}>▶</span>
      </button>
      {open && <div className="rpt-block-body">{children}</div>}
    </div>
  );
}

/* ─── 유틸 ─── */
/** 날짜 문자열을 로컬 시간으로 파싱 (UTC 밀림 방지) */
function localDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

function tsToDate(ts: Timestamp | null | undefined): Date | null {
  if (!ts) return null;
  return ts instanceof Timestamp ? ts.toDate() : new Date(ts as unknown as string);
}

function isParentHeader(task: Task, allTasks: Task[]): boolean {
  if (task.parentTaskId) return false;
  return allTasks.some((t) => t.parentTaskId === task.taskId);
}

interface CategoryGroup {
  category: string;
  tasks: Task[];
}

function groupByCategory(tasks: Task[]): CategoryGroup[] {
  const map: Record<string, Task[]> = {};
  for (const t of tasks) {
    const cat = t.category || '기타';
    if (!map[cat]) map[cat] = [];
    map[cat].push(t);
  }
  return Object.entries(map).map(([category, tasks]) => ({ category, tasks }));
}

interface AssigneeGroup { assignee: string; tasks: Task[]; }
function groupByAssignee(tasks: Task[]): AssigneeGroup[] {
  const map: Record<string, Task[]> = {};
  for (const t of tasks) {
    const name = t.assigneeName || '미배정';
    if (!map[name]) map[name] = [];
    map[name].push(t);
  }
  return Object.entries(map).map(([assignee, tasks]) => ({ assignee, tasks }));
}

/* ─── 리드타임 통계 헬퍼 ─── */
interface LeadTimeStats {
  early: number;   // 조기완료 건수
  onTime: number;  // 정시완료 건수
  late: number;    // 지연완료 건수
  avgDays: number; // 평균 리드타임 (양수=단축, 음수=지연)
  hasData: boolean;
}

function calcLeadTimeStats(tasks: Task[]): LeadTimeStats {
  const withLt = tasks.filter((t) => t.leadTimeDays != null);
  if (withLt.length === 0) return { early: 0, onTime: 0, late: 0, avgDays: 0, hasData: false };
  let early = 0, onTime = 0, late = 0, sum = 0;
  for (const t of withLt) {
    const d = t.leadTimeDays!;
    sum += d;
    if (d > 0) early++;
    else if (d === 0) onTime++;
    else late++;
  }
  return { early, onTime, late, avgDays: Math.round((sum / withLt.length) * 10) / 10, hasData: true };
}

function LeadTimeSummary({ tasks }: { tasks: Task[] }) {
  const lt = calcLeadTimeStats(tasks);
  if (!lt.hasData) return null;
  const avgLabel = lt.avgDays > 0
    ? `평균 ${lt.avgDays}일 단축`
    : lt.avgDays < 0
      ? `평균 ${Math.abs(lt.avgDays)}일 지연`
      : '평균 정시완료';
  const avgColor = lt.avgDays > 0 ? 'var(--c-green,#0d9f61)' : lt.avgDays < 0 ? 'var(--c-red,#e53935)' : 'var(--c-text-3,#999)';
  return (
    <div className="rpt-leadtime-bar" style={{ display: 'flex', gap: 12, padding: '8px 12px', fontSize: 12, background: 'var(--c-bg-2,#f7f8fa)', borderRadius: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ color: 'var(--c-green,#0d9f61)' }}>조기완료 {lt.early}건</span>
      <span style={{ color: 'var(--c-text-3,#999)' }}>정시완료 {lt.onTime}건</span>
      <span style={{ color: 'var(--c-red,#e53935)' }}>지연완료 {lt.late}건</span>
      <span style={{ marginLeft: 'auto', fontWeight: 600, color: avgColor }}>{avgLabel}</span>
    </div>
  );
}

function LeadTimeByCategoryMonthly({ tasks, prevMonthTasks }: { tasks: Task[]; prevMonthTasks: Task[] }) {
  const groups = groupByCategory(tasks.filter((t) => t.leadTimeDays != null));
  if (groups.length === 0) return null;

  const prevStats = calcLeadTimeStats(prevMonthTasks);

  return (
    <div style={{ padding: '8px 12px', fontSize: 12, background: 'var(--c-bg-2,#f7f8fa)', borderRadius: 6, marginTop: 6 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--c-text-2,#666)' }}>카테고리별 평균 리드타임</div>
      {groups.map((g) => {
        const st = calcLeadTimeStats(g.tasks);
        const label = st.avgDays > 0 ? `${st.avgDays}일 단축` : st.avgDays < 0 ? `${Math.abs(st.avgDays)}일 지연` : '정시';
        const color = st.avgDays > 0 ? 'var(--c-green,#0d9f61)' : st.avgDays < 0 ? 'var(--c-red,#e53935)' : 'var(--c-text-3,#999)';
        return (
          <div key={g.category} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span>{g.category}</span>
            <span style={{ color, fontWeight: 500 }}>{label}</span>
          </div>
        );
      })}
      {prevStats.hasData && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--c-border,#e5e7eb)' }}>
          {(() => {
            const currentAvg = calcLeadTimeStats(tasks).avgDays;
            const diff = Math.round((currentAvg - prevStats.avgDays) * 10) / 10;
            if (diff === 0) return <span style={{ color: 'var(--c-text-3,#999)' }}>전월 대비 변동 없음</span>;
            const improved = diff > 0;
            return (
              <span style={{ fontWeight: 600, color: improved ? 'var(--c-green,#0d9f61)' : 'var(--c-red,#e53935)' }}>
                전월 대비 {Math.abs(diff)}일 {improved ? '개선' : '악화'}
              </span>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function renderCompletedList(tasks: Task[]) {
  return tasks.map((t) => {
    const cd = tsToDate(t.completedDate);
    return (
      <div key={t.taskId} className="rpt-item">
        <span className="rpt-item-title">{t.title}</span>
        <span className="rpt-item-assignee">{t.assigneeName}</span>
        <span className="rpt-item-date">{cd ? format(cd, 'MM.dd 완료') : ''}</span>
      </div>
    );
  });
}

/** 담당자 → 카테고리 2단 그룹 렌더링 */
function renderAssigneeCategoryBlocks(tasks: Task[], renderFn: (tasks: Task[]) => React.ReactNode) {
  const byAssignee = groupByAssignee(tasks);
  if (byAssignee.length === 0) return <div className="rpt-empty">해당 없음</div>;
  // 담당자별 개수 많은 순으로 정렬
  byAssignee.sort((a, b) => b.tasks.length - a.tasks.length);
  return byAssignee.map((ag) => {
    const catGroups = groupByCategory(ag.tasks);
    return (
      <div key={ag.assignee} className="rpt-assignee-group">
        <div className="rpt-assignee-header">
          <span className="rpt-assignee-name">{ag.assignee}</span>
          <span className="rpt-assignee-cnt">{ag.tasks.length}건</span>
        </div>
        <div className="rpt-assignee-body">
          {catGroups.map((cg) => (
            <div key={cg.category} className="rpt-subcat">
              <div className="rpt-subcat-label">{cg.category}</div>
              <div className="rpt-list">{renderFn(cg.tasks)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  });
}

/* ─── 메인 컴포넌트 ─── */
interface Props {
  ceoMeetingDates?: string[];
  userId?: string;
  userName?: string;
}

export default function MeetingReportPanel({ ceoMeetingDates = [], userId = '', userName = '' }: Props) {
  const [reportType, setReportType] = useState<MeetingType>('주간');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [generated, setGenerated] = useState(false);

  /* ─── 저장된 리포트 ─── */
  const [savedReports, setSavedReports] = useState<SavedReportRecord[]>([]);
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);
  const [currentReportTitle, setCurrentReportTitle] = useState('');
  const [savingReport, setSavingReport] = useState(false);
  // 저장된 리포트 불러올 때 기간 자동 리셋 effect를 1회 건너뛰기 위한 플래그
  const skipResetRef = useRef(false);

  // 업무 비고 (회의 중 입력)
  const [taskNotes, setTaskNotes] = useState<Record<string, string>>({});

  const updateTaskNote = useCallback((taskId: string, note: string) => {
    setTaskNotes((prev) => ({ ...prev, [taskId]: note }));
  }, []);

  // 회의록에서 숨긴 업무 ID
  const [hiddenTaskIds, setHiddenTaskIds] = useState<Set<string>>(new Set());

  const hideTask = useCallback((taskId: string) => {
    setHiddenTaskIds((prev) => {
      const s = new Set(prev);
      s.add(taskId);
      return s;
    });
  }, []);
  const restoreAllTasks = useCallback(() => setHiddenTaskIds(new Set()), []);

  const now = new Date();
  const [startDate, setStartDate] = useState(format(startOfMonth(now), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(now), 'yyyy-MM-dd'));

  /* ─── 월간 보고서: 월 선택 (기본값: 지난달) ─── */
  const [selectedMonth, setSelectedMonth] = useState(() => format(subMonths(new Date(), 1), 'yyyy-MM'));

  // 월 선택 옵션 (최근 12개월)
  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = subMonths(new Date(), i);
      opts.push({ value: format(d, 'yyyy-MM'), label: format(d, 'yyyy년 M월') });
    }
    return opts;
  }, []);

  // 선택월 기준 기간 자동 계산
  const monthlyPeriod = useMemo(() => {
    const base = localDate(selectedMonth + '-01');
    const monthStart = startOfMonth(base);
    const monthEnd = endOfMonth(base);
    const nextMonthStart = startOfMonth(addMonths(base, 1));
    const nextMonthEnd = endOfMonth(addMonths(base, 1));
    return {
      start: format(monthStart, 'yyyy-MM-dd'),
      end: format(monthEnd, 'yyyy-MM-dd'),
      nextStart: format(nextMonthStart, 'yyyy-MM-dd'),
      nextEnd: format(nextMonthEnd, 'yyyy-MM-dd'),
      label: format(base, 'yyyy년 M월'),
      nextLabel: format(addMonths(base, 1), 'M'),
    };
  }, [selectedMonth]);

  /* ─── 2주 보고서: 미팅 날짜 선택 ─── */
  const sortedCeoDates = useMemo(() => [...ceoMeetingDates].sort(), [ceoMeetingDates]);
  const [selectedCeoDate, setSelectedCeoDate] = useState<string>('');

  // 기본값: 오늘 이후 가장 가까운 미팅일
  useEffect(() => {
    if (sortedCeoDates.length === 0) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    const upcoming = sortedCeoDates.find((d) => d >= today);
    setSelectedCeoDate(upcoming || sortedCeoDates[sortedCeoDates.length - 1]);
  }, [sortedCeoDates]);

  // 선택한 미팅일 기준 ±14일 자동 계산
  const biweeklyPeriod = useMemo(() => {
    if (!selectedCeoDate) return null;
    const selected = localDate(selectedCeoDate);
    const prevDate = addDays(selected, -14);
    const nextDate = addDays(selected, 14);
    return {
      start: format(prevDate, 'yyyy-MM-dd'),
      end: format(nextDate, 'yyyy-MM-dd'),
      selected: selectedCeoDate,
    };
  }, [selectedCeoDate]);

  /* ─── 저장된 리포트 실시간 구독 ─── */
  useEffect(() => {
    const unsub = subscribeSavedReports(
      (records) => setSavedReports(records),
      (err) => setError(err.message),
    );
    return unsub;
  }, []);

  /* ─── 탭 변경 시 기간 자동 설정 ─── */
  useEffect(() => {
    // 저장된 리포트를 불러오는 중이면 기간 리셋 1회 건너뛴다
    if (skipResetRef.current) {
      skipResetRef.current = false;
      return;
    }
    // 탭/기간을 사용자가 직접 바꾸면 더 이상 저장된 리포트와 연결되지 않음
    setCurrentReportId(null);
    setCurrentReportTitle('');
    const today = new Date();
    if (reportType === '주간') {
      setStartDate(format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
      setEndDate(format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
    } else if (reportType === '격주') {
      if (biweeklyPeriod) {
        setStartDate(biweeklyPeriod.start);
        setEndDate(biweeklyPeriod.end);
      } else {
        setStartDate(format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
        setEndDate(format(endOfWeek(addWeeks(today, 1), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
      }
    } else {
      setStartDate(monthlyPeriod.start);
      setEndDate(monthlyPeriod.end);
    }
    setGenerated(false);
  }, [reportType, biweeklyPeriod, monthlyPeriod]);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tasks = await fetchAllTasks();
      setAllTasks(tasks);
      setGenerated(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '리포트 생성에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  /* ─── 저장된 리포트 불러오기 ─── */
  // 설정만 복원하고 업무는 새로 불러온다 → 저장 후 업무가 수정돼도 자동 반영
  const loadSavedReport = useCallback(async (rec: SavedReportRecord) => {
    skipResetRef.current = true;
    setReportType(rec.reportType);
    if (rec.selectedCeoDate) setSelectedCeoDate(rec.selectedCeoDate);
    if (rec.selectedMonth) setSelectedMonth(rec.selectedMonth);
    setStartDate(rec.startDate);
    setEndDate(rec.endDate);
    setTaskNotes(rec.taskNotes || {});
    setHiddenTaskIds(new Set(rec.hiddenTaskIds || []));
    setCurrentReportId(rec.id);
    setCurrentReportTitle(rec.title);
    setLoading(true);
    setError(null);
    try {
      const tasks = await fetchAllTasks();
      setAllTasks(tasks);
      setGenerated(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '리포트를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
      // 리셋 effect가 dep 변화 없이 실행되지 않은 경우를 대비해 플래그 정리
      skipResetRef.current = false;
    }
  }, []);

  /* ─── 저장된 리포트 삭제 ─── */
  const handleDeleteSavedReport = useCallback(async (id: string) => {
    if (!window.confirm('이 저장된 리포트를 삭제할까요?')) return;
    try {
      await deleteSavedReport(id);
      setCurrentReportId((prev) => (prev === id ? null : prev));
      setCurrentReportTitle('');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    }
  }, []);

  // 상위업무(그룹 헤더) 제외한 실제 업무
  const reportTasks = useMemo(() => {
    return allTasks.filter((t) => !isParentHeader(t, allTasks));
  }, [allTasks]);

  /* ─── 주간 리포트 데이터 ─── */
  const weeklyData = useMemo(() => {
    if (reportType !== '주간') return null;
    const today = new Date();
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
    const nextWeekStart = startOfWeek(addWeeks(today, 1), { weekStartsOn: 1 });
    const nextWeekEnd = endOfWeek(addWeeks(today, 1), { weekStartsOn: 1 });

    const notHidden = (t: Task) => !hiddenTaskIds.has(t.taskId);

    const completed = reportTasks.filter((t) => {
      if (t.status !== '완료') return false;
      const cd = tsToDate(t.completedDate);
      return cd !== null && cd >= weekStart && cd <= weekEnd;
    }).filter(notHidden);

    const incomplete = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd >= weekStart && dd <= weekEnd && dd < today;
    }).filter(notHidden);

    const nextWeek = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd >= nextWeekStart && dd <= nextWeekEnd;
    }).filter(notHidden);

    const delayed = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd < today;
    }).filter(notHidden);

    return { completed, incomplete, nextWeek, delayed };
  }, [reportType, reportTasks, hiddenTaskIds]);

  /* ─── 격주(CEO) 리포트 데이터 ─── */
  const biweeklyData = useMemo(() => {
    if (reportType !== '격주' || !biweeklyPeriod) return null;
    const prevDate = localDate(biweeklyPeriod.start);
    const selectedDate = localDate(biweeklyPeriod.selected);
    selectedDate.setHours(23, 59, 59, 999);
    const nextDate = localDate(biweeklyPeriod.end);
    nextDate.setHours(23, 59, 59, 999);

    const notHidden = (t: Task) => !hiddenTaskIds.has(t.taskId);

    const planned = reportTasks.filter((t) => {
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd >= prevDate && dd <= selectedDate;
    }).filter(notHidden);

    const planCompleted = planned.filter((t) => t.status === '완료');
    const planInProgress = planned.filter((t) => t.status === '진행중');
    const planRemaining = planned.filter((t) => t.status !== '완료' && t.status !== '진행중');

    const upcoming = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd > selectedDate && dd <= nextDate;
    }).filter(notHidden);

    const ceoDecision = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      return (t.reportTo === 'ceo' || t.reportTo === 'both') || t.status === '보류';
    }).filter(notHidden);

    return { planned, planCompleted, planInProgress, planRemaining, upcoming, ceoDecision };
  }, [reportType, reportTasks, biweeklyPeriod, hiddenTaskIds]);

  /* ─── 격주 섹션별 숨김 건수 (원본 대비) ─── */
  const biweeklyHiddenCounts = useMemo(() => {
    if (reportType !== '격주' || !biweeklyPeriod) {
      return { planned: 0, upcoming: 0, ceoDecision: 0 };
    }
    const prevDate = localDate(biweeklyPeriod.start);
    const selectedDate = localDate(biweeklyPeriod.selected);
    selectedDate.setHours(23, 59, 59, 999);
    const nextDate = localDate(biweeklyPeriod.end);
    nextDate.setHours(23, 59, 59, 999);

    const isHidden = (t: Task) => hiddenTaskIds.has(t.taskId);

    const plannedHidden = reportTasks.filter((t) => {
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd >= prevDate && dd <= selectedDate && isHidden(t);
    }).length;

    const upcomingHidden = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd > selectedDate && dd <= nextDate && isHidden(t);
    }).length;

    const ceoHidden = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      return ((t.reportTo === 'ceo' || t.reportTo === 'both') || t.status === '보류') && isHidden(t);
    }).length;

    return { planned: plannedHidden, upcoming: upcomingHidden, ceoDecision: ceoHidden };
  }, [reportType, reportTasks, biweeklyPeriod, hiddenTaskIds]);

  /* ─── 월간 리포트 데이터 ─── */
  const monthlyData = useMemo(() => {
    if (reportType !== '월간') return null;
    const rangeStart = localDate(monthlyPeriod.start);
    const rangeEnd = localDate(monthlyPeriod.end);
    rangeEnd.setHours(23, 59, 59, 999);
    const nextStart = localDate(monthlyPeriod.nextStart);
    const nextEnd = localDate(monthlyPeriod.nextEnd);
    nextEnd.setHours(23, 59, 59, 999);

    const notHidden = (t: Task) => !hiddenTaskIds.has(t.taskId);

    const completed = reportTasks.filter((t) => {
      if (t.status !== '완료') return false;
      const cd = tsToDate(t.completedDate);
      return cd !== null && cd >= rangeStart && cd <= rangeEnd;
    }).filter(notHidden);

    const carryover = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd >= rangeStart && dd <= rangeEnd;
    }).filter(notHidden);

    const nextMonthTasks = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      if (t.status !== '진행중' && t.status !== '대기') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd >= nextStart && dd <= nextEnd;
    }).filter(notHidden);

    // 전월 완료 업무 (리드타임 전월 대비 비교용)
    const prevStart = startOfMonth(subMonths(localDate(monthlyPeriod.start), 1));
    const prevEnd = endOfMonth(subMonths(localDate(monthlyPeriod.start), 1));
    prevEnd.setHours(23, 59, 59, 999);
    const prevMonthCompleted = reportTasks.filter((t) => {
      if (t.status !== '완료') return false;
      const cd = tsToDate(t.completedDate);
      return cd !== null && cd >= prevStart && cd <= prevEnd;
    });

    return { completed, carryover, nextMonthTasks, prevMonthCompleted };
  }, [reportType, reportTasks, monthlyPeriod, hiddenTaskIds]);

  /* ─── 통합 stats (요약 카드용) ─── */
  const stats = useMemo(() => {
    if (reportType === '주간' && weeklyData) {
      const total = weeklyData.completed.length + weeklyData.incomplete.length + weeklyData.nextWeek.length + weeklyData.delayed.length;
      return {
        total,
        completed: weeklyData.completed.length,
        incomplete: weeklyData.incomplete.length,
        delayed: weeklyData.delayed.length,
      };
    }
    if (reportType === '격주' && biweeklyData) {
      return {
        total: biweeklyData.planned.length,
        completed: biweeklyData.planCompleted.length,
        incomplete: biweeklyData.planInProgress.length,
        delayed: biweeklyData.planRemaining.length,
      };
    }
    if (reportType === '월간' && monthlyData) {
      const total = monthlyData.completed.length + monthlyData.carryover.length + monthlyData.nextMonthTasks.length;
      return {
        total,
        completed: monthlyData.completed.length,
        incomplete: monthlyData.nextMonthTasks.length,
        delayed: monthlyData.carryover.length,
      };
    }
    return { total: 0, completed: 0, incomplete: 0, delayed: 0 };
  }, [reportType, weeklyData, biweeklyData, monthlyData]);

  /* ─── 기간 라벨 ─── */
  const periodLabel = useMemo(() => {
    if (reportType === '격주' && biweeklyPeriod) {
      const sf = format(localDate(biweeklyPeriod.start), 'M.dd');
      const ef = format(localDate(biweeklyPeriod.selected), 'M.dd');
      return `${sf} ~ ${ef} 대표이사 보고`;
    }
    if (reportType === '월간') {
      return `${monthlyPeriod.label} 업무 현황`;
    }
    const rangeStart = localDate(startDate);
    const rangeEnd = localDate(endDate);
    return `${format(rangeStart, 'yyyy.MM.dd')} ~ ${format(rangeEnd, 'yyyy.MM.dd')}`;
  }, [reportType, startDate, endDate, biweeklyPeriod, monthlyPeriod]);

  /* ─── 리포트 저장 / 수정 저장 ─── */
  const handleSaveReport = useCallback(async () => {
    if (!generated) return;
    setSavingReport(true);
    try {
      const payload = {
        reportType,
        selectedCeoDate,
        selectedMonth,
        startDate,
        endDate,
        taskNotes,
        hiddenTaskIds: Array.from(hiddenTaskIds),
      };
      if (currentReportId) {
        await updateSavedReport(currentReportId, payload, userId, userName);
        alert('리포트가 수정 저장되었습니다.');
      } else {
        const input = window.prompt('리포트 이름을 입력하세요.', periodLabel);
        if (input === null) return;
        const title = input.trim() || periodLabel;
        const id = await saveReport({
          ...payload,
          title,
          createdBy: userId,
          createdByName: userName,
        });
        setCurrentReportId(id);
        setCurrentReportTitle(title);
        alert('리포트가 저장되었습니다.');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '리포트 저장에 실패했습니다.');
    } finally {
      setSavingReport(false);
    }
  }, [
    generated, currentReportId, reportType, selectedCeoDate, selectedMonth,
    startDate, endDate, taskNotes, hiddenTaskIds, periodLabel, userId, userName,
  ]);

  /* ─── 카테고리 그룹 (클립보드/Obsidian 용) ─── */
  const completedTasks = useMemo(() => {
    if (reportType === '주간') return weeklyData?.completed || [];
    if (reportType === '격주') return biweeklyData?.planCompleted || [];
    return monthlyData?.completed || [];
  }, [reportType, weeklyData, biweeklyData, monthlyData]);

  const incompleteTasks = useMemo(() => {
    if (reportType === '주간') return weeklyData?.incomplete || [];
    if (reportType === '격주') return [...(biweeklyData?.planInProgress || []), ...(biweeklyData?.planRemaining || [])];
    return monthlyData?.nextMonthTasks || [];
  }, [reportType, weeklyData, biweeklyData, monthlyData]);

  const completedByCategory = useMemo(() => groupByCategory(completedTasks), [completedTasks]);
  const incompleteByCategory = useMemo(() => groupByCategory(incompleteTasks), [incompleteTasks]);

  // CEO 결재 필요 업무
  const ceoItems = useMemo(() => {
    if (reportType === '격주') return biweeklyData?.ceoDecision || [];
    return incompleteTasks.filter((t) => t.reportTo === 'ceo' || t.reportTo === 'both');
  }, [reportType, biweeklyData, incompleteTasks]);

  // 클립보드 복사
  const copyToClipboard = () => {
    let text = `${periodLabel}\n${'='.repeat(40)}\n\n`;
    text += `전체 ${stats.total}건 | 완료 ${stats.completed}건 | 진행 ${stats.incomplete}건 | 지연 ${stats.delayed}건\n\n`;

    if (incompleteByCategory.length > 0) {
      text += '■ 진행 업무\n';
      incompleteByCategory.forEach((g) => {
        text += `\n  [${g.category}]\n`;
        g.tasks.forEach((t) => {
          const dd = tsToDate(t.dueDate);
          const dday = dd ? differenceInDays(dd, new Date()) : null;
          const ddayStr = dday !== null ? (dday < 0 ? `D+${Math.abs(dday)}` : `D-${dday}`) : '';
          text += `    - ${t.title} (${t.assigneeName || '미배정'}, ${t.progressRate}% ${ddayStr})\n`;
        });
      });
      text += '\n';
    }

    if (completedByCategory.length > 0) {
      text += '■ 완료 업무\n';
      completedByCategory.forEach((g) => {
        text += `\n  [${g.category}]\n`;
        g.tasks.forEach((t) => {
          const cd = tsToDate(t.completedDate);
          text += `    - ${t.title} (${t.assigneeName || ''}, ${cd ? format(cd, 'MM.dd') : ''})\n`;
        });
      });
    }

    if (ceoItems.length > 0) {
      text += '\n■ CEO 결재/검토 필요\n';
      ceoItems.forEach((t) => {
        text += `  - ${t.title} (${t.assigneeName || ''}) - ${t.reportNote || ''}\n`;
      });
    }

    navigator.clipboard.writeText(text);
    alert('클립보드에 복사되었습니다.');
  };

  // Obsidian 저장
  const [savingObsidian, setSavingObsidian] = useState(false);

  const handleSaveToObsidian = async () => {
    setSavingObsidian(true);
    try {
      const typeLabel = reportType === '주간' ? '주간회의' : reportType === '격주' ? '격주보고' : '월간보고';

      const incompleteForMd = incompleteByCategory.map((g) => ({
        category: g.category,
        tasks: g.tasks.map((t) => {
          const dd = tsToDate(t.dueDate);
          const daysLeft = dd ? differenceInDays(dd, new Date()) : null;
          return {
            title: t.title,
            assigneeName: t.assigneeName || '',
            progressRate: t.progressRate || 0,
            daysLeft,
            reportNote: t.reportNote || '',
          };
        }),
      }));

      const completedForMd = completedByCategory.map((g) => ({
        category: g.category,
        tasks: g.tasks.map((t) => {
          const cd = tsToDate(t.completedDate);
          return {
            title: t.title,
            assigneeName: t.assigneeName || '',
            completedDate: cd ? format(cd, 'MM.dd') : '',
          };
        }),
      }));

      const ceoForMd = ceoItems.map((t) => ({
        title: t.title,
        assigneeName: t.assigneeName || '',
        reportNote: t.reportNote || '',
      }));

      const markdown = formatReportMarkdown(
        typeLabel,
        periodLabel,
        stats,
        incompleteForMd,
        completedForMd,
        ceoForMd,
      );

      const savedPath = await saveReportToObsidian(markdown, typeLabel, periodLabel);
      alert(`Obsidian에 저장 완료!\n📁 ${savedPath}`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Obsidian 저장 실패');
    } finally {
      setSavingObsidian(false);
    }
  };

  /* ─── 통합 4칸 테이블 렌더 (계획 / 결과 / 향후 / 비고) ─── */
  const renderUnifiedReport = ({
    planned,
    upcoming,
    pastLabel,
    futureLabel,
    blockTitle,
    summary,
    hiddenCount,
  }: {
    planned: Task[];
    upcoming: Task[];
    pastLabel: string;
    futureLabel: string;
    blockTitle: string;
    summary: { completed: number; inProgress: number; remaining: number };
    hiddenCount: number;
  }) => {
    const statusBadge = (t: Task) => {
      const color: Record<string, string> = {
        '완료': 'var(--c-green)', '진행중': 'var(--c-accent)', '대기': 'var(--c-text-3)',
        '지연': 'var(--c-red)', '보류': 'var(--c-orange)',
      };
      const bg: Record<string, string> = {
        '완료': 'var(--c-green-bg)', '진행중': 'var(--c-accent-light)', '대기': 'var(--c-bg-sub)',
        '지연': 'var(--c-red-bg)', '보류': 'var(--c-orange-bg)',
      };
      return (
        <span className="rpt-compare-badge" style={{ color: color[t.status], background: bg[t.status] }}>
          {t.status === '완료' ? '✓ 완료' : t.status}
        </span>
      );
    };

    const statusDetail = (t: Task) => {
      if (t.status === '완료') return null;
      const parts: string[] = [];
      if (t.progressRate > 0) parts.push(`${t.progressRate}%`);
      if (t.reportNote) parts.push(t.reportNote);
      else if (t.status === '보류') parts.push('보류 중');
      else if (t.status === '지연') parts.push('마감 초과');
      return parts.length > 0 ? parts.join(' · ') : null;
    };

    // 담당자별로 통합
    const allAssignees = new Set<string>();
    planned.forEach((t) => allAssignees.add(t.assigneeName || '미배정'));
    upcoming.forEach((t) => allAssignees.add(t.assigneeName || '미배정'));
    const assigneeBlocks = Array.from(allAssignees).map((name) => {
      const past = planned.filter((t) => (t.assigneeName || '미배정') === name);
      const future = upcoming.filter((t) => (t.assigneeName || '미배정') === name);
      return { name, past, future, total: past.length + future.length };
    });
    assigneeBlocks.sort((a, b) => b.total - a.total);

    const sortByDue = (a: Task, b: Task) => {
      const da = tsToDate(a.dueDate)?.getTime() ?? Infinity;
      const db = tsToDate(b.dueDate)?.getTime() ?? Infinity;
      return da - db;
    };

    /** 담당자별로 카테고리 통합 그룹: 같은 카테고리 안에서 past + future 묶기 */
    const buildCategoryGroups = (past: Task[], future: Task[]) => {
      const map: Record<string, { past: Task[]; future: Task[] }> = {};
      past.forEach((t) => {
        const cat = t.category || '기타';
        if (!map[cat]) map[cat] = { past: [], future: [] };
        map[cat].past.push(t);
      });
      future.forEach((t) => {
        const cat = t.category || '기타';
        if (!map[cat]) map[cat] = { past: [], future: [] };
        map[cat].future.push(t);
      });
      return Object.entries(map)
        .map(([category, g]) => ({
          category,
          past: [...g.past].sort(sortByDue),
          future: [...g.future].sort(sortByDue),
        }))
        .sort((a, b) => a.category.localeCompare(b.category, 'ko'));
    };

    return (
      <Block title={blockTitle} count={planned.length + upcoming.length} dotColor="green" defaultOpen>
        {hiddenCount > 0 && (
          <div className="rpt-hidden-bar">
            <span>숨긴 업무 {hiddenCount}건</span>
            <button type="button" className="rpt-restore-btn" onClick={restoreAllTasks}>
              모두 복원
            </button>
          </div>
        )}
        {planned.length === 0 && upcoming.length === 0 ? (
          <div className="rpt-empty">해당 기간 업무 없음</div>
        ) : (
          <>
            {/* 요약 바 */}
            <div className="rpt-compare-summary">
              <span className="rpt-compare-stat rpt-compare-stat-done">완료 {summary.completed}</span>
              <span className="rpt-compare-stat rpt-compare-stat-prog">진행중 {summary.inProgress}</span>
              <span className="rpt-compare-stat rpt-compare-stat-left">미완료 {summary.remaining}</span>
              <span className="rpt-compare-stat" style={{ color: 'var(--c-accent)', borderColor: 'var(--c-accent)' }}>{futureLabel} {upcoming.length}</span>
            </div>

            {assigneeBlocks.map((ag) => {
              const catGroups = buildCategoryGroups(ag.past, ag.future);
              return (
                <div key={ag.name} className="rpt-assignee-group">
                  <div className="rpt-assignee-header">
                    <span className="rpt-assignee-name">{ag.name}</span>
                    <span className="rpt-assignee-cnt">{pastLabel} {ag.past.length} · {futureLabel} {ag.future.length}</span>
                  </div>
                  <div className="rpt-compare-table rpt-compare-table-4col">
                    <div className="rpt-compare-header">
                      <div className="rpt-compare-col-plan">계획</div>
                      <div className="rpt-compare-col-result">결과</div>
                      <div className="rpt-compare-col-upcoming">{futureLabel} 진행</div>
                      <div className="rpt-compare-col-note">비고</div>
                    </div>

                    {catGroups.map((cg) => (
                      <React.Fragment key={`cat-${cg.category}`}>
                        <div className="rpt-compare-cat-divider">
                          <span className="rpt-compare-cat-name">{cg.category}</span>
                          <span className="rpt-compare-cat-cnt">
                            {pastLabel} {cg.past.length} · {futureLabel} {cg.future.length}
                          </span>
                        </div>

                        {/* 지난 task — 계획·결과 셀 채움 */}
                        {cg.past.map((t) => {
                          const detail = statusDetail(t);
                          const dd = tsToDate(t.dueDate);
                          return (
                            <div key={`past-${t.taskId}`} className={`rpt-compare-row ${t.status === '완료' ? 'rpt-compare-row-done' : t.status === '지연' || t.status === '보류' ? 'rpt-compare-row-warn' : ''}`}>
                              <div className="rpt-compare-col-plan">
                                <span className="rpt-compare-title">{t.title}</span>
                                {dd && <span className="rpt-compare-assignee">마감 {format(dd, 'M.dd')}</span>}
                                {t.actionItems && t.actionItems.length > 0 && (
                                  <ul className="rpt-compare-checklist">
                                    {t.actionItems.map((it) => (
                                      <li key={it.id} className={it.done ? 'done' : ''}>
                                        <span className="rpt-checklist-mark">{it.done ? '✓' : '☐'}</span>
                                        <span className="rpt-checklist-text">{it.text}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div className="rpt-compare-col-result">
                                {statusBadge(t)}
                                {t.status === '진행중' && t.progressRate > 0 && (
                                  <div className="rpt-compare-progress">
                                    <div className="rpt-compare-progress-bar">
                                      <div className="rpt-compare-progress-fill" style={{ width: `${t.progressRate}%` }} />
                                    </div>
                                    <span className="rpt-compare-progress-text">{t.progressRate}%</span>
                                  </div>
                                )}
                                {detail && <div className="rpt-compare-detail">{detail}</div>}
                              </div>
                              <div className="rpt-compare-col-upcoming">
                                <span className="rpt-compare-col-empty">—</span>
                              </div>
                              <div className="rpt-compare-col-note">
                                <textarea
                                  className="rpt-row-note"
                                  placeholder="비고"
                                  value={taskNotes[t.taskId] || ''}
                                  onChange={(e) => updateTaskNote(t.taskId, e.target.value)}
                                  rows={2}
                                />
                                <button
                                  type="button"
                                  className="rpt-hide-btn"
                                  onClick={() => hideTask(t.taskId)}
                                  title="회의록에서 이 업무 숨기기"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          );
                        })}

                        {/* 향후 task — 앞으로 컬럼만 채움 */}
                        {cg.future.map((t) => {
                          const dd = tsToDate(t.dueDate);
                          return (
                            <div key={`fut-${t.taskId}`} className="rpt-compare-row rpt-compare-row-future">
                              <div className="rpt-compare-col-plan">
                                <span className="rpt-compare-col-empty">—</span>
                              </div>
                              <div className="rpt-compare-col-result">
                                <span className="rpt-compare-col-empty">—</span>
                              </div>
                              <div className="rpt-compare-col-upcoming">
                                <span className="rpt-compare-title">{t.title}</span>
                                {dd && <span className="rpt-compare-assignee">마감 {format(dd, 'M.dd')}</span>}
                                {t.actionItems && t.actionItems.length > 0 && (
                                  <ul className="rpt-compare-checklist">
                                    {t.actionItems.map((it) => (
                                      <li key={it.id} className={it.done ? 'done' : ''}>
                                        <span className="rpt-checklist-mark">{it.done ? '✓' : '☐'}</span>
                                        <span className="rpt-checklist-text">{it.text}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {t.reportNote && (
                                  <span style={{ fontSize: 11, color: '#888', marginTop: 2 }}>└ {t.reportNote}</span>
                                )}
                              </div>
                              <div className="rpt-compare-col-note">
                                <textarea
                                  className="rpt-row-note"
                                  placeholder="비고"
                                  value={taskNotes[t.taskId] || ''}
                                  onChange={(e) => updateTaskNote(t.taskId, e.target.value)}
                                  rows={2}
                                />
                                <button
                                  type="button"
                                  className="rpt-hide-btn"
                                  onClick={() => hideTask(t.taskId)}
                                  title="회의록에서 이 항목 숨기기"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              );
            })}
            <LeadTimeSummary tasks={planned.filter((t) => t.status === '완료')} />
          </>
        )}
      </Block>
    );
  };

  /* ─── 주간 리포트 렌더 ─── */
  const renderWeeklyReport = () => {
    if (!weeklyData) return null;
    const { completed, incomplete, nextWeek, delayed } = weeklyData;

    // 주간을 격주 양식에 매핑: planned = 이번주 완료 + 미완료 + 이월(중복 제거)
    const seen = new Set<string>();
    const planned: Task[] = [];
    [...completed, ...incomplete, ...delayed].forEach((t) => {
      if (!seen.has(t.taskId)) {
        seen.add(t.taskId);
        planned.push(t);
      }
    });

    const planCompleted = planned.filter((t) => t.status === '완료');
    const planInProgress = planned.filter((t) => t.status === '진행중');
    const planRemaining = planned.filter((t) => t.status !== '완료' && t.status !== '진행중');

    return (
      <>
        {renderUnifiedReport({
          planned,
          upcoming: nextWeek,
          pastLabel: '이번 주',
          futureLabel: '다음 주',
          blockTitle: '주간 업무 현황',
          summary: { completed: planCompleted.length, inProgress: planInProgress.length, remaining: planRemaining.length },
          hiddenCount: 0,
        })}
      </>
    );
  };

  /* ─── 격주(CEO) 리포트 렌더 ─── */
  const renderBiweeklyReport = () => {
    if (!biweeklyData) return null;
    const { planned, planCompleted, planInProgress, planRemaining, upcoming } = biweeklyData;

    return (
      <>
        {renderUnifiedReport({
          planned,
          upcoming,
          pastLabel: '지난 2주',
          futureLabel: '앞으로 2주',
          blockTitle: '2주 업무 현황',
          summary: { completed: planCompleted.length, inProgress: planInProgress.length, remaining: planRemaining.length },
          hiddenCount: biweeklyHiddenCounts.planned,
        })}
      </>
    );
  };

  /* ─── 월간 리포트 렌더 ─── */
  const renderMonthlyReport = () => {
    if (!monthlyData) return null;
    const { completed, carryover, nextMonthTasks, prevMonthCompleted } = monthlyData;
    const completedGroups = groupByCategory(completed);
    const nMonth = monthlyPeriod.nextLabel;

    // 카테고리별 완료율: 선택월 마감 업무 중 완료 비율
    const allMonthTasks = reportTasks.filter((t) => {
      const dd = tsToDate(t.dueDate);
      const rs = localDate(monthlyPeriod.start);
      const re = localDate(monthlyPeriod.end); re.setHours(23,59,59,999);
      return dd !== null && dd >= rs && dd <= re;
    });
    const catCompletionRate: Record<string, { total: number; done: number }> = {};
    allMonthTasks.forEach((t) => {
      const cat = t.category || '기타';
      if (!catCompletionRate[cat]) catCompletionRate[cat] = { total: 0, done: 0 };
      catCompletionRate[cat].total++;
      if (t.status === '완료') catCompletionRate[cat].done++;
    });

    // 월간 카테고리별 완료율을 표시하는 요약 블록
    const monthlyCategorySummary = completedGroups.length > 0 ? (
      <div className="rpt-cat-summary">
        <div className="rpt-cat-summary-label">카테고리별 완료율</div>
        <div className="rpt-cat-summary-list">
          {completedGroups.map((g) => {
            const rate = catCompletionRate[g.category];
            const pct = rate ? Math.round((rate.done / rate.total) * 100) : 0;
            return (
              <span key={g.category} className="rpt-cat-summary-chip">
                {g.category} <strong>{g.tasks.length}건</strong>
                <span style={{ marginLeft: 6, color: pct >= 80 ? 'var(--c-green,#0d9f61)' : 'var(--c-text-3,#999)' }}>
                  {pct}%
                </span>
              </span>
            );
          })}
        </div>
      </div>
    ) : null;

    return (
      <>
        <Block title={`${monthlyPeriod.label} 완료 업무`} count={completed.length} dotColor="green" defaultOpen>
          {monthlyCategorySummary}
          {renderAssigneeCategoryBlocks(completed, (tasks) => renderCompletedList(tasks))}
          <LeadTimeByCategoryMonthly tasks={completed} prevMonthTasks={prevMonthCompleted} />
        </Block>

        <Block title={`${nMonth}월 이월 업무`} count={carryover.length} dotColor="red" danger defaultOpen>
          {carryover.length === 0 ? <div className="rpt-empty">해당 없음</div> : (
            renderAssigneeCategoryBlocks(carryover, (tasks) => tasks.map((t) => {
              const statusLabel = t.status === '보류' ? '보류' : t.status === '지연' ? '지연' : '미완료';
              return (
                <div key={t.taskId} className="rpt-item rpt-item-delayed">
                  <span className="rpt-item-title">{t.title}</span>
                  <span className="rpt-item-tag rpt-tag-red">{statusLabel}</span>
                  <span className="rpt-item-reason">{t.reportNote || '사유 미입력'}</span>
                </div>
              );
            }))
          )}
        </Block>

        <Block title={`${nMonth}월 진행 예정 업무`} count={nextMonthTasks.length} dotColor="blue" defaultOpen>
          {nextMonthTasks.length === 0 ? <div className="rpt-empty">해당 없음</div> : (
            renderAssigneeCategoryBlocks(nextMonthTasks, (tasks) => tasks.map((t) => {
              const dd = tsToDate(t.dueDate);
              return (
                <div key={t.taskId} className="rpt-item">
                  <span className="rpt-item-title">{t.title}</span>
                  {dd && <span className="rpt-item-date">{format(dd, 'M.dd')} 마감</span>}
                </div>
              );
            }))
          )}
        </Block>
      </>
    );
  };

  return (
    <div className="tm-report-view">
      {/* 탭 */}
      <div className="tm-report-tabs">
        {(['주간', '격주', '월간'] as MeetingType[]).map((type) => (
          <button
            key={type}
            className={`tm-report-tab ${reportType === type ? 'active' : ''}`}
            onClick={() => setReportType(type)}
          >
            {type === '주간' ? '주간 (팀)' : type === '격주' ? '격주 (CEO)' : '월간 (전체)'}
          </button>
        ))}
      </div>

      {/* 저장된 리포트 불러오기 */}
      {savedReports.length > 0 && (
        <div className="rpt-saved-bar">
          <span className="rpt-saved-label">저장된 리포트</span>
          <select
            className="rpt-saved-select"
            value={currentReportId || ''}
            onChange={(e) => {
              const rec = savedReports.find((r) => r.id === e.target.value);
              if (rec) loadSavedReport(rec);
            }}
          >
            <option value="">불러올 리포트 선택</option>
            {savedReports.map((r) => (
              <option key={r.id} value={r.id}>
                [{r.reportType}] {r.title}
              </option>
            ))}
          </select>
          {currentReportId && (
            <button
              type="button"
              className="rpt-saved-delete"
              onClick={() => handleDeleteSavedReport(currentReportId)}
            >
              삭제
            </button>
          )}
        </div>
      )}

      {/* 날짜 선택 + 생성 */}
      <div className="rpt-date-bar">
        {reportType === '격주' ? (
          <label className="rpt-date-label">
            미팅 날짜
            <select
              value={selectedCeoDate}
              onChange={(e) => setSelectedCeoDate(e.target.value)}
              style={{ minWidth: 140 }}
            >
              {sortedCeoDates.length === 0 && <option value="">미팅 일정 없음</option>}
              {sortedCeoDates.map((d) => (
                <option key={d} value={d}>{format(new Date(d), 'yyyy.MM.dd (EEE)')}</option>
              ))}
            </select>
          </label>
        ) : reportType === '월간' ? (
          <label className="rpt-date-label">
            기준 월
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={{ minWidth: 140 }}
            >
              {monthOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="rpt-date-label">
              시작일
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <span className="rpt-date-sep">~</span>
            <label className="rpt-date-label">
              종료일
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </>
        )}
        <button className="tm-btn-generate" onClick={handleGenerate} disabled={loading}>
          {loading ? '생성 중...' : '리포트 생성'}
        </button>
        {generated && (
          <>
            <button className="tm-btn-copy" onClick={copyToClipboard}>복사</button>
            <button className="tm-btn-print" onClick={() => window.print()}>인쇄</button>
            <button
              className="tm-btn-save-report"
              onClick={handleSaveReport}
              disabled={savingReport}
            >
              {savingReport ? '저장 중...' : currentReportId ? '수정 저장' : '리포트 저장'}
            </button>
            <button
              className="tm-btn-obsidian"
              onClick={handleSaveToObsidian}
              disabled={savingObsidian}
            >
              {savingObsidian ? '저장 중...' : 'Obsidian 저장'}
            </button>
          </>
        )}
      </div>

      {error && <div className="tm-error">{error}</div>}

      {generated && (
        <div className="tm-report-content">
          {currentReportId && (
            <div className="rpt-loaded-banner">
              저장된 리포트 「{currentReportTitle}」 — 업무 내용은 항상 최신 상태로 표시됩니다.
            </div>
          )}
          <h2 className="tm-report-title">{periodLabel}</h2>

          {/* 요약 카드 */}
          <div className="tm-perf-grid">
            <div className="tm-perf-item">
              <div className="tm-perf-value">{stats.total}</div>
              <div className="tm-perf-label">{reportType === '격주' ? '계획' : '전체'}</div>
            </div>
            <div className="tm-perf-item">
              <div className="tm-perf-value" style={{ color: 'var(--c-green)' }}>{stats.completed}</div>
              <div className="tm-perf-label">완료</div>
            </div>
            <div className="tm-perf-item">
              <div className="tm-perf-value" style={{ color: 'var(--c-accent)' }}>{stats.incomplete}</div>
              <div className="tm-perf-label">
                {reportType === '월간' ? '차월 예정' : reportType === '격주' ? '진행중' : '미완료'}
              </div>
            </div>
            <div className="tm-perf-item">
              <div className="tm-perf-value" style={{ color: 'var(--c-red)' }}>{stats.delayed}</div>
              <div className="tm-perf-label">
                {reportType === '격주' ? '미완료' : reportType === '월간' ? '이월' : '지연'}
              </div>
            </div>
          </div>

          {/* 리포트 타입별 섹션 */}
          {reportType === '주간' && renderWeeklyReport()}
          {reportType === '격주' && renderBiweeklyReport()}
          {reportType === '월간' && renderMonthlyReport()}

          {/* 회의록 작성은 "회의록" 탭으로 분리됨 */}
        </div>
      )}

      {!generated && !loading && (
        <div className="tm-loading" style={{ height: 300 }}>
          기간을 설정하고 "리포트 생성" 버튼을 눌러주세요.
        </div>
      )}

    </div>
  );
}

