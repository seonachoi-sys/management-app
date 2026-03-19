import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Timestamp } from 'firebase/firestore';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addWeeks,
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

  /* ─── 격주 자동 기간 계산 ─── */
  const biweeklyPeriod = useMemo(() => {
    if (ceoMeetingDates.length === 0) return null;
    const today = new Date();
    const sorted = [...ceoMeetingDates].sort();
    let prevDate = sorted[0];
    let nextDate = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length; i++) {
      if (new Date(sorted[i]) > today) {
        nextDate = sorted[i];
        prevDate = sorted[i - 1] || sorted[i];
        break;
      }
    }
    return { start: prevDate, end: nextDate };
  }, [ceoMeetingDates]);

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
        // fallback: 이번 주 ~ 다음 주
        setStartDate(format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
        setEndDate(format(endOfWeek(addWeeks(today, 1), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
      }
    } else {
      setStartDate(format(startOfMonth(today), 'yyyy-MM-dd'));
      setEndDate(format(endOfMonth(today), 'yyyy-MM-dd'));
    }
    setGenerated(false);
  }, [reportType, biweeklyPeriod]);

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

    // 이번 주 진행 업무: 진행중 상태이면서 마감일이 이번 주
    const inProgress = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      if (dd && dd >= weekStart && dd <= weekEnd) return true;
      const sd = tsToDate(t.startDate);
      if (sd && dd && sd <= weekEnd && dd >= weekStart) return true;
      return false;
    });

    // 이번 주 완료 업무
    const completed = reportTasks.filter((t) => {
      if (t.status !== '완료') return false;
      const cd = tsToDate(t.completedDate);
      if (cd && cd >= weekStart && cd <= weekEnd) return true;
      const dd = tsToDate(t.dueDate);
      if (!cd && dd && dd >= weekStart && dd <= weekEnd) return true;
      return false;
    });

    // 차주 예정 업무
    const nextWeek = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      if (dd && dd >= nextWeekStart && dd <= nextWeekEnd) return true;
      const sd = tsToDate(t.startDate);
      if (sd && sd >= nextWeekStart && sd <= nextWeekEnd) return true;
      return false;
    });

    // 이월 업무: 마감일 지남 + 미완료
    const delayed = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd < today;
    });

    return { inProgress, completed, nextWeek, delayed };
  }, [reportType, reportTasks]);

  /* ─── 격주(CEO) 리포트 데이터 ─── */
  const biweeklyData = useMemo(() => {
    if (reportType !== '격주') return null;
    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);
    rangeEnd.setHours(23, 59, 59, 999);

    const completed = reportTasks.filter((t) => {
      if (t.status !== '완료') return false;
      const cd = tsToDate(t.completedDate);
      if (cd && cd >= rangeStart && cd <= rangeEnd) return true;
      const dd = tsToDate(t.dueDate);
      if (!cd && dd && dd >= rangeStart && dd <= rangeEnd) return true;
      return false;
    });

    const inProgress = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const sd = tsToDate(t.startDate);
      const dd = tsToDate(t.dueDate);
      if (sd && sd >= rangeStart && sd <= rangeEnd) return true;
      if (dd && dd >= rangeStart && dd <= rangeEnd) return true;
      if (sd && dd && sd <= rangeEnd && dd >= rangeStart) return true;
      return false;
    });

    const ceoDecision = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      return t.ceoFlag;
    });

    return { completed, inProgress, ceoDecision };
  }, [reportType, reportTasks, startDate, endDate]);

  /* ─── 월간 리포트 데이터 ─── */
  const monthlyData = useMemo(() => {
    if (reportType !== '월간') return null;
    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);
    rangeEnd.setHours(23, 59, 59, 999);
    const today = new Date();

    const completed = reportTasks.filter((t) => {
      if (t.status !== '완료') return false;
      const cd = tsToDate(t.completedDate);
      if (cd && cd >= rangeStart && cd <= rangeEnd) return true;
      const dd = tsToDate(t.dueDate);
      if (!cd && dd && dd >= rangeStart && dd <= rangeEnd) return true;
      return false;
    });

    // 이월 업무: 마감일 지남 + 미완료
    const delayed = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = tsToDate(t.dueDate);
      return dd !== null && dd < today;
    });

    // 신규 업무: 이번 달에 생성된 업무
    const newTasks = reportTasks.filter((t) => {
      const created = tsToDate(t.createdAt);
      return created !== null && created >= rangeStart && created <= rangeEnd;
    });

    return { completed, delayed, newTasks };
  }, [reportType, reportTasks, startDate, endDate]);

  /* ─── 통합 stats (요약 카드용) ─── */
  const stats = useMemo(() => {
    if (reportType === '주간' && weeklyData) {
      const total = weeklyData.inProgress.length + weeklyData.completed.length + weeklyData.delayed.length;
      return {
        total,
        completed: weeklyData.completed.length,
        incomplete: weeklyData.inProgress.length,
        delayed: weeklyData.delayed.length,
      };
    }
    if (reportType === '격주' && biweeklyData) {
      const total = biweeklyData.inProgress.length + biweeklyData.completed.length;
      return {
        total,
        completed: biweeklyData.completed.length,
        incomplete: biweeklyData.inProgress.length,
        delayed: biweeklyData.ceoDecision.length,
      };
    }
    if (reportType === '월간' && monthlyData) {
      const total = monthlyData.completed.length + monthlyData.delayed.length + monthlyData.newTasks.length;
      return {
        total,
        completed: monthlyData.completed.length,
        incomplete: monthlyData.newTasks.length,
        delayed: monthlyData.delayed.length,
      };
    }
    return { total: 0, completed: 0, incomplete: 0, delayed: 0 };
  }, [reportType, weeklyData, biweeklyData, monthlyData]);

  /* ─── 기간 라벨 ─── */
  const periodLabel = useMemo(() => {
    if (reportType === '격주' && biweeklyPeriod) {
      const s = biweeklyPeriod.start;
      const e = biweeklyPeriod.end;
      const sf = format(new Date(s), 'M.dd');
      const ef = format(new Date(e), 'M.dd');
      return `${sf} ~ ${ef} 대표이사 보고`;
    }
    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);
    return `${format(rangeStart, 'yyyy.MM.dd')} ~ ${format(rangeEnd, 'yyyy.MM.dd')}`;
  }, [reportType, startDate, endDate, biweeklyPeriod]);

  /* ─── 카테고리 그룹 (클립보드/Obsidian 용) ─── */
  const completedTasks = useMemo(() => {
    if (reportType === '주간') return weeklyData?.completed || [];
    if (reportType === '격주') return biweeklyData?.completed || [];
    return monthlyData?.completed || [];
  }, [reportType, weeklyData, biweeklyData, monthlyData]);

  const incompleteTasks = useMemo(() => {
    if (reportType === '주간') return weeklyData?.inProgress || [];
    if (reportType === '격주') return biweeklyData?.inProgress || [];
    return monthlyData?.newTasks || [];
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
    const { inProgress, completed, nextWeek, delayed } = weeklyData;
    const inProgressGroups = groupByCategory(inProgress);
    const completedGroups = groupByCategory(completed);
    const nextWeekGroups = groupByCategory(nextWeek);
    const delayedGroups = groupByCategory(delayed);

    return (
      <>
        <Block title="이번 주 진행 업무" count={inProgress.length} dotColor="blue" defaultOpen>
          {renderCategoryBlocks(inProgressGroups, (tasks) => renderTaskList(tasks))}
        </Block>

        <Block title="이번 주 완료 업무" count={completed.length} dotColor="green" defaultOpen>
          {renderCategoryBlocks(completedGroups, (tasks) => renderCompletedList(tasks))}
        </Block>

        <Block title="차주 예정 업무" count={nextWeek.length} dotColor="blue" defaultOpen={false}>
          {renderCategoryBlocks(nextWeekGroups, (tasks) => renderTaskList(tasks))}
        </Block>

        <Block title="이월 업무" count={delayed.length} dotColor="red" danger defaultOpen>
          {renderCategoryBlocks(delayedGroups, (tasks) => renderTaskList(tasks))}
        </Block>

        <Block title="KPI 현황" count={allKpis.length} dotColor="yellow" defaultOpen>
          {renderKpiBlock(allKpis)}
        </Block>
      </>
    );
  };

  /* ─── 격주(CEO) 리포트 렌더 ─── */
  const renderBiweeklyReport = () => {
    if (!biweeklyData) return null;
    const { completed, inProgress, ceoDecision } = biweeklyData;
    const completedGroups = groupByCategory(completed);
    const inProgressGroups = groupByCategory(inProgress);

    return (
      <>
        <Block title="완료 업무" count={completed.length} dotColor="green" defaultOpen>
          {renderCategoryBlocks(completedGroups, (tasks) => renderCompletedList(tasks))}
        </Block>

        <Block title="진행 업무" count={inProgress.length} dotColor="blue" defaultOpen>
          {renderCategoryBlocks(inProgressGroups, (tasks) => renderTaskList(tasks))}
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
                  <span className="rpt-item-reason">{t.ceoFlagReason || t.notes}</span>
                </div>
              ))}
            </div>
          )}
        </Block>

        <Block title="KPI 현황" count={allKpis.length} dotColor="yellow" defaultOpen>
          {renderKpiBlock(allKpis)}
        </Block>
      </>
    );
  };

  /* ─── 월간 리포트 렌더 ─── */
  const renderMonthlyReport = () => {
    if (!monthlyData) return null;
    const { completed, delayed, newTasks } = monthlyData;
    const completedGroups = groupByCategory(completed);
    const delayedGroups = groupByCategory(delayed);
    const newTaskGroups = groupByCategory(newTasks);

    return (
      <>
        <Block title="완료 업무" count={completed.length} dotColor="green" defaultOpen>
          {renderCategoryBlocks(completedGroups, (tasks) => renderCompletedList(tasks))}
        </Block>

        <Block title="이월 업무" count={delayed.length} dotColor="red" danger defaultOpen>
          {renderCategoryBlocks(delayedGroups, (tasks) => renderTaskList(tasks))}
        </Block>

        <Block title="신규 업무" count={newTasks.length} dotColor="blue" defaultOpen>
          {renderCategoryBlocks(newTaskGroups, (tasks) => renderTaskList(tasks))}
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
        <label className="rpt-date-label">
          시작일
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <span className="rpt-date-sep">~</span>
        <label className="rpt-date-label">
          종료일
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
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
                {reportType === '월간' ? '신규' : '진행'}
              </div>
            </div>
            <div className="tm-perf-item">
              <div className="tm-perf-value" style={{ color: 'var(--c-green)' }}>{stats.completed}</div>
              <div className="tm-perf-label">완료</div>
            </div>
            <div className="tm-perf-item">
              <div className="tm-perf-value" style={{ color: 'var(--c-red)' }}>{stats.delayed}</div>
              <div className="tm-perf-label">
                {reportType === '격주' ? '결정 필요' : '지연'}
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
