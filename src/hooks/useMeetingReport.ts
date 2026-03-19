import { useCallback, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import {
  differenceInDays,
  startOfMonth,
  endOfMonth,
  addDays,
  format,
} from 'date-fns';
import { fetchAllTasks } from '../services/taskService';
import type {
  Task,
  WeeklyReport,
  BiweeklyReport,
  MonthlyReport,
  AssigneeCompletedGroup,
  InProgressTaskItem,
  DelayedTaskItem,
  UpcomingDeadlineItem,
  MemberWorkloadItem,
  CeoDecisionItem,
} from '../types';

function tsToDate(ts: Timestamp | null | undefined): Date | null {
  if (!ts) return null;
  return ts instanceof Timestamp ? ts.toDate() : new Date(ts as unknown as string);
}

function inRange(ts: Timestamp | null | undefined, start: Date, end: Date): boolean {
  const d = tsToDate(ts);
  if (!d) return false;
  return d >= start && d <= end;
}

/** 상위업무(그룹 헤더)인지 판별 — 하위업무가 있는 parentTask는 리포트에서 제외 */
function isParentHeader(task: Task, allTasks: Task[]): boolean {
  if (task.parentTaskId) return false; // 하위업무
  // 이 task를 parent로 가진 하위업무가 있으면 그룹 헤더
  return allTasks.some((t) => t.parentTaskId === task.taskId);
}

/** 리포트 대상 업무만 필터 (상위 그룹 헤더 제외) */
function getReportTasks(allTasks: Task[]): Task[] {
  return allTasks.filter((t) => !isParentHeader(t, allTasks));
}

function groupByAssignee(tasks: Task[]): AssigneeCompletedGroup[] {
  const map: Record<string, AssigneeCompletedGroup> = {};
  for (const t of tasks) {
    const name = t.assigneeName || '미배정';
    if (!map[name]) map[name] = { assigneeName: name, tasks: [] };
    map[name].tasks.push({
      title: t.title,
      completedDate: tsToDate(t.completedDate)
        ? format(tsToDate(t.completedDate)!, 'yyyy.MM.dd')
        : '-',
      actualHours: 0,
    });
  }
  return Object.values(map);
}

function toInProgress(tasks: Task[]): InProgressTaskItem[] {
  return tasks.map((t) => {
    const due = tsToDate(t.dueDate);
    return {
      title: t.title,
      assigneeName: t.assigneeName || '미배정',
      progressRate: t.progressRate || 0,
      dueDate: due ? format(due, 'yyyy.MM.dd') : '-',
      daysLeft: due ? differenceInDays(due, new Date()) : 999,
    };
  });
}

function toDelayed(tasks: Task[]): DelayedTaskItem[] {
  return tasks.map((t) => {
    const due = tsToDate(t.dueDate);
    return {
      title: t.title,
      assigneeName: t.assigneeName || '미배정',
      originalDueDate: due ? format(due, 'yyyy.MM.dd') : '-',
      delayDays: due ? Math.abs(differenceInDays(due, new Date())) : 0,
      reason: t.notes || '',
    };
  });
}

function toUpcoming(tasks: Task[]): UpcomingDeadlineItem[] {
  return tasks.map((t) => {
    const due = tsToDate(t.dueDate);
    return {
      title: t.title,
      assigneeName: t.assigneeName || '미배정',
      dueDate: due ? format(due, 'yyyy.MM.dd') : '-',
    };
  });
}

function calcWorkload(tasks: Task[], rangeStart: Date, rangeEnd: Date): MemberWorkloadItem[] {
  const map: Record<string, MemberWorkloadItem> = {};
  for (const t of tasks) {
    const name = t.assigneeName || '미배정';
    if (!map[name]) {
      map[name] = { name, totalTasks: 0, completedThisWeek: 0, inProgress: 0, delayed: 0 };
    }
    map[name].totalTasks++;
    if (t.status === '완료' && inRange(t.completedDate, rangeStart, rangeEnd)) {
      map[name].completedThisWeek++;
    }
    if (t.status === '진행중' || t.status === '대기') map[name].inProgress++;
    if (t.status === '지연') map[name].delayed++;
    const due = tsToDate(t.dueDate);
    if (due && due < new Date() && t.status !== '완료' && t.status !== '지연') map[name].delayed++;
  }
  return Object.values(map);
}

export interface DateRange {
  start: Date;
  end: Date;
}

export function useMeetingReport() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateWeekly = useCallback(async (_baseDate: Date = new Date(), range?: DateRange): Promise<WeeklyReport> => {
    setLoading(true);
    setError(null);
    try {
      const allTasks = await fetchAllTasks();
      const tasks = getReportTasks(allTasks);
      const now = new Date();

      const rangeStart = range?.start || startOfMonth(now);
      const rangeEnd = range?.end || endOfMonth(now);
      const nextStart = addDays(rangeEnd, 1);
      const nextEnd = addDays(rangeEnd, 7);

      const completed = tasks.filter((t) => t.status === '완료' && inRange(t.completedDate, rangeStart, rangeEnd));
      const inProgress = tasks.filter((t) => {
        if (t.status === '완료') return false;
        const sd = tsToDate(t.startDate);
        const dd = tsToDate(t.dueDate);
        if (!sd && !dd) return t.status === '진행중' || t.status === '대기';
        if (dd && dd >= rangeStart) return true;
        if (sd && sd <= rangeEnd) return true;
        return false;
      });
      const delayed = tasks.filter((t) => {
        const due = tsToDate(t.dueDate);
        return due && due < now && t.status !== '완료';
      });
      const upcoming = tasks.filter((t) => inRange(t.dueDate, nextStart, nextEnd) && t.status !== '완료');

      return {
        period: `${format(rangeStart, 'yyyy.MM.dd')} ~ ${format(rangeEnd, 'yyyy.MM.dd')}`,
        completedTasks: groupByAssignee(completed),
        inProgressTasks: toInProgress(inProgress),
        delayedTasks: toDelayed(delayed),
        upcomingDeadlines: toUpcoming(upcoming),
        kpiStatus: [],
        memberWorkload: calcWorkload(tasks, rangeStart, rangeEnd),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '리포트 생성에 실패했습니다.';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const generateBiweekly = useCallback(async (_baseDate: Date = new Date(), range?: DateRange): Promise<BiweeklyReport> => {
    setLoading(true);
    setError(null);
    try {
      const allTasks = await fetchAllTasks();
      const tasks = getReportTasks(allTasks);
      const now = new Date();

      const rangeStart = range?.start || startOfMonth(now);
      const rangeEnd = range?.end || endOfMonth(now);
      const nextEnd = addDays(rangeEnd, 14);

      const completed = tasks.filter((t) => t.status === '완료' && inRange(t.completedDate, rangeStart, rangeEnd));
      const inProgress = tasks.filter((t) => t.status === '진행중' || t.status === '대기');
      const delayed = tasks.filter((t) => {
        const due = tsToDate(t.dueDate);
        return due && due < now && t.status !== '완료';
      });
      const upcoming = tasks.filter((t) => inRange(t.dueDate, rangeEnd, nextEnd) && t.status !== '완료');
      const ceoItems = tasks.filter((t) => t.ceoFlag && t.status !== '완료');

      const weeklyBase: WeeklyReport = {
        period: `${format(rangeStart, 'yyyy.MM.dd')} ~ ${format(rangeEnd, 'yyyy.MM.dd')}`,
        completedTasks: groupByAssignee(completed),
        inProgressTasks: toInProgress(inProgress),
        delayedTasks: toDelayed(delayed),
        upcomingDeadlines: toUpcoming(upcoming),
        kpiStatus: [],
        memberWorkload: calcWorkload(tasks, rangeStart, rangeEnd),
      };

      return {
        ...weeklyBase,
        twoWeekSummary: groupByAssignee(completed),
        nextTwoWeeksPlanning: toUpcoming(upcoming),
        ceoDecisionItems: ceoItems.map((t): CeoDecisionItem => ({
          title: t.title,
          assigneeName: t.assigneeName || '미배정',
          reason: t.notes || '',
          ceoFlagReason: t.ceoFlagReason || '',
        })),
        riskItems: toDelayed(delayed),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '리포트 생성에 실패했습니다.';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const generateMonthly = useCallback(async (year: number, month: number, range?: DateRange): Promise<MonthlyReport> => {
    setLoading(true);
    setError(null);
    try {
      const allTasks = await fetchAllTasks();
      const tasks = getReportTasks(allTasks);
      const now = new Date();

      const rangeStart = range?.start || startOfMonth(new Date(year, month - 1));
      const rangeEnd = range?.end || endOfMonth(new Date(year, month - 1));
      const nextMonthStart = addDays(rangeEnd, 1);
      const nextMonthEnd = endOfMonth(nextMonthStart);

      const completed = tasks.filter((t) => t.status === '완료' && inRange(t.completedDate, rangeStart, rangeEnd));
      const inProgress = tasks.filter((t) => t.status === '진행중' || t.status === '대기');
      const nextMonth = tasks.filter((t) => inRange(t.dueDate, nextMonthStart, nextMonthEnd) && t.status !== '완료');

      const totalCompleted = completed.length;
      const totalDelayed = tasks.filter((t) => {
        const due = tsToDate(t.dueDate);
        return due && due < now && t.status !== '완료';
      }).length;
      const allActive = tasks.filter((t) => t.status !== '완료');
      const avgProgress = allActive.length > 0
        ? Math.round(allActive.reduce((sum, t) => sum + (t.progressRate || 0), 0) / allActive.length)
        : 0;

      return {
        period: range
          ? `${format(rangeStart, 'yyyy.MM.dd')} ~ ${format(rangeEnd, 'yyyy.MM.dd')}`
          : `${year}년 ${month}월`,
        monthlyKpiSummary: [],
        teamPerformance: {
          totalCompleted,
          totalDelayed,
          completionRate: tasks.length > 0 ? Math.round((totalCompleted / tasks.length) * 100) : 0,
          avgProgressRate: avgProgress,
        },
        memberSummary: calcWorkload(tasks, rangeStart, rangeEnd),
        highlights: completed
          .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
          .slice(0, 5)
          .map((t) => ({
            title: t.title,
            completedDate: tsToDate(t.completedDate) ? format(tsToDate(t.completedDate)!, 'yyyy.MM.dd') : '-',
            actualHours: 0,
          })),
        nextMonthPlanning: toUpcoming(nextMonth),
        pendingItems: toInProgress(inProgress),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '리포트 생성에 실패했습니다.';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { generateWeekly, generateBiweekly, generateMonthly, loading, error };
}
