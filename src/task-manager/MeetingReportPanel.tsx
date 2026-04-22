import React, { useState, useCallback, useMemo, useEffect } from 'react';
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
import type { Task, MeetingType, Kpi } from '../types';
import { fetchAllTasks } from '../services/taskService';
import { fetchAllKpis } from '../services/kpiService';
import { saveReportToObsidian, formatReportMarkdown } from '../services/obsidianService';
import {
  subscribeMeetingLogs,
  saveMeetingLog,
  updateMeetingLog,
  deleteMeetingLog,
  type MeetingLogRecord,
  type MeetingLogInput,
  type MeetingTaskSnapshot,
} from '../services/meetingLogService';
import { useAuth } from '../hooks/useAuth';

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

const PRIORITY_ORDER: Record<string, number> = { '긴급': 0, '높음': 1, '보통': 2, '낮음': 3 };
function sortByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
}

/* ─── 카테고리 그룹 렌더링 헬퍼 ─── */
function renderTaskList(tasks: Task[], showProgress = true) {
  const today = new Date();
  return tasks.map((t) => {
    const dd = tsToDate(t.dueDate);
    const daysLeft = dd ? differenceInDays(dd, today) : null;
    const isDelayed = daysLeft !== null && daysLeft < 0;
    return (
      <div key={t.taskId} className={`rpt-item ${isDelayed ? 'rpt-item-delayed' : ''}`}>
        <span className="rpt-item-title">{t.title}</span>
        <span className="rpt-item-assignee">{t.assigneeName}</span>
        {showProgress && (
          <div className="rpt-progress">
            <div className="rpt-progress-bar">
              <div className="rpt-progress-fill" style={{ width: `${t.progressRate}%` }} />
            </div>
            <span className="rpt-progress-text">{t.progressRate}%</span>
          </div>
        )}
        {daysLeft !== null && (
          <span
            className={`rpt-item-tag ${isDelayed ? 'rpt-tag-red' : daysLeft <= 3 ? 'rpt-tag-orange' : 'rpt-tag-gray'}`}
          >
            {isDelayed ? `D+${Math.abs(daysLeft)}` : `D-${daysLeft}`}
          </span>
        )}
        {t.notes && <span className="rpt-item-note" title={t.notes}>📋</span>}
      </div>
    );
  });
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

/* ─── KPI 블록 렌더링 ─── */
function renderKpiBlock(
  kpis: Kpi[],
  kpiNotes?: Record<string, string>,
  onNoteChange?: (kpiId: string, note: string) => void,
  onHide?: (kpiId: string) => void,
) {
  if (kpis.length === 0) {
    return <div className="rpt-empty">해당 없음</div>;
  }
  return (
    <div className="rpt-list">
      {kpis.map((kpi) => (
        <div key={kpi.kpiId} className="rpt-item-with-note">
          <div className="rpt-item">
            <span className="rpt-item-title">{kpi.title}</span>
            <div className="rpt-progress">
              <div className="rpt-progress-bar">
                <div className="rpt-progress-fill" style={{ width: `${kpi.achievementRate}%` }} />
              </div>
              <span className="rpt-progress-text">
                {kpi.currentValue}/{kpi.targetValue} {kpi.unit} ({kpi.achievementRate}%)
              </span>
            </div>
            <span
              className={`rpt-item-tag ${
                kpi.status === '달성'
                  ? 'rpt-tag-green'
                  : kpi.status === '진행중'
                    ? 'rpt-tag-orange'
                    : 'rpt-tag-red'
              }`}
            >
              {kpi.status}
            </span>
            {onHide && (
              <button
                type="button"
                className="rpt-hide-btn"
                onClick={() => onHide(kpi.kpiId)}
                title="회의록에서 이 KPI 숨기기"
                style={{ marginLeft: 'auto' }}
              >
                ×
              </button>
            )}
          </div>
          {onNoteChange && (
            <textarea
              className="rpt-row-note"
              placeholder="비고 (달성/미달 사유, 후속 계획 등)"
              value={kpiNotes?.[kpi.kpiId] || ''}
              onChange={(e) => onNoteChange(kpi.kpiId, e.target.value)}
              rows={1}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── 메인 컴포넌트 ─── */
interface Props {
  ceoMeetingDates?: string[];
}

export default function MeetingReportPanel({ ceoMeetingDates = [] }: Props) {
  const { user } = useAuth();
  const [reportType, setReportType] = useState<MeetingType>('주간');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [allKpis, setAllKpis] = useState<Kpi[]>([]);
  const [generated, setGenerated] = useState(false);

  /* ─── 회의록 입력 ─── */
  const [meetingDate, setMeetingDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [attendeesText, setAttendeesText] = useState('');
  const [meetingNotes, setMeetingNotes] = useState('');
  const [decisions, setDecisions] = useState<string[]>([]);
  const [decisionInput, setDecisionInput] = useState('');
  const [nextActions, setNextActions] = useState<string[]>([]);
  const [nextActionInput, setNextActionInput] = useState('');
  const [extraAgenda, setExtraAgenda] = useState<MeetingTaskSnapshot[]>([]);
  const [extraTitle, setExtraTitle] = useState('');
  const [extraAssignee, setExtraAssignee] = useState('');
  const [extraMemo, setExtraMemo] = useState('');

  // 업무/KPI 비고 (회의 중 입력)
  const [taskNotes, setTaskNotes] = useState<Record<string, string>>({});
  const [kpiNotes, setKpiNotes] = useState<Record<string, string>>({});

  const updateTaskNote = useCallback((taskId: string, note: string) => {
    setTaskNotes((prev) => ({ ...prev, [taskId]: note }));
  }, []);
  const updateKpiNote = useCallback((kpiId: string, note: string) => {
    setKpiNotes((prev) => ({ ...prev, [kpiId]: note }));
  }, []);

  // 회의록에서 숨긴 업무/KPI ID
  const [hiddenTaskIds, setHiddenTaskIds] = useState<Set<string>>(new Set());
  const [hiddenKpiIds, setHiddenKpiIds] = useState<Set<string>>(new Set());

  const hideTask = useCallback((taskId: string) => {
    setHiddenTaskIds((prev) => {
      const s = new Set(prev);
      s.add(taskId);
      return s;
    });
  }, []);
  const hideKpi = useCallback((kpiId: string) => {
    setHiddenKpiIds((prev) => {
      const s = new Set(prev);
      s.add(kpiId);
      return s;
    });
  }, []);
  const restoreAllTasks = useCallback(() => setHiddenTaskIds(new Set()), []);
  const restoreAllKpis = useCallback(() => setHiddenKpiIds(new Set()), []);

  /* ─── 저장된 회의록 ─── */
  const [savedLogs, setSavedLogs] = useState<MeetingLogRecord[]>([]);
  const [showLogList, setShowLogList] = useState(false);
  const [viewingLog, setViewingLog] = useState<MeetingLogRecord | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = subscribeMeetingLogs(
      (records) => setSavedLogs(records),
      (err) => console.error('회의록 구독 실패:', err),
    );
    return () => unsub();
  }, []);

  const resetMeetingForm = useCallback(() => {
    setMeetingDate(format(new Date(), 'yyyy-MM-dd'));
    setAttendeesText('');
    setMeetingNotes('');
    setDecisions([]);
    setDecisionInput('');
    setNextActions([]);
    setNextActionInput('');
    setExtraAgenda([]);
    setExtraTitle('');
    setExtraAssignee('');
    setExtraMemo('');
    setTaskNotes({});
    setKpiNotes({});
    setHiddenTaskIds(new Set());
    setHiddenKpiIds(new Set());
    setEditingLogId(null);
  }, []);

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

  /* ─── 탭 변경 시 기간 자동 설정 (저장된 회의록 편집 중이면 스킵) ─── */
  useEffect(() => {
    if (editingLogId) return; // 불러온 회의록 편집 중에는 기간/generated 덮어쓰지 않음
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
  }, [reportType, biweeklyPeriod, monthlyPeriod, editingLogId]);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasks, kpis] = await Promise.all([fetchAllTasks(), fetchAllKpis()]);
      setAllTasks(tasks);
      setAllKpis(kpis);
      setGenerated(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '리포트 생성에 실패했습니다.');
    } finally {
      setLoading(false);
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
      return t.ceoFlag || t.status === '보류';
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
      return (t.ceoFlag || t.status === '보류') && isHidden(t);
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
    return incompleteTasks.filter((t) => t.ceoFlag);
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
        text += `  - ${t.title} (${t.assigneeName || ''}) - ${t.ceoFlagReason}\n`;
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
            notes: t.notes || '',
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
        ceoFlagReason: t.ceoFlagReason || '',
        notes: t.notes || '',
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

  /* ─── 회의록 저장 ─── */
  const taskToSnapshot = useCallback((t: Task, mode: 'completed' | 'inProgress' | 'upcoming' | 'delayed' | 'ceo'): MeetingTaskSnapshot => {
    const dd = tsToDate(t.dueDate);
    const cd = tsToDate(t.completedDate);
    return {
      taskId: t.taskId,
      title: t.title,
      assigneeName: t.assigneeName || '미배정',
      category: t.category || '기타',
      status: t.status,
      progressRate: t.progressRate || 0,
      dueDate: dd ? format(dd, 'yyyy.MM.dd') : '',
      completedDate: cd ? format(cd, 'yyyy.MM.dd') : '',
      memo: t.memo || '',
      notes: mode === 'ceo' ? (t.ceoFlagReason || t.notes || '') : (t.notes || ''),
      meetingNote: taskNotes[t.taskId] || '',
    };
  }, [taskNotes]);

  const currentSnapshotSets = useMemo(() => {
    let completed: Task[] = [];
    let inProgress: Task[] = [];
    let upcoming: Task[] = [];
    let delayed: Task[] = [];
    let ceo: Task[] = [];

    if (reportType === '주간' && weeklyData) {
      completed = weeklyData.completed;
      inProgress = weeklyData.incomplete;
      upcoming = weeklyData.nextWeek;
      delayed = weeklyData.delayed;
    } else if (reportType === '격주' && biweeklyData) {
      completed = biweeklyData.planCompleted;
      inProgress = biweeklyData.planInProgress;
      upcoming = biweeklyData.upcoming;
      delayed = biweeklyData.planRemaining;
      ceo = biweeklyData.ceoDecision;
    } else if (reportType === '월간' && monthlyData) {
      completed = monthlyData.completed;
      inProgress = monthlyData.nextMonthTasks;
      upcoming = monthlyData.nextMonthTasks;
      delayed = monthlyData.carryover;
    }

    return { completed, inProgress, upcoming, delayed, ceo };
  }, [reportType, weeklyData, biweeklyData, monthlyData]);

  const addDecision = () => {
    const v = decisionInput.trim();
    if (!v) return;
    setDecisions([...decisions, v]);
    setDecisionInput('');
  };

  const addNextAction = () => {
    const v = nextActionInput.trim();
    if (!v) return;
    setNextActions([...nextActions, v]);
    setNextActionInput('');
  };

  const addExtraAgenda = () => {
    const title = extraTitle.trim();
    if (!title) return;
    setExtraAgenda([
      ...extraAgenda,
      {
        title,
        assigneeName: extraAssignee.trim() || '미배정',
        memo: extraMemo.trim(),
        isManual: true,
      },
    ]);
    setExtraTitle('');
    setExtraAssignee('');
    setExtraMemo('');
  };

  const handleSaveMeetingLog = async () => {
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!generated) {
      alert('먼저 리포트를 생성해주세요.');
      return;
    }
    setSaving(true);
    try {
      const input: MeetingLogInput = {
        meetingType: reportType,
        periodLabel,
        periodStart: startDate,
        periodEnd: endDate,
        meetingDate,
        stats,
        completedTasks: currentSnapshotSets.completed.map((t) => taskToSnapshot(t, 'completed')),
        inProgressTasks: currentSnapshotSets.inProgress.map((t) => taskToSnapshot(t, 'inProgress')),
        upcomingTasks: currentSnapshotSets.upcoming.map((t) => taskToSnapshot(t, 'upcoming')),
        delayedTasks: currentSnapshotSets.delayed.map((t) => taskToSnapshot(t, 'delayed')),
        ceoItems: currentSnapshotSets.ceo.map((t) => taskToSnapshot(t, 'ceo')),
        attendees: attendeesText.split(',').map((s) => s.trim()).filter(Boolean),
        notes: meetingNotes,
        decisions,
        nextActions,
        extraAgenda,
        kpiNotes: Object.fromEntries(Object.entries(kpiNotes).filter(([id]) => !hiddenKpiIds.has(id))),
        hiddenTaskIds: Array.from(hiddenTaskIds),
        hiddenKpiIds: Array.from(hiddenKpiIds),
        createdBy: user.uid,
        createdByName: user.displayName || user.email || '',
      };

      if (editingLogId) {
        await updateMeetingLog(editingLogId, input, user.uid, user.displayName || user.email || '');
        alert('회의록이 수정되었습니다.');
      } else {
        await saveMeetingLog(input);
        alert('회의록이 저장되었습니다.');
        resetMeetingForm();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '회의록 저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadLog = async (log: MeetingLogRecord) => {
    // 먼저 editingLogId 세팅 (useEffect가 기간 덮어쓰는 것 방지)
    setEditingLogId(log.id);
    setReportType(log.meetingType);
    setMeetingDate(log.meetingDate);
    setStartDate(log.periodStart);
    setEndDate(log.periodEnd);
    setAttendeesText(log.attendees.join(', '));
    setMeetingNotes(log.notes || '');
    setDecisions(log.decisions || []);
    setNextActions(log.nextActions || []);
    setExtraAgenda(log.extraAgenda || []);

    // 2주 보고서인 경우 selectedCeoDate 복원 (biweeklyPeriod 재계산 방지)
    if (log.meetingType === '격주') {
      const candidate = log.periodEnd; // 미팅일 = periodEnd (±14일)
      if (candidate) setSelectedCeoDate(candidate);
    }
    if (log.meetingType === '월간') {
      setSelectedMonth(log.periodStart.slice(0, 7));
    }

    // 업무/KPI 비고 복원
    const restoredTaskNotes: Record<string, string> = {};
    [log.completedTasks, log.inProgressTasks, log.upcomingTasks, log.delayedTasks, log.ceoItems].forEach((list) => {
      (list || []).forEach((t) => {
        if (t.taskId && t.meetingNote) restoredTaskNotes[t.taskId] = t.meetingNote;
      });
    });
    setTaskNotes(restoredTaskNotes);
    setKpiNotes(log.kpiNotes || {});
    setHiddenTaskIds(new Set(log.hiddenTaskIds || []));
    setHiddenKpiIds(new Set(log.hiddenKpiIds || []));

    setViewingLog(null);
    setShowLogList(false);

    // 리포트 자동 재생성 (현재 Firestore 업무 데이터 + 저장된 비고)
    await handleGenerate();
  };

  const handleDeleteLog = async (log: MeetingLogRecord) => {
    if (!window.confirm(`"${log.periodLabel}" 회의록을 삭제하시겠습니까?`)) return;
    try {
      await deleteMeetingLog(log.id);
      if (editingLogId === log.id) resetMeetingForm();
      if (viewingLog?.id === log.id) setViewingLog(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '삭제 실패');
    }
  };

  /* ─── 주간 리포트 렌더 ─── */
  const renderWeeklyReport = () => {
    if (!weeklyData) return null;
    const { completed, incomplete, nextWeek, delayed } = weeklyData;

    // 담당자별 KPI 그룹 (숨긴 KPI 제외)
    const visibleKpisWeekly = allKpis.filter((k) => !hiddenKpiIds.has(k.kpiId));
    const kpiHiddenCount = allKpis.length - visibleKpisWeekly.length;
    const kpiByAssignee: Record<string, Kpi[]> = {};
    visibleKpisWeekly.forEach((k) => {
      const name = k.assigneeName || '미배정';
      if (!kpiByAssignee[name]) kpiByAssignee[name] = [];
      kpiByAssignee[name].push(k);
    });

    return (
      <>
        <Block title="이번 주 완료 업무" count={completed.length} dotColor="green" defaultOpen>
          {renderAssigneeCategoryBlocks(completed, (tasks) => renderCompletedList(tasks))}
          <LeadTimeSummary tasks={completed} />
        </Block>

        <Block title="이번 주 미완료 업무" count={incomplete.length} dotColor="red" danger defaultOpen>
          {incomplete.length === 0 ? <div className="rpt-empty">해당 없음</div> : (
            <div className="rpt-list">
              {incomplete.map((t) => {
                const dd = tsToDate(t.dueDate);
                const delayDays = dd ? Math.abs(differenceInDays(dd, new Date())) : 0;
                return (
                  <div key={t.taskId} className="rpt-item rpt-item-delayed">
                    <span className="rpt-item-title">{t.title}</span>
                    <span className="rpt-item-assignee">{t.assigneeName}</span>
                    <span className="rpt-item-tag rpt-tag-red">{delayDays}일 지연</span>
                    {t.notes && <span className="rpt-item-note" title={t.notes}>📋</span>}
                  </div>
                );
              })}
            </div>
          )}
        </Block>

        <Block title="차주 진행 예정" count={nextWeek.length} dotColor="blue" defaultOpen={false}>
          {renderAssigneeCategoryBlocks(sortByPriority(nextWeek), (tasks) => renderTaskList(tasks))}
        </Block>

        <Block title="차주 이월 업무" count={delayed.length} dotColor="red" danger defaultOpen>
          {delayed.length === 0 ? <div className="rpt-empty">해당 없음</div> : (
            <div className="rpt-list">
              {delayed.map((t) => {
                const dd = tsToDate(t.dueDate);
                const delayDays = dd ? Math.abs(differenceInDays(dd, new Date())) : 0;
                return (
                  <div key={t.taskId} className="rpt-item rpt-item-delayed">
                    <span className="rpt-item-title">{t.title}</span>
                    <span className="rpt-item-assignee">{t.assigneeName}</span>
                    <span className="rpt-item-tag rpt-tag-red">{delayDays}일 지연</span>
                    {t.notes && <span className="rpt-item-note" title={t.notes}>📋</span>}
                  </div>
                );
              })}
            </div>
          )}
        </Block>

        <Block title="KPI 진행 현황" count={visibleKpisWeekly.length} dotColor="yellow" defaultOpen>
          {kpiHiddenCount > 0 && (
            <div className="rpt-hidden-bar">
              <span>숨긴 KPI {kpiHiddenCount}개</span>
              <button type="button" className="rpt-restore-btn" onClick={restoreAllKpis}>
                모두 복원
              </button>
            </div>
          )}
          {Object.keys(kpiByAssignee).length === 0 ? <div className="rpt-empty">해당 없음</div> :
            Object.entries(kpiByAssignee).map(([name, kpis]) => (
              <div key={name} className="rpt-cat-group">
                <div className="rpt-cat-label">{name} <span className="rpt-cat-cnt">{kpis.length}</span></div>
                {renderKpiBlock(kpis, kpiNotes, updateKpiNote, hideKpi)}
              </div>
            ))
          }
        </Block>
      </>
    );
  };

  /* ─── 격주(CEO) 리포트 렌더 ─── */
  const renderBiweeklyReport = () => {
    if (!biweeklyData) return null;
    const { planned, planCompleted, planInProgress, planRemaining, upcoming, ceoDecision } = biweeklyData;

    // 담당자별 KPI 그룹 (숨긴 KPI 제외)
    const visibleKpisBi = allKpis.filter((k) => !hiddenKpiIds.has(k.kpiId));
    const kpiHiddenCountBi = allKpis.length - visibleKpisBi.length;
    const kpiByAssignee: Record<string, Kpi[]> = {};
    visibleKpisBi.forEach((k) => {
      const name = k.assigneeName || '미배정';
      if (!kpiByAssignee[name]) kpiByAssignee[name] = [];
      kpiByAssignee[name].push(k);
    });

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
      if (t.memo) parts.push(t.memo);
      else if (t.notes) parts.push(t.notes);
      else if (t.status === '보류') parts.push('보류 중');
      else if (t.status === '지연') parts.push('마감 초과');
      return parts.length > 0 ? parts.join(' · ') : null;
    };

    return (
      <>
        {/* ── 지난 2주: 담당자별 계획 vs 결과 비교 + 비고 ── */}
        <Block
          title="지난 2주 업무 현황"
          count={planned.length}
          dotColor="green"
          defaultOpen
        >
          {biweeklyHiddenCounts.planned > 0 && (
            <div className="rpt-hidden-bar">
              <span>이 섹션에서 숨긴 업무 {biweeklyHiddenCounts.planned}건</span>
              <button type="button" className="rpt-restore-btn" onClick={restoreAllTasks}>
                모두 복원
              </button>
            </div>
          )}
          {planned.length === 0 ? (
            <div className="rpt-empty">해당 기간 계획된 업무 없음</div>
          ) : (
            <>
              {/* 요약 바 */}
              <div className="rpt-compare-summary">
                <span className="rpt-compare-stat rpt-compare-stat-done">완료 {planCompleted.length}</span>
                <span className="rpt-compare-stat rpt-compare-stat-prog">진행중 {planInProgress.length}</span>
                <span className="rpt-compare-stat rpt-compare-stat-left">미완료 {planRemaining.length}</span>
              </div>

              {/* 담당자별 계획/결과/비고 */}
              {(() => {
                const byAssignee = groupByAssignee(planned);
                byAssignee.sort((a, b) => b.tasks.length - a.tasks.length);
                return byAssignee.map((ag) => (
                  <div key={ag.assignee} className="rpt-assignee-group">
                    <div className="rpt-assignee-header">
                      <span className="rpt-assignee-name">{ag.assignee}</span>
                      <span className="rpt-assignee-cnt">{ag.tasks.length}건</span>
                    </div>
                    <div className="rpt-compare-table rpt-compare-table-3col">
                      <div className="rpt-compare-header">
                        <div className="rpt-compare-col-plan">계획</div>
                        <div className="rpt-compare-col-result">결과</div>
                        <div className="rpt-compare-col-note">비고</div>
                      </div>
                      {ag.tasks.map((t) => {
                        const detail = statusDetail(t);
                        return (
                          <div key={t.taskId} className={`rpt-compare-row ${t.status === '완료' ? 'rpt-compare-row-done' : t.status === '지연' || t.status === '보류' ? 'rpt-compare-row-warn' : ''}`}>
                            <div className="rpt-compare-col-plan">
                              <span className="rpt-compare-title">{t.title}</span>
                              <span className="rpt-compare-assignee">{t.category || '기타'}</span>
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
                    </div>
                  </div>
                ));
              })()}
              <LeadTimeSummary tasks={planCompleted} />
            </>
          )}
        </Block>

        {/* ── 앞으로 2주 진행 업무 (담당자별 + 비고) ── */}
        <Block title="앞으로 2주 진행 업무" count={upcoming.length} dotColor="blue" defaultOpen>
          {(() => {
            const sorted = [...upcoming].sort((a, b) => {
              const da = tsToDate(a.dueDate)?.getTime() ?? Infinity;
              const db = tsToDate(b.dueDate)?.getTime() ?? Infinity;
              return da - db;
            });
            const renderFn = (tasks: Task[]) => tasks.map((t) => {
              const dd = tsToDate(t.dueDate);
              return (
                <div key={t.taskId} className="rpt-item-with-note">
                  <div className="rpt-item">
                    <span className="rpt-item-title">{t.title}</span>
                    {dd && <span className="rpt-item-date">{format(dd, 'M.dd')}</span>}
                  </div>
                  {t.memo && <div style={{ fontSize: 11, color: '#888', marginLeft: 12, marginTop: 1 }}>└ {t.memo}</div>}
                  <textarea
                    className="rpt-row-note"
                    placeholder="비고"
                    value={taskNotes[t.taskId] || ''}
                    onChange={(e) => updateTaskNote(t.taskId, e.target.value)}
                    rows={1}
                  />
                </div>
              );
            });
            return renderAssigneeCategoryBlocks(sorted, renderFn);
          })()}
        </Block>

        <Block title="결정 필요 사항" count={ceoDecision.length} dotColor="yellow" defaultOpen>
          {biweeklyHiddenCounts.ceoDecision > 0 && (
            <div className="rpt-hidden-bar">
              <span>숨긴 항목 {biweeklyHiddenCounts.ceoDecision}건</span>
              <button type="button" className="rpt-restore-btn" onClick={restoreAllTasks}>
                모두 복원
              </button>
            </div>
          )}
          {ceoDecision.length === 0 ? (
            <div className="rpt-empty">해당 없음</div>
          ) : (
            <div className="rpt-list">
              {ceoDecision.map((t) => (
                <div key={t.taskId} className="rpt-item-with-action">
                  <div className="rpt-item" style={{ flex: 1 }}>
                    <span className="rpt-item-title">{t.title}</span>
                    <span className="rpt-item-assignee">{t.assigneeName}</span>
                    <span className="rpt-item-reason">{t.ceoFlagReason || t.notes || (t.status === '보류' ? '보류 중' : '')}</span>
                  </div>
                  <button
                    type="button"
                    className="rpt-hide-btn"
                    onClick={() => hideTask(t.taskId)}
                    title="회의록에서 이 항목 숨기기"
                  >
                    ×
                  </button>
                  {t.memo && <div style={{ fontSize: 11, color: '#888', marginLeft: 12, marginTop: 1, flexBasis: '100%' }}>└ {t.memo}</div>}
                </div>
              ))}
            </div>
          )}
        </Block>

        <Block title="KPI 달성 현황" count={visibleKpisBi.length} dotColor="yellow" defaultOpen>
          {kpiHiddenCountBi > 0 && (
            <div className="rpt-hidden-bar">
              <span>숨긴 KPI {kpiHiddenCountBi}개</span>
              <button type="button" className="rpt-restore-btn" onClick={restoreAllKpis}>
                모두 복원
              </button>
            </div>
          )}
          {Object.keys(kpiByAssignee).length === 0 ? <div className="rpt-empty">해당 없음</div> :
            Object.entries(kpiByAssignee).map(([name, kpis]) => (
              <div key={name} className="rpt-cat-group">
                <div className="rpt-cat-label">{name} <span className="rpt-cat-cnt">{kpis.length}</span></div>
                {renderKpiBlock(kpis, kpiNotes, updateKpiNote, hideKpi)}
              </div>
            ))
          }
        </Block>
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
                  <span className="rpt-item-reason">{t.notes || '사유 미입력'}</span>
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
              className="tm-btn-obsidian"
              onClick={handleSaveToObsidian}
              disabled={savingObsidian}
            >
              {savingObsidian ? '저장 중...' : 'Obsidian 저장'}
            </button>
          </>
        )}
        <button
          className="tm-btn-log-list"
          onClick={() => setShowLogList(true)}
          style={{ marginLeft: 'auto' }}
        >
          📂 저장된 회의록 ({savedLogs.length})
        </button>
      </div>

      {error && <div className="tm-error">{error}</div>}

      {generated && (
        <div className="tm-report-content">
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

          {/* ── 회의록 작성/편집 ── */}
          <div className="rpt-log-form">
            <div className="rpt-log-form-header">
              <h3>📝 회의록 {editingLogId ? '수정' : '작성'}</h3>
              {editingLogId && (
                <button
                  className="rpt-log-form-new"
                  onClick={resetMeetingForm}
                  type="button"
                >
                  새 회의록 작성
                </button>
              )}
            </div>

            <div className="rpt-log-row">
              <label className="rpt-log-label">회의일</label>
              <input
                type="date"
                className="rpt-log-input"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
              />
            </div>

            <div className="rpt-log-row">
              <label className="rpt-log-label">참석자</label>
              <input
                type="text"
                className="rpt-log-input"
                placeholder="쉼표로 구분 (예: 최선아, 송은정, 이웅해)"
                value={attendeesText}
                onChange={(e) => setAttendeesText(e.target.value)}
              />
            </div>

            <div className="rpt-log-row rpt-log-row-col">
              <label className="rpt-log-label">회의 메모</label>
              <textarea
                className="rpt-log-textarea"
                placeholder="회의 중 논의 내용, 배경, 맥락 등"
                value={meetingNotes}
                onChange={(e) => setMeetingNotes(e.target.value)}
                rows={4}
              />
            </div>

            {/* 결정사항 */}
            <div className="rpt-log-row rpt-log-row-col">
              <label className="rpt-log-label">결정사항</label>
              <div className="rpt-log-chip-input">
                <input
                  type="text"
                  className="rpt-log-input"
                  placeholder="엔터로 추가"
                  value={decisionInput}
                  onChange={(e) => setDecisionInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addDecision();
                    }
                  }}
                />
                <button type="button" className="rpt-log-add-btn" onClick={addDecision}>+</button>
              </div>
              {decisions.length > 0 && (
                <ul className="rpt-log-chip-list">
                  {decisions.map((d, i) => (
                    <li key={i}>
                      <span>{d}</span>
                      <button
                        type="button"
                        className="rpt-log-chip-remove"
                        onClick={() => setDecisions(decisions.filter((_, idx) => idx !== i))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 후속 조치 */}
            <div className="rpt-log-row rpt-log-row-col">
              <label className="rpt-log-label">후속 조치</label>
              <div className="rpt-log-chip-input">
                <input
                  type="text"
                  className="rpt-log-input"
                  placeholder="엔터로 추가"
                  value={nextActionInput}
                  onChange={(e) => setNextActionInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addNextAction();
                    }
                  }}
                />
                <button type="button" className="rpt-log-add-btn" onClick={addNextAction}>+</button>
              </div>
              {nextActions.length > 0 && (
                <ul className="rpt-log-chip-list">
                  {nextActions.map((d, i) => (
                    <li key={i}>
                      <span>{d}</span>
                      <button
                        type="button"
                        className="rpt-log-chip-remove"
                        onClick={() => setNextActions(nextActions.filter((_, idx) => idx !== i))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 추가 안건 (회의 중 새 업무/이슈) */}
            <div className="rpt-log-row rpt-log-row-col">
              <label className="rpt-log-label">추가 안건/업무</label>
              <div className="rpt-log-agenda-input">
                <input
                  type="text"
                  className="rpt-log-input"
                  placeholder="제목"
                  value={extraTitle}
                  onChange={(e) => setExtraTitle(e.target.value)}
                  style={{ flex: 2 }}
                />
                <input
                  type="text"
                  className="rpt-log-input"
                  placeholder="담당자"
                  value={extraAssignee}
                  onChange={(e) => setExtraAssignee(e.target.value)}
                  style={{ flex: 1 }}
                />
                <input
                  type="text"
                  className="rpt-log-input"
                  placeholder="메모"
                  value={extraMemo}
                  onChange={(e) => setExtraMemo(e.target.value)}
                  style={{ flex: 2 }}
                />
                <button type="button" className="rpt-log-add-btn" onClick={addExtraAgenda}>+</button>
              </div>
              {extraAgenda.length > 0 && (
                <ul className="rpt-log-chip-list">
                  {extraAgenda.map((a, i) => (
                    <li key={i}>
                      <span>
                        <strong>{a.title}</strong>
                        {a.assigneeName && a.assigneeName !== '미배정' && <span style={{ marginLeft: 6, color: '#666' }}>· {a.assigneeName}</span>}
                        {a.memo && <span style={{ marginLeft: 6, color: '#888' }}>· {a.memo}</span>}
                      </span>
                      <button
                        type="button"
                        className="rpt-log-chip-remove"
                        onClick={() => setExtraAgenda(extraAgenda.filter((_, idx) => idx !== i))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rpt-log-actions">
              <button
                className="rpt-log-save-btn"
                onClick={handleSaveMeetingLog}
                disabled={saving}
                type="button"
              >
                {saving ? '저장 중...' : editingLogId ? '회의록 수정' : '회의록 저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!generated && !loading && (
        <div className="tm-loading" style={{ height: 300 }}>
          기간을 설정하고 "리포트 생성" 버튼을 눌러주세요.
        </div>
      )}

      {/* ── 저장된 회의록 목록 모달 ── */}
      {showLogList && (
        <div className="rpt-modal-backdrop" onClick={() => setShowLogList(false)}>
          <div className="rpt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rpt-modal-header">
              <h3>저장된 회의록 ({savedLogs.length})</h3>
              <button className="rpt-modal-close" onClick={() => setShowLogList(false)}>×</button>
            </div>
            <div className="rpt-modal-body">
              {savedLogs.length === 0 ? (
                <div className="rpt-empty">저장된 회의록이 없습니다.</div>
              ) : (
                <ul className="rpt-log-list">
                  {savedLogs.map((log) => (
                    <li key={log.id} className="rpt-log-list-item">
                      <div className="rpt-log-list-main" onClick={() => setViewingLog(log)}>
                        <div className="rpt-log-list-type">
                          <span className={`rpt-log-type-badge rpt-log-type-${log.meetingType}`}>
                            {log.meetingType}
                          </span>
                          <span className="rpt-log-list-date">{log.meetingDate}</span>
                        </div>
                        <div className="rpt-log-list-title">{log.periodLabel}</div>
                        <div className="rpt-log-list-meta">
                          {log.attendees.length > 0 && <span>참석 {log.attendees.length}명</span>}
                          <span>완료 {log.stats.completed}</span>
                          <span>진행 {log.stats.incomplete}</span>
                          {log.decisions.length > 0 && <span>결정사항 {log.decisions.length}</span>}
                          {log.nextActions.length > 0 && <span>후속조치 {log.nextActions.length}</span>}
                          <span style={{ marginLeft: 'auto', color: '#999' }}>{log.createdByName}</span>
                        </div>
                      </div>
                      <div className="rpt-log-list-actions">
                        <button
                          type="button"
                          className="rpt-log-list-btn"
                          onClick={() => handleLoadLog(log)}
                        >
                          불러오기
                        </button>
                        <button
                          type="button"
                          className="rpt-log-list-btn rpt-log-list-btn-danger"
                          onClick={() => handleDeleteLog(log)}
                        >
                          삭제
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 회의록 상세 조회 모달 ── */}
      {viewingLog && (
        <div className="rpt-modal-backdrop" onClick={() => setViewingLog(null)}>
          <div className="rpt-modal rpt-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="rpt-modal-header">
              <h3>
                <span className={`rpt-log-type-badge rpt-log-type-${viewingLog.meetingType}`}>
                  {viewingLog.meetingType}
                </span>
                {' '}{viewingLog.periodLabel}
              </h3>
              <button className="rpt-modal-close" onClick={() => setViewingLog(null)}>×</button>
            </div>
            <div className="rpt-modal-body">
              <div className="rpt-log-view-meta">
                <div><strong>회의일</strong> {viewingLog.meetingDate}</div>
                <div><strong>참석자</strong> {viewingLog.attendees.join(', ') || '-'}</div>
                <div><strong>작성자</strong> {viewingLog.createdByName}</div>
              </div>

              {viewingLog.notes && (
                <section className="rpt-log-view-section">
                  <h4>회의 메모</h4>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{viewingLog.notes}</p>
                </section>
              )}

              {viewingLog.decisions.length > 0 && (
                <section className="rpt-log-view-section">
                  <h4>결정사항</h4>
                  <ul>
                    {viewingLog.decisions.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </section>
              )}

              {viewingLog.nextActions.length > 0 && (
                <section className="rpt-log-view-section">
                  <h4>후속 조치</h4>
                  <ul>
                    {viewingLog.nextActions.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </section>
              )}

              {viewingLog.extraAgenda.length > 0 && (
                <section className="rpt-log-view-section">
                  <h4>추가 안건</h4>
                  <ul>
                    {viewingLog.extraAgenda.map((a, i) => (
                      <li key={i}>
                        <strong>{a.title}</strong>
                        {a.assigneeName && a.assigneeName !== '미배정' && <span style={{ marginLeft: 6, color: '#666' }}>· {a.assigneeName}</span>}
                        {a.memo && <div style={{ marginLeft: 12, color: '#666', fontSize: 12 }}>{a.memo}</div>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* 업무 스냅샷: 격주는 계획/결과/비고 3열, 그 외는 상태/제목/비고 2열 */}
              {viewingLog.meetingType === '격주' ? (
                <>
                  {(viewingLog.completedTasks.length + viewingLog.inProgressTasks.length + viewingLog.delayedTasks.length) > 0 && (
                    <section className="rpt-log-view-section">
                      <h4>지난 2주 업무 현황 ({viewingLog.completedTasks.length + viewingLog.inProgressTasks.length + viewingLog.delayedTasks.length})</h4>
                      {renderSnapshotPlanResult([
                        ...viewingLog.completedTasks,
                        ...viewingLog.inProgressTasks,
                        ...viewingLog.delayedTasks,
                      ])}
                    </section>
                  )}

                  {viewingLog.upcomingTasks.length > 0 && (
                    <section className="rpt-log-view-section">
                      <h4>앞으로 2주 진행 업무 ({viewingLog.upcomingTasks.length})</h4>
                      {renderSnapshotTitleNote(viewingLog.upcomingTasks)}
                    </section>
                  )}

                  {viewingLog.ceoItems.length > 0 && (
                    <section className="rpt-log-view-section">
                      <h4>결정 필요 ({viewingLog.ceoItems.length})</h4>
                      {renderSnapshotTitleNote(viewingLog.ceoItems)}
                    </section>
                  )}
                </>
              ) : (
                <>
                  {viewingLog.completedTasks.length > 0 && (
                    <section className="rpt-log-view-section">
                      <h4>완료 업무 ({viewingLog.completedTasks.length})</h4>
                      {renderSnapshotTitleNote(viewingLog.completedTasks)}
                    </section>
                  )}

                  {viewingLog.inProgressTasks.length > 0 && (
                    <section className="rpt-log-view-section">
                      <h4>진행/미완료 업무 ({viewingLog.inProgressTasks.length})</h4>
                      {renderSnapshotTitleNote(viewingLog.inProgressTasks)}
                    </section>
                  )}

                  {viewingLog.upcomingTasks.length > 0 && (
                    <section className="rpt-log-view-section">
                      <h4>예정 업무 ({viewingLog.upcomingTasks.length})</h4>
                      {renderSnapshotTitleNote(viewingLog.upcomingTasks)}
                    </section>
                  )}

                  {viewingLog.delayedTasks.length > 0 && (
                    <section className="rpt-log-view-section">
                      <h4>지연/이월 업무 ({viewingLog.delayedTasks.length})</h4>
                      {renderSnapshotTitleNote(viewingLog.delayedTasks)}
                    </section>
                  )}

                  {viewingLog.ceoItems.length > 0 && (
                    <section className="rpt-log-view-section">
                      <h4>결정 필요 ({viewingLog.ceoItems.length})</h4>
                      {renderSnapshotTitleNote(viewingLog.ceoItems)}
                    </section>
                  )}
                </>
              )}

              {viewingLog.kpiNotes && Object.keys(viewingLog.kpiNotes).length > 0 && (
                <section className="rpt-log-view-section">
                  <h4>KPI 비고</h4>
                  <ul>
                    {Object.entries(viewingLog.kpiNotes).map(([kpiId, note]) => (
                      note ? <li key={kpiId}>{note}</li> : null
                    ))}
                  </ul>
                </section>
              )}
            </div>
            <div className="rpt-modal-footer">
              <button className="rpt-log-list-btn" onClick={() => handleLoadLog(viewingLog)}>
                편집용으로 불러오기
              </button>
              <button className="rpt-log-list-btn rpt-log-list-btn-danger" onClick={() => handleDeleteLog(viewingLog)}>
                삭제
              </button>
              <button className="rpt-log-list-btn" onClick={() => setViewingLog(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── 담당자별 그룹 유틸 ─── */
function groupSnapshotByAssignee(tasks: MeetingTaskSnapshot[]): { assignee: string; list: MeetingTaskSnapshot[] }[] {
  const map: Record<string, MeetingTaskSnapshot[]> = {};
  tasks.forEach((t) => {
    const k = t.assigneeName || '미배정';
    if (!map[k]) map[k] = [];
    map[k].push(t);
  });
  return Object.entries(map)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([assignee, list]) => ({ assignee, list }));
}

function snapshotStatusBadge(t: MeetingTaskSnapshot) {
  const s = t.status || '';
  const color: Record<string, string> = {
    '완료': 'var(--c-green,#0d9f61)',
    '진행중': 'var(--c-accent,#2f6ce5)',
    '대기': 'var(--c-text-3,#888)',
    '지연': 'var(--c-red,#e53935)',
    '보류': 'var(--c-orange,#c26009)',
  };
  const bg: Record<string, string> = {
    '완료': 'var(--c-green-bg,#eaf5ef)',
    '진행중': 'var(--c-accent-light,#eef3fd)',
    '대기': 'var(--c-bg-sub,#f7f8fa)',
    '지연': 'var(--c-red-bg,#fdeeee)',
    '보류': '#fef1e1',
  };
  return (
    <span className="rpt-log-view-badge" style={{ color: color[s], background: bg[s] }}>
      {s === '완료' ? '✓ 완료' : s || '-'}
    </span>
  );
}

/* ─── 조회 모달: 격주 계획/결과/비고 3열 ─── */
function renderSnapshotPlanResult(tasks: MeetingTaskSnapshot[]) {
  const groups = groupSnapshotByAssignee(tasks);
  return groups.map(({ assignee, list }) => (
    <div key={assignee} className="rpt-assignee-group">
      <div className="rpt-assignee-header">
        <span className="rpt-assignee-name">{assignee}</span>
        <span className="rpt-assignee-cnt">{list.length}건</span>
      </div>
      <div className="rpt-compare-table rpt-compare-table-3col">
        <div className="rpt-compare-header">
          <div className="rpt-compare-col-plan">계획</div>
          <div className="rpt-compare-col-result">결과</div>
          <div className="rpt-compare-col-note">비고</div>
        </div>
        {list.map((t, i) => (
          <div key={i} className={`rpt-compare-row ${t.status === '완료' ? 'rpt-compare-row-done' : (t.status === '지연' || t.status === '보류') ? 'rpt-compare-row-warn' : ''}`}>
            <div className="rpt-compare-col-plan">
              <span className="rpt-compare-title">{t.title}</span>
              <span className="rpt-compare-assignee">{t.category || '기타'}</span>
            </div>
            <div className="rpt-compare-col-result">
              {snapshotStatusBadge(t)}
              {typeof t.progressRate === 'number' && t.progressRate > 0 && t.status !== '완료' && (
                <span style={{ fontSize: 11, color: 'var(--c-accent,#2f6ce5)' }}>{t.progressRate}%</span>
              )}
              {t.completedDate && <span style={{ fontSize: 11, color: 'var(--c-text-3,#888)' }}>{t.completedDate} 완료</span>}
              {t.memo && <div style={{ fontSize: 11, color: 'var(--c-text-2,#666)' }}>└ {t.memo}</div>}
            </div>
            <div className="rpt-compare-col-note">
              {t.meetingNote ? (
                <div className="rpt-log-view-note-box">{t.meetingNote}</div>
              ) : (
                <span style={{ color: 'var(--c-text-4,#bbb)', fontSize: 11 }}>—</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  ));
}

/* ─── 조회 모달: 업무 | 비고 2열 (주간/월간용) ─── */
function renderSnapshotTitleNote(tasks: MeetingTaskSnapshot[]) {
  const groups = groupSnapshotByAssignee(tasks);
  return groups.map(({ assignee, list }) => (
    <div key={assignee} className="rpt-assignee-group">
      <div className="rpt-assignee-header">
        <span className="rpt-assignee-name">{assignee}</span>
        <span className="rpt-assignee-cnt">{list.length}건</span>
      </div>
      <div className="rpt-compare-table rpt-compare-table-2col">
        <div className="rpt-compare-header">
          <div>업무</div>
          <div>비고</div>
        </div>
        {list.map((t, i) => (
          <div key={i} className="rpt-compare-row">
            <div className="rpt-compare-col-plan">
              <span className="rpt-compare-title">{t.title}</span>
              <span className="rpt-compare-assignee">
                {t.category || '기타'}
                {t.status && <span style={{ marginLeft: 6 }}>· {t.status}</span>}
                {t.dueDate && <span style={{ marginLeft: 6 }}>· {t.dueDate}</span>}
                {t.completedDate && <span style={{ marginLeft: 6, color: 'var(--c-green,#0d9f61)' }}>· {t.completedDate} 완료</span>}
              </span>
              {t.memo && <div style={{ fontSize: 11, color: 'var(--c-text-2,#666)' }}>└ {t.memo}</div>}
            </div>
            <div className="rpt-compare-col-note">
              {t.meetingNote ? (
                <div className="rpt-log-view-note-box">{t.meetingNote}</div>
              ) : (
                <span style={{ color: 'var(--c-text-4,#bbb)', fontSize: 11 }}>—</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  ));
}
