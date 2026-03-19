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

function renderCategoryBlocks(groups: CategoryGroup[], renderFn: (tasks: Task[]) => React.ReactNode) {
  if (groups.length === 0) {
    return <div className="rpt-empty">해당 없음</div>;
  }
  return groups.map((group) => (
    <div key={group.category} className="rpt-cat-group">
      <div className="rpt-cat-label">
        {group.category} <span className="rpt-cat-cnt">{group.tasks.length}</span>
      </div>
      <div className="rpt-list">{renderFn(group.tasks)}</div>
    </div>
  ));
}

function renderAssigneeBlocks(groups: AssigneeGroup[], renderFn: (tasks: Task[]) => React.ReactNode) {
  if (groups.length === 0) return <div className="rpt-empty">해당 없음</div>;
  return groups.map((g) => (
    <div key={g.assignee} className="rpt-cat-group">
      <div className="rpt-cat-label">{g.assignee} <span className="rpt-cat-cnt">{g.tasks.length}</span></div>
      <div className="rpt-list">{renderFn(g.tasks)}</div>
    </div>
  ));
}

/* ─── KPI 블록 렌더링 ─── */
function renderKpiBlock(kpis: Kpi[]) {
  if (kpis.length === 0) {
    return <div className="rpt-empty">해당 없음</div>;
  }
  return (
    <div className="rpt-list">
      {kpis.map((kpi) => (
        <div key={kpi.kpiId} className="rpt-item">
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
  const [reportType, setReportType] = useState<MeetingType>('주간');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [allKpis, setAllKpis] = useState<Kpi[]>([]);
  const [generated, setGenerated] = useState(false);

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
    const base = new Date(selectedMonth + '-01');
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
    const selected = new Date(selectedCeoDate);
    const prevDate = addDays(selected, -14);
    const nextDate = addDays(selected, 14);
    return {
      start: format(prevDate, 'yyyy-MM-dd'),
      end: format(nextDate, 'yyyy-MM-dd'),
      selected: selectedCeoDate,
    };
  }, [selectedCeoDate]);

  /* ─── 탭 변경 시 기간 자동 설정 ─── */
  useEffect(() => {
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

    // 1. 이번 주 완료 업무: completedAt이 이번 주
    const completed = reportTasks.filter((t) => {
      if (t.status !== '완료') return false;
      const cd = tsToDate(t.completedDate);
      return cd !== null && cd >= weekStart && cd <= weekEnd;
    });

    // 2. 이번 주 미완료 업무: 진행중이지만 이번 주 마감 넘긴 것
    const incomplete = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd >= weekStart && dd <= weekEnd && dd < today;
    });

    // 3. 차주 진행 예정: dueDate가 다음 주, 우선순위 순
    const nextWeek = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd >= nextWeekStart && dd <= nextWeekEnd;
    });

    // 4. 차주 이월 업무: 미완료 + dueDate < 오늘
    const delayed = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd < today;
    });

    return { completed, incomplete, nextWeek, delayed };
  }, [reportType, reportTasks]);

  /* ─── 격주(CEO) 리포트 데이터 ─── */
  const biweeklyData = useMemo(() => {
    if (reportType !== '격주' || !biweeklyPeriod) return null;
    const prevDate = new Date(biweeklyPeriod.start);
    const selectedDate = new Date(biweeklyPeriod.selected);
    selectedDate.setHours(23, 59, 59, 999);
    const nextDate = new Date(biweeklyPeriod.end);
    nextDate.setHours(23, 59, 59, 999);

    // 1. 2주간 완료 업무: 직전미팅일 ~ 선택일 사이 completedAt
    const completed = reportTasks.filter((t) => {
      if (t.status !== '완료') return false;
      const cd = tsToDate(t.completedDate);
      return cd !== null && cd >= prevDate && cd <= selectedDate;
    });

    // 2. 다음 2주 진행 예정: 선택일 ~ 다음미팅일 사이 dueDate
    const upcoming = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd > selectedDate && dd <= nextDate;
    });

    // 3. 결정 필요: ceoFlag === true or status === '보류'
    const ceoDecision = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      return t.ceoFlag || t.status === '보류';
    });

    return { completed, upcoming, ceoDecision };
  }, [reportType, reportTasks, biweeklyPeriod]);

  /* ─── 월간 리포트 데이터 ─── */
  const monthlyData = useMemo(() => {
    if (reportType !== '월간') return null;
    const rangeStart = new Date(monthlyPeriod.start);
    const rangeEnd = new Date(monthlyPeriod.end);
    rangeEnd.setHours(23, 59, 59, 999);
    const nextStart = new Date(monthlyPeriod.nextStart);
    const nextEnd = new Date(monthlyPeriod.nextEnd);
    nextEnd.setHours(23, 59, 59, 999);

    // 1. N월 완료 업무: completedAt이 선택월
    const completed = reportTasks.filter((t) => {
      if (t.status !== '완료') return false;
      const cd = tsToDate(t.completedDate);
      return cd !== null && cd >= rangeStart && cd <= rangeEnd;
    });

    // 2. N+1월 이월 업무: 선택월 미완료 (dueDate가 선택월 이내이지만 미완료)
    const carryover = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd >= rangeStart && dd <= rangeEnd;
    });

    // 3. N+1월 진행 예정: dueDate가 차월, 진행중/대기
    const nextMonthTasks = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      if (t.status !== '진행중' && t.status !== '대기') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd >= nextStart && dd <= nextEnd;
    });

    return { completed, carryover, nextMonthTasks };
  }, [reportType, reportTasks, monthlyPeriod]);

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
      const total = biweeklyData.upcoming.length + biweeklyData.completed.length;
      return {
        total,
        completed: biweeklyData.completed.length,
        incomplete: biweeklyData.upcoming.length,
        delayed: biweeklyData.ceoDecision.length,
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
      const sf = format(new Date(biweeklyPeriod.start), 'M.dd');
      const ef = format(new Date(biweeklyPeriod.selected), 'M.dd');
      return `${sf} ~ ${ef} 대표이사 보고`;
    }
    if (reportType === '월간') {
      return `${monthlyPeriod.label} 업무 현황`;
    }
    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);
    return `${format(rangeStart, 'yyyy.MM.dd')} ~ ${format(rangeEnd, 'yyyy.MM.dd')}`;
  }, [reportType, startDate, endDate, biweeklyPeriod, monthlyPeriod]);

  /* ─── 카테고리 그룹 (클립보드/Obsidian 용) ─── */
  const completedTasks = useMemo(() => {
    if (reportType === '주간') return weeklyData?.completed || [];
    if (reportType === '격주') return biweeklyData?.completed || [];
    return monthlyData?.completed || [];
  }, [reportType, weeklyData, biweeklyData, monthlyData]);

  const incompleteTasks = useMemo(() => {
    if (reportType === '주간') return weeklyData?.incomplete || [];
    if (reportType === '격주') return biweeklyData?.upcoming || [];
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

  /* ─── 주간 리포트 렌더 ─── */
  const renderWeeklyReport = () => {
    if (!weeklyData) return null;
    const { completed, incomplete, nextWeek, delayed } = weeklyData;

    // 담당자별 KPI 그룹
    const kpiByAssignee: Record<string, Kpi[]> = {};
    allKpis.forEach((k) => {
      const name = k.assigneeName || '미배정';
      if (!kpiByAssignee[name]) kpiByAssignee[name] = [];
      kpiByAssignee[name].push(k);
    });

    return (
      <>
        <Block title="이번 주 완료 업무" count={completed.length} dotColor="green" defaultOpen>
          {renderCategoryBlocks(groupByCategory(completed), (tasks) => renderCompletedList(tasks))}
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
          {renderAssigneeBlocks(groupByAssignee(sortByPriority(nextWeek)), (tasks) => renderTaskList(tasks))}
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

        <Block title="KPI 진행 현황" count={allKpis.length} dotColor="yellow" defaultOpen>
          {Object.keys(kpiByAssignee).length === 0 ? <div className="rpt-empty">해당 없음</div> :
            Object.entries(kpiByAssignee).map(([name, kpis]) => (
              <div key={name} className="rpt-cat-group">
                <div className="rpt-cat-label">{name} <span className="rpt-cat-cnt">{kpis.length}</span></div>
                {renderKpiBlock(kpis)}
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
    const { completed, upcoming, ceoDecision } = biweeklyData;

    const kpiByAssignee: Record<string, Kpi[]> = {};
    allKpis.forEach((k) => {
      const name = k.assigneeName || '미배정';
      if (!kpiByAssignee[name]) kpiByAssignee[name] = [];
      kpiByAssignee[name].push(k);
    });

    return (
      <>
        <Block title="2주간 완료 업무" count={completed.length} dotColor="green" defaultOpen>
          {renderCategoryBlocks(groupByCategory(completed), (tasks) => renderCompletedList(tasks))}
        </Block>

        <Block title="다음 2주 진행 예정" count={upcoming.length} dotColor="blue" defaultOpen>
          {upcoming.length === 0 ? <div className="rpt-empty">해당 없음</div> : (
            <div className="rpt-list">
              {upcoming.map((t) => {
                const dd = tsToDate(t.dueDate);
                return (
                  <div key={t.taskId} className="rpt-item">
                    <span className="rpt-item-title">{t.title}</span>
                    <span className="rpt-item-assignee">{t.assigneeName}</span>
                    {dd && <span className="rpt-item-date">{format(dd, 'M.dd')} 마감</span>}
                  </div>
                );
              })}
            </div>
          )}
        </Block>

        <Block title="결정 필요 사항" count={ceoDecision.length} dotColor="yellow" defaultOpen>
          {ceoDecision.length === 0 ? (
            <div className="rpt-empty">해당 없음</div>
          ) : (
            <div className="rpt-list">
              {ceoDecision.map((t) => (
                <div key={t.taskId} className="rpt-item">
                  <span className="rpt-item-title">{t.title}</span>
                  <span className="rpt-item-assignee">{t.assigneeName}</span>
                  <span className="rpt-item-reason">{t.ceoFlagReason || t.notes || (t.status === '보류' ? '보류 중' : '')}</span>
                </div>
              ))}
            </div>
          )}
        </Block>

        <Block title="KPI 달성 현황" count={allKpis.length} dotColor="yellow" defaultOpen>
          {Object.keys(kpiByAssignee).length === 0 ? <div className="rpt-empty">해당 없음</div> :
            Object.entries(kpiByAssignee).map(([name, kpis]) => (
              <div key={name} className="rpt-cat-group">
                <div className="rpt-cat-label">{name} <span className="rpt-cat-cnt">{kpis.length}</span></div>
                {renderKpiBlock(kpis)}
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
    const { completed, carryover, nextMonthTasks } = monthlyData;
    const completedGroups = groupByCategory(completed);
    const nMonth = monthlyPeriod.nextLabel;

    // 카테고리별 완료율: 선택월 마감 업무 중 완료 비율
    const allMonthTasks = reportTasks.filter((t) => {
      const dd = tsToDate(t.dueDate);
      const rs = new Date(monthlyPeriod.start);
      const re = new Date(monthlyPeriod.end); re.setHours(23,59,59,999);
      return dd !== null && dd >= rs && dd <= re;
    });
    const catCompletionRate: Record<string, { total: number; done: number }> = {};
    allMonthTasks.forEach((t) => {
      const cat = t.category || '기타';
      if (!catCompletionRate[cat]) catCompletionRate[cat] = { total: 0, done: 0 };
      catCompletionRate[cat].total++;
      if (t.status === '완료') catCompletionRate[cat].done++;
    });

    return (
      <>
        <Block title={`${monthlyPeriod.label} 완료 업무`} count={completed.length} dotColor="green" defaultOpen>
          {completedGroups.length === 0 ? <div className="rpt-empty">해당 없음</div> :
            completedGroups.map((g) => {
              const rate = catCompletionRate[g.category];
              const pct = rate ? Math.round((rate.done / rate.total) * 100) : 0;
              return (
                <div key={g.category} className="rpt-cat-group">
                  <div className="rpt-cat-label">
                    {g.category}
                    <span className="rpt-cat-cnt">{g.tasks.length}건</span>
                    <span style={{ marginLeft: 8, fontSize: 11, color: pct >= 80 ? 'var(--c-green,#0d9f61)' : 'var(--c-text-3,#999)' }}>
                      완료율 {pct}%
                    </span>
                  </div>
                  <div className="rpt-list">{renderCompletedList(g.tasks)}</div>
                </div>
              );
            })
          }
        </Block>

        <Block title={`${nMonth}월 이월 업무`} count={carryover.length} dotColor="red" danger defaultOpen>
          {carryover.length === 0 ? <div className="rpt-empty">해당 없음</div> : (
            <div className="rpt-list">
              {carryover.map((t) => {
                const statusLabel = t.status === '보류' ? '보류' : t.status === '지연' ? '지연' : '미완료';
                return (
                  <div key={t.taskId} className="rpt-item rpt-item-delayed">
                    <span className="rpt-item-title">{t.title}</span>
                    <span className="rpt-item-assignee">{t.assigneeName}</span>
                    <span className="rpt-item-tag rpt-tag-red">{statusLabel}</span>
                    <span className="rpt-item-reason">{t.notes || '사유 미입력'}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Block>

        <Block title={`${nMonth}월 진행 예정 업무`} count={nextMonthTasks.length} dotColor="blue" defaultOpen>
          {nextMonthTasks.length === 0 ? <div className="rpt-empty">해당 없음</div> : (
            <div className="rpt-list">
              {nextMonthTasks.map((t) => {
                const dd = tsToDate(t.dueDate);
                return (
                  <div key={t.taskId} className="rpt-item">
                    <span className="rpt-item-title">{t.title}</span>
                    <span className="rpt-item-assignee">{t.assigneeName}</span>
                    {dd && <span className="rpt-item-date">{format(dd, 'M.dd')} 마감</span>}
                  </div>
                );
              })}
            </div>
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
      </div>

      {error && <div className="tm-error">{error}</div>}

      {generated && (
        <div className="tm-report-content">
          <h2 className="tm-report-title">{periodLabel}</h2>

          {/* 요약 카드 */}
          <div className="tm-perf-grid">
            <div className="tm-perf-item">
              <div className="tm-perf-value">{stats.total}</div>
              <div className="tm-perf-label">전체</div>
            </div>
            <div className="tm-perf-item">
              <div className="tm-perf-value" style={{ color: 'var(--c-accent)' }}>{stats.incomplete}</div>
              <div className="tm-perf-label">
                {reportType === '월간' ? '차월 예정' : reportType === '격주' ? '예정' : '미완료'}
              </div>
            </div>
            <div className="tm-perf-item">
              <div className="tm-perf-value" style={{ color: 'var(--c-green)' }}>{stats.completed}</div>
              <div className="tm-perf-label">완료</div>
            </div>
            <div className="tm-perf-item">
              <div className="tm-perf-value" style={{ color: 'var(--c-red)' }}>{stats.delayed}</div>
              <div className="tm-perf-label">
                {reportType === '격주' ? '결정 필요' : reportType === '월간' ? '이월' : '지연'}
              </div>
            </div>
          </div>

          {/* 리포트 타입별 섹션 */}
          {reportType === '주간' && renderWeeklyReport()}
          {reportType === '격주' && renderBiweeklyReport()}
          {reportType === '월간' && renderMonthlyReport()}
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
