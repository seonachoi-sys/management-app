import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { Task, TaskStatus } from '../types';
import { updateDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { startOfWeek, endOfWeek, format, differenceInDays, addDays } from 'date-fns';
import { useTasks, useCreateTask, useUpdateTask, useDeleteTask } from '../hooks/useTasks';
import { useMembers } from '../hooks/useMembers';
import { useNotifications } from '../hooks/useNotifications';
import { useAuth } from '../hooks/useAuth';
import { useSettings } from '../hooks/useSettings';
import { useMigration } from '../hooks/useMigration';
import type { TaskFilters } from '../services/taskService';
import {
  initGoogleTasks,
  requestAccess,
  isSignedIn as isGoogleSignedIn,
  syncTaskToGoogleTasks,
  fetchGoogleTasks,
  getLastSyncTime,
  setLastSyncTime,
  clearGoogleTasksCache,
} from '../services/googleTasksService';
import TaskCard from './TaskCard';
import TaskForm from './TaskForm';
import MeetingReportPanel from './MeetingReportPanel';
import NotificationCenter from './NotificationCenter';
import SettingsPanel from './SettingsPanel';
import KpiPanel from './KpiPanel';
import EisenhowerMatrix from './EisenhowerMatrix';
import type { Quadrant } from './EisenhowerMatrix';
import './TaskManager.css';

/* ─── 카테고리별 그룹 섹션 ─── */
function CategorySection({
  category,
  parentTasks,
  childMap,
  currentUserName,
  onStatusChange,
  onEdit,
  onDelete,
  onAddSubTask,
}: {
  category: string;
  parentTasks: Task[];
  childMap: Record<string, Task[]>;
  currentUserName: string;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onAddSubTask: (parentId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // 카테고리 내 전체 업무 수 (상위 + 하위)
  const totalCount = parentTasks.reduce(
    (sum, t) => sum + 1 + (childMap[t.taskId]?.length || 0), 0,
  );
  const doneCount = parentTasks.reduce((sum, t) => {
    const children = childMap[t.taskId] || [];
    return sum + children.filter((c) => c.status === '완료').length;
  }, 0);

  return (
    <div className="tm-category-section">
      <button
        className="tm-category-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className={`tm-cat-arrow ${collapsed ? '' : 'expanded'}`}>▶</span>
        <span className="tm-cat-name">{category}</span>
        <span className="tm-cat-count">{totalCount}건</span>
        {doneCount > 0 && <span className="tm-cat-done">완료 {doneCount}</span>}
      </button>
      {!collapsed && (
        <div className="tm-category-body">
          {parentTasks.map((task) => (
            <TaskCard
              key={task.taskId}
              task={task}
              childTasks={childMap[task.taskId] || EMPTY_TASKS}
              currentUserName={currentUserName}
              onStatusChange={onStatusChange}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddSubTask={onAddSubTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── 이번 주 뷰용 인라인 상태 드롭다운 ─── */
const STATUS_COLORS: Record<string, string> = {
  '대기': '#999', '진행중': 'var(--c-accent, #2f6ce5)', '완료': 'var(--c-green, #0d9f61)',
  '지연': 'var(--c-red, #e03e3e)', '보류': '#bbb',
};
function StatusDropdownInline({ current, onChange }: { current: TaskStatus; onChange: (s: TaskStatus) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <button
        className="tm-status-badge-sm"
        style={{ color: STATUS_COLORS[current], borderColor: STATUS_COLORS[current] }}
        onClick={() => setOpen(!open)}
      >{current}</button>
      {open && (
        <div className="tm-status-menu" style={{ position: 'fixed', zIndex: 200 }}>
          {(['대기','진행중','완료','지연','보류'] as TaskStatus[]).map((s) => (
            <button key={s} className="tm-status-option" style={{ color: STATUS_COLORS[s] }}
              onClick={() => { if (s !== current) onChange(s); setOpen(false); }}>{s}</button>
          ))}
        </div>
      )}
    </span>
  );
}

const STATUS_OPTIONS: { value: TaskStatus | ''; label: string }[] = [
  { value: '', label: '전체' },
  { value: '대기', label: '대기' },
  { value: '진행중', label: '진행중' },
  { value: '완료', label: '완료' },
  { value: '지연', label: '지연' },
  { value: '보류', label: '보류' },
];

const EMPTY_TASKS: Task[] = [];

export default function TaskDashboard() {
  const { user, loading: authLoading, signIn, signOut } = useAuth();
  const { categories, kpiCategories, ceoMeetingDates, saveTaskCategories, saveKpiCategories, saveCeoMeetingDates } = useSettings();

  // localStorage → Firestore 마이그레이션
  useMigration(user?.uid);

  const [view, setView] = useState<'list' | 'weekly' | 'matrix' | 'report' | 'kpi'>('kpi');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');
  const [categoryFilter, setCategoryFilter] = useState('전체');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState(''); // 'YYYY-MM' or ''
  const [autoMappedDone, setAutoMappedDone] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const toastIdRef = React.useRef(0);
  const addToast = useCallback((message: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [parentForNewTask, setParentForNewTask] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(getLastSyncTime());

  // 담당자 필터는 subscribeTasks에서 제외 (상위업무 assigneeName이 빈 문자열이므로)
  // categoryGroups 트리 구조에서 별도 처리
  const filters: TaskFilters = useMemo(() => {
    const f: TaskFilters = {};
    if (statusFilter) f.status = statusFilter;
    if (categoryFilter !== '전체') f.category = categoryFilter;
    return f;
  }, [statusFilter, categoryFilter]);

  const { tasks, loading, error } = useTasks(filters);
  const tasksRef = React.useRef(tasks);
  tasksRef.current = tasks;
  const { members } = useMembers();

  // 로그인 이메일 → 팀원 매핑 → 담당자 자동 필터
  const mappedMember = useMemo(() => {
    if (!user?.email || members.length === 0) return null;
    return members.find((m) => m.email === user.email) || null;
  }, [user?.email, members]);

  // 로그인 시 최초 1회만 자동 매핑 (이후 수동 변경 보호)
  useEffect(() => {
    if (autoMappedDone) return;
    if (mappedMember) {
      setAssigneeFilter(mappedMember.name);
      setAutoMappedDone(true);
    }
  }, [mappedMember, autoMappedDone]);
  const { notifications, unreadCount, read, readAll } = useNotifications(user?.uid);
  const { create } = useCreateTask();
  const { update } = useUpdateTask();
  const { del } = useDeleteTask();

  // 월별 필터 옵션 생성
  const assigneeNames = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.assigneeName).filter(Boolean))),
    [tasks],
  );

  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    for (const t of tasks) {
      const sd = t.startDate?.toDate?.();
      const dd = t.dueDate?.toDate?.();
      if (sd) months.add(`${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}`);
      if (dd) months.add(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`);
    }
    return Array.from(months).sort().reverse();
  }, [tasks]);

  // 담당자 + 월별 필터 적용 (상위업무는 하위업무 매칭 시 포함)
  const filteredTasks = useMemo(() => {
    let result = tasks;

    // 담당자 필터: 하위업무 매칭 시 상위업무도 포함
    if (assigneeFilter) {
      const matchingChildParentIds = new Set(
        result.filter((t) => t.parentTaskId && (t.assigneeName === assigneeFilter || t.assignee === assigneeFilter))
          .map((t) => t.parentTaskId!),
      );
      result = result.filter((t) => {
        if (t.assigneeName === assigneeFilter || t.assignee === assigneeFilter) return true;
        // 상위업무: 하위업무 중 해당 담당자가 있으면 포함
        if (!t.parentTaskId && matchingChildParentIds.has(t.taskId)) return true;
        return false;
      });
    }

    // 월별 필터
    if (monthFilter) {
      const [y, m] = monthFilter.split('-').map(Number);
      result = result.filter((t) => {
        const sd = t.startDate?.toDate?.();
        const dd = t.dueDate?.toDate?.();
        if (sd && sd.getFullYear() === y && sd.getMonth() + 1 === m) return true;
        if (dd && dd.getFullYear() === y && dd.getMonth() + 1 === m) return true;
        if (!t.parentTaskId && !sd && !dd) return true;
        return false;
      });
    }

    return result;
  }, [tasks, assigneeFilter, monthFilter]);

  // 카테고리 > 상위업무 > 하위업무 트리 구조
  const { categoryGroups, childMap } = useMemo(() => {
    const childMap: Record<string, Task[]> = {};
    const roots: Task[] = [];
    for (const t of filteredTasks) {
      if (t.parentTaskId) {
        if (!childMap[t.parentTaskId]) childMap[t.parentTaskId] = [];
        childMap[t.parentTaskId].push(t);
      } else {
        roots.push(t);
      }
    }
    // 하위업무가 있는 상위업무만 보이게 (월 필터 시)
    const visibleRoots = monthFilter
      ? roots.filter((r) => (childMap[r.taskId]?.length || 0) > 0 || r.startDate || r.dueDate)
      : roots;
    // 카테고리별로 그룹핑 (categories 순서 유지)
    const grouped: { category: string; tasks: Task[] }[] = [];
    const catOrder = categories.length > 0 ? categories : Array.from(new Set(visibleRoots.map((t) => t.category)));
    for (const cat of catOrder) {
      const catTasks = visibleRoots.filter((t) => t.category === cat);
      if (catTasks.length > 0) grouped.push({ category: cat, tasks: catTasks });
    }
    // 카테고리에 포함되지 않은 업무
    const usedCats = new Set(catOrder);
    const otherTasks = visibleRoots.filter((t) => !usedCats.has(t.category));
    if (otherTasks.length > 0) {
      const otherCats = Array.from(new Set(otherTasks.map((t) => t.category)));
      for (const cat of otherCats) {
        grouped.push({ category: cat, tasks: otherTasks.filter((t) => t.category === cat) });
      }
    }
    return { categoryGroups: grouped, childMap };
  }, [filteredTasks, categories, monthFilter]);

  // 통계
  const stats = useMemo(() => {
    const now = new Date();
    return {
      total: tasks.length,
      inProgress: tasks.filter((t) => t.status === '진행중' || t.status === '대기').length,
      done: tasks.filter((t) => t.status === '완료').length,
      delayed: tasks.filter((t) => {
        if (t.status === '지연') return true;
        if (t.status === '완료') return false;
        const due = t.dueDate?.toDate?.() || null;
        return due ? due < now : false;
      }).length,
    };
  }, [tasks]);

  // ─── 이번 주 뷰: filteredTasks 기준 날짜별 그룹핑 ───
  type WeekGroup = { dateKey: string; label: string; subLabel: string; colorClass: 'danger' | 'warning' | 'info' | 'muted'; tasks: Task[] };
  const weeklyGroups = useMemo((): WeekGroup[] => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    const todayStr = format(now, 'yyyy-MM-dd');

    const leafTasks = filteredTasks.filter((t) => {
      if (!t.parentTaskId && filteredTasks.some((c) => c.parentTaskId === t.taskId)) return false;
      return t.status !== '완료';
    });

    const weekTasks = leafTasks.filter((t) => {
      const dd = t.dueDate?.toDate?.();
      if (!dd) return true;
      // 이번 주 범위 + 지연(마감 지난) 업무도 포함
      return dd <= weekEnd;
    });

    const dateMap: Record<string, Task[]> = {};
    const noDateTasks: Task[] = [];
    weekTasks.forEach((t) => {
      const dd = t.dueDate?.toDate?.();
      if (!dd) { noDateTasks.push(t); return; }
      const key = format(dd, 'yyyy-MM-dd');
      if (!dateMap[key]) dateMap[key] = [];
      dateMap[key].push(t);
    });

    const groups: WeekGroup[] = [];
    Object.keys(dateMap).sort().forEach((key) => {
      const d = new Date(key + 'T00:00:00');
      const dLeft = differenceInDays(d, now);
      const mdd = `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
      let subLabel = '마감';
      let colorClass: WeekGroup['colorClass'] = 'info';
      if (dLeft < 0) { subLabel = '마감 (지연)'; colorClass = 'danger'; }
      else if (key === todayStr) { subLabel = '오늘 마감'; colorClass = 'danger'; }
      else if (dLeft >= 1 && dLeft <= 5) { subLabel = '마감'; colorClass = 'warning'; }
      else if (dLeft >= 6) { subLabel = '까지 마감'; colorClass = 'info'; }

      const isDelayed = dLeft < 0;
      groups.push({ dateKey: key, label: `${mdd} ${subLabel}`, subLabel: key === todayStr ? '오늘' : isDelayed ? '지연' : '', colorClass, tasks: dateMap[key] });
    });

    if (noDateTasks.length > 0) {
      groups.push({ dateKey: 'no-date', label: '날짜 미정', subLabel: '', colorClass: 'muted', tasks: noDateTasks });
    }
    return groups;
  }, [filteredTasks]);

  // 이번 주 pill 배너 데이터
  const weeklyPills = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const todayStr = format(now, 'yyyy-MM-dd');
    const allWeekTasks = weeklyGroups.flatMap((g) => g.tasks);

    const todayTasks = allWeekTasks.filter((t) => {
      const dd = t.dueDate?.toDate?.();
      return dd && format(dd, 'yyyy-MM-dd') === todayStr;
    });
    const soonTasks = allWeekTasks.filter((t) => {
      const dd = t.dueDate?.toDate?.();
      if (!dd) return false;
      const key = format(dd, 'yyyy-MM-dd');
      return key !== todayStr && dd > now;
    });
    const newTasks = allWeekTasks.filter((t) => {
      if (t.isNewDismissed) return false;
      if (!t.createdAt) return false;
      const created = t.createdAt instanceof Timestamp ? t.createdAt.toDate() : new Date(t.createdAt as unknown as string);
      return differenceInDays(now, created) <= 7;
    });
    const doneTasks = filteredTasks.filter((t) => t.status === '완료');

    const todayLabel = todayTasks.length > 0 ? `${now.getMonth()+1}.${String(now.getDate()).padStart(2,'0')}` : '';
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    const soonLabel = soonTasks.length > 0
      ? (() => {
          const tomorrow = addDays(now, 1);
          return `${tomorrow.getMonth()+1}.${String(tomorrow.getDate()).padStart(2,'0')}~${weekEnd.getMonth()+1}.${String(weekEnd.getDate()).padStart(2,'0')}`;
        })()
      : '';

    return { todayTasks, todayLabel, soonTasks, soonLabel, newTasks, doneTasks };
  }, [weeklyGroups, filteredTasks]);

  // NEW 뱃지 dismiss 핸들러
  const handleDismissNew = useCallback(async (taskId: string) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), { isNewDismissed: true });
    } catch {}
  }, []);

  const urgentTasks = useMemo(
    () => tasks.filter((t) => t.priority === '긴급' && t.status !== '완료'),
    [tasks],
  );

  const workload = useMemo(() => {
    const map: Record<string, { name: string; progress: number; done: number; delayed: number }> = {};
    for (const t of tasks) {
      const name = t.assigneeName || '미배정';
      if (!map[name]) map[name] = { name, progress: 0, done: 0, delayed: 0 };
      if (t.status === '진행중' || t.status === '대기') map[name].progress++;
      if (t.status === '완료') map[name].done++;
      if (t.status === '지연') map[name].delayed++;
    }
    return Object.values(map).sort((a, b) => b.progress - a.progress);
  }, [tasks]);

  // ─── 사이드바 데이터 ───
  const sidebarData = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const wStart = startOfWeek(now, { weekStartsOn: 1 });
    const wEnd = endOfWeek(now, { weekStartsOn: 1 });

    // 이번 주 업무 (하위업무만, 마감일 이번 주)
    const weekTasks = tasks.filter((t) => {
      const dd = t.dueDate?.toDate?.();
      return dd && dd >= wStart && dd <= wEnd;
    });
    const weekDone = weekTasks.filter((t) => t.status === '완료').length;
    const weekTotal = weekTasks.length;
    const weekPct = weekTotal > 0 ? Math.round((weekDone / weekTotal) * 100) : 0;

    // 지연 업무
    const delayed = tasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = t.dueDate?.toDate?.();
      return dd ? dd < now : false;
    }).slice(0, 10);

    // 오늘 마감
    const todayDue = tasks.filter((t) => {
      if (t.status === '완료') return false;
      const dd = t.dueDate?.toDate?.();
      return dd ? (dd >= now && dd <= todayEnd) : false;
    }).slice(0, 10);

    // 개인별 진도율
    const assigneeMap: Record<string, { total: number; done: number }> = {};
    for (const t of tasks) {
      const name = t.assigneeName || '미배정';
      if (!assigneeMap[name]) assigneeMap[name] = { total: 0, done: 0 };
      assigneeMap[name].total++;
      if (t.status === '완료') assigneeMap[name].done++;
    }
    const assigneeProgress = Object.entries(assigneeMap)
      .map(([name, d]) => ({ name, ...d, pct: d.total > 0 ? Math.round((d.done / d.total) * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct);

    return { weekDone, weekTotal, weekPct, delayed, todayDue, assigneeProgress };
  }, [tasks]);

  const ASSIGNEE_COLORS: Record<string, string> = { '최선아': 'var(--c-accent)', '송은정': 'var(--c-green)', '이웅해': 'var(--c-orange)' };

  const renderTaskSidebar = () => (
    <div className="tm-side-col">
      {/* 이번 주 완료율 */}
      <div className="sidebar-card">
        <div className="sidebar-title">이번 주 완료율</div>
        <div className="sidebar-stat-row">
          <span className="sidebar-big">{sidebarData.weekDone} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--c-text-3)' }}>/ {sidebarData.weekTotal} 완료</span></span>
          <span className="sidebar-pct" style={{ color: 'var(--c-green)' }}>{sidebarData.weekPct}%</span>
        </div>
        <div className="sidebar-bar">
          <div className="sidebar-bar-fill" style={{ width: `${sidebarData.weekPct}%`, background: 'var(--c-green)' }} />
        </div>
      </div>

      {/* 지연 경보 */}
      {sidebarData.delayed.length > 0 && (
        <div className="sidebar-card">
          <div className="sidebar-title" style={{ color: 'var(--c-red)' }}>지연 경보 ({sidebarData.delayed.length})</div>
          <div className="sidebar-list">
            {sidebarData.delayed.map((t) => (
              <div key={t.taskId} className="sidebar-list-item">
                <span className="sidebar-dot" style={{ background: 'var(--c-red)' }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                <span className="sidebar-meta">{t.assigneeName}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 오늘 마감 */}
      {sidebarData.todayDue.length > 0 && (
        <div className="sidebar-card">
          <div className="sidebar-title" style={{ color: 'var(--c-orange)' }}>오늘 마감 ({sidebarData.todayDue.length})</div>
          <div className="sidebar-list">
            {sidebarData.todayDue.map((t) => (
              <div key={t.taskId} className="sidebar-list-item">
                <span className="sidebar-dot" style={{ background: 'var(--c-orange)' }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                <span className="sidebar-meta">{t.assigneeName}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 개인별 진도율 */}
      <div className="sidebar-card">
        <div className="sidebar-title">개인별 진도율</div>
        {sidebarData.assigneeProgress.map((a) => {
          const barColor = ASSIGNEE_COLORS[a.name] || 'var(--c-text-4)';
          return (
            <div key={a.name} className="sidebar-progress-row">
              <span className="sidebar-progress-name">{a.name}</span>
              <div className="sidebar-progress-bar-wrap">
                <div className="sidebar-bar" style={{ margin: 0, flex: 1 }}>
                  <div className="sidebar-bar-fill" style={{ width: `${a.pct}%`, background: barColor }} />
                </div>
                <span className="sidebar-progress-pct" style={{ color: barColor }}>{a.pct}%</span>
              </div>
              <span className="sidebar-progress-detail">{a.done}/{a.total}</span>
            </div>
          );
        })}
      </div>

      {/* 팀원별 업무량 */}
      <div className="sidebar-card">
        <div className="sidebar-title">팀원별 업무량</div>
        {workload.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--c-text-3)', padding: '8px 0' }}>데이터 없음</div>
        ) : workload.map((w) => (
          <div key={w.name} className="sidebar-member-row">
            <span className="sidebar-member-name">{w.name}</span>
            <div className="sidebar-member-counts">
              <span className="sidebar-member-tag tag-progress">{w.progress}</span>
              <span className="sidebar-member-tag tag-done">{w.done}</span>
              {w.delayed > 0 && <span className="sidebar-member-tag tag-delayed">{w.delayed}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const handleSave = useCallback(
    async (data: Partial<Task>, keepFormOpen?: boolean) => {
      if (!user) return;
      try {
        if (data.taskId) {
          await update(data.taskId, data, user.uid, user.displayName || user.email || '');
        } else {
          const result = await create(data, user.uid);
          if (result.parentReactivated) {
            addToast(`"${result.parentReactivated}" 하위업무 추가로 진행중으로 변경되었습니다`);
          }
          if (result.warning) {
            alert(result.warning);
          }
        }
        if (!keepFormOpen) {
          setShowForm(false);
          setEditingTask(null);
          setParentForNewTask(null);
        }
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : '저장에 실패했습니다.');
      }
    },
    [user, create, update],
  );

  const handleStatusChange = useCallback(
    async (taskId: string, newStatus: TaskStatus) => {
      if (!user) return;
      const data: Partial<Task> = { status: newStatus };
      if (newStatus === '완료') {
        const { Timestamp } = await import('firebase/firestore');
        data.completedDate = Timestamp.now();
        data.progressRate = 100;
      }
      try {
        await update(taskId, data, user.uid, user.displayName || user.email || '');

        // 하위업무 전체 완료 시 상위업무 자동 완료
        if (newStatus === '완료') {
          const latest = tasksRef.current;
          const thisTask = latest.find((t) => t.taskId === taskId);
          if (thisTask?.parentTaskId) {
            const parentId = thisTask.parentTaskId;
            const siblings = latest.filter((t) => t.parentTaskId === parentId);
            if (siblings.length > 0) {
              const allDone = siblings.every((t) =>
                t.taskId === taskId ? true : t.status === '완료',
              );
              if (allDone) {
                const parent = latest.find((t) => t.taskId === parentId);
                const { Timestamp: Ts } = await import('firebase/firestore');
                const autoData: Partial<Task> = {
                  status: '완료',
                  completedDate: Ts.now(),
                  progressRate: 100,
                };
                await update(parentId, autoData, 'system', '자동완료');
                if (parent) {
                  addToast(`"${parent.title}" 이(가) 자동으로 완료 처리되었습니다`);
                }
              }
            }
          }
        }
      } catch {}
    },
    [user, update, addToast],
  );

  const handleDelete = useCallback(
    async (taskId: string) => {
      await del(taskId);
    },
    [del],
  );

  const handleAddSubTask = useCallback((parentId: string) => {
    setEditingTask(null);
    setParentForNewTask(parentId);
    setShowForm(true);
  }, []);

  const handleNotifClick = useCallback(() => {
    setView('list');
  }, []);

  // Google Tasks 동기화
  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await initGoogleTasks();
      if (!isGoogleSignedIn()) {
        await requestAccess();
      }

      // 캐시 초기화 (새 동기화 세션 시작)
      clearGoogleTasksCache();

      // Firestore → Google Tasks
      // googleTaskId가 이미 있으면 업데이트, 없으면 notes의 taskId 태그로 중복 확인 후 생성
      const syncedIds = new Set<string>(); // 이번 세션에서 처리된 googleTaskId 추적
      for (const t of tasks) {
        const returnedId = await syncTaskToGoogleTasks(t);
        if (returnedId) {
          syncedIds.add(returnedId);
          if (!t.googleTaskId && user) {
            await update(t.taskId, { googleTaskId: returnedId }, user.uid, user.displayName || user.email || '');
          }
        }
      }

      // Google Tasks → Firestore (역동기화)
      // firestoreTaskId가 없고, 이번 동기화에서 생성된 것도 아닌 순수 Google 측 태스크만 가져옴
      const googleTasks = await fetchGoogleTasks();
      // Firestore에 이미 연결된 googleTaskId 목록
      const existingGoogleIds = new Set(
        tasks.filter(t => t.googleTaskId).map(t => t.googleTaskId!)
      );

      for (const gt of googleTasks) {
        // 이미 Firestore에 연결된 태스크면 스킵
        if (gt.firestoreTaskId) continue;
        // 이번 동기화에서 방금 생성/업데이트된 것이면 스킵
        if (syncedIds.has(gt.googleTaskId)) continue;
        // Firestore tasks에 이미 이 googleTaskId가 있으면 스킵
        if (existingGoogleIds.has(gt.googleTaskId)) continue;

        if (gt.title && user) {
          await create({
            title: gt.title,
            description: '',
            assignee: '',
            assigneeName: user.displayName || '',
            category: categories[0] || '일반업무',
            status: gt.status === 'completed' ? '완료' : '대기',
            parentTaskId: null,
            dueDate: gt.due ? (await import('firebase/firestore')).Timestamp.fromDate(new Date(gt.due)) : null,
            completedDate: null,
            progressRate: gt.status === 'completed' ? 100 : 0,
            notes: '',
            isRecurring: false,
            recurrenceRule: null,
            ceoFlag: false,
            ceoFlagReason: '',
            googleTaskId: gt.googleTaskId,
            startDate: null,
            kpiLinked: null,
          }, user.uid);
        }
      }

      // 캐시 정리
      clearGoogleTasksCache();

      setLastSyncTime();
      setLastSync(new Date().toISOString());
      alert('Google Tasks 동기화 완료!');
    } catch (err: unknown) {
      clearGoogleTasksCache();
      const msg = err instanceof Error ? err.message : String(err);
      const detail = (err as any)?.result?.error?.message || '';
      alert(`동기화 실패:\n${msg}${detail ? '\n\n상세: ' + detail : ''}\n\n[확인사항]\n1. Google Cloud Console에서 Tasks API 활성화\n2. OAuth 승인된 JavaScript 출처에 현재 도메인 추가`);
      console.error('Google Tasks 동기화 에러:', err);
    } finally {
      setSyncing(false);
    }
  }, [tasks, user, create, update, categories]);

  // 로그인 화면
  if (authLoading) return <div className="tm"><div className="tm-loading">로딩 중...</div></div>;

  if (!user) {
    return (
      <div className="tm">
        <div className="tm-login">
          <h2>업무관리 시스템</h2>
          <p>Google 계정으로 로그인하세요</p>
          <button className="tm-btn-google" onClick={signIn}>
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 002.38-5.88c0-.57-.05-.66-.15-1.18z" fill="#4285F4"/>
              <path d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 01-7.18-2.54H1.83v2.07A8 8 0 008.98 17z" fill="#34A853"/>
              <path d="M4.5 10.52a4.8 4.8 0 010-3.04V5.41H1.83a8 8 0 000 7.18l2.67-2.07z" fill="#FBBC05"/>
              <path d="M8.98 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8 8 0 001.83 5.4l2.67 2.07A4.77 4.77 0 018.98 3.58z" fill="#EA4335"/>
            </svg>
            Google로 로그인
          </button>
        </div>
      </div>
    );
  }

  const userName = user.displayName || user.email || '';

  return (
    <div className="tm">
      {/* 탭 + 알림 */}
      <div className="tm-tabs">
        <button className={`tm-tab ${view === 'kpi' ? 'active' : ''}`} onClick={() => setView('kpi')}>
          KPI
        </button>
        <button className={`tm-tab ${view === 'weekly' ? 'active' : ''}`} onClick={() => setView('weekly')}>
          이번 주
        </button>
        <button className={`tm-tab ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>
          업무관리
        </button>
        <button className={`tm-tab ${view === 'matrix' ? 'active' : ''}`} onClick={() => setView('matrix')}>
          매트릭스
        </button>
        <button className={`tm-tab ${view === 'report' ? 'active' : ''}`} onClick={() => setView('report')}>
          회의 자료
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <NotificationCenter
            notifications={notifications}
            unreadCount={unreadCount}
            onRead={read}
            onReadAll={readAll}
            onClickNotif={handleNotifClick}
          />
          <button
            onClick={() => setShowSettings(true)}
            style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--tm-ink-tertiary)' }}
            title="설정"
          >
            &#9881;
          </button>
          <span style={{ fontSize: 11, color: 'var(--tm-ink-tertiary)' }}>{userName}</span>
          <button
            onClick={signOut}
            style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--tm-ink-tertiary)', cursor: 'pointer', fontFamily: 'var(--tm-font)' }}
          >
            로그아웃
          </button>
        </div>
      </div>

      {/* Google Tasks 동기화 바 */}
      <div className="tm-sync-bar">
        <button className="tm-sync-btn" onClick={handleSync} disabled={syncing}>
          {syncing ? '동기화 중...' : '&#x21BB; Google Tasks 동기화'}
        </button>
        <span>
          {lastSync
            ? `마지막 동기화: ${new Date(lastSync).toLocaleString('ko-KR')}`
            : '동기화 기록 없음'}
        </span>
      </div>

      {error && <div className="tm-error">{error}</div>}

      {/* ─── 상단 pill 배너 ─── */}
      {view === 'list' && (
        <div className="tm-stats-pills">
          <span className="tm-pill pill-blue">{stats.total} 전체</span>
          <span className="tm-pill pill-orange">{stats.inProgress} 진행</span>
          <span className="tm-pill pill-green">{stats.done} 완료</span>
          <span className="tm-pill pill-red">{stats.delayed} 지연</span>
          {mappedMember && (
            <button className={`tm-pill pill-toggle ${assigneeFilter !== mappedMember.name ? 'active' : ''}`} onClick={() => {
              setAssigneeFilter(assigneeFilter === mappedMember.name ? '' : mappedMember.name);
            }}>
              {assigneeFilter === mappedMember.name ? `${mappedMember.name} 업무` : '전체 보기 중'}
            </button>
          )}
        </div>
      )}
      {view === 'weekly' && (
        <div className="tm-stats-pills">
          {weeklyPills.todayTasks.length > 0 && (
            <span className="tm-pill pill-red">{weeklyPills.todayLabel} 마감 {weeklyPills.todayTasks.length}건</span>
          )}
          {weeklyPills.soonTasks.length > 0 && (
            <span className="tm-pill pill-orange">{weeklyPills.soonLabel} 마감 {weeklyPills.soonTasks.length}건</span>
          )}
          {weeklyPills.newTasks.length > 0 && (
            <span className="tm-pill pill-blue">신규 {weeklyPills.newTasks.length}건</span>
          )}
          <span className="tm-pill pill-green">완료 {weeklyPills.doneTasks.length}건</span>
          {mappedMember && (
            <button className={`tm-pill pill-toggle ${assigneeFilter !== mappedMember.name ? 'active' : ''}`} onClick={() => {
              setAssigneeFilter(assigneeFilter === mappedMember.name ? '' : mappedMember.name);
            }}>
              {assigneeFilter === mappedMember.name ? `${mappedMember.name} 업무` : '전체 보기 중'}
            </button>
          )}
        </div>
      )}

      {/* ═══ 이번 주 뷰 ═══ */}
      {view === 'weekly' && (
        <>
          {/* 필터 */}
          <div className="tm-controls" style={{ marginBottom: 12 }}>
            <div className="tm-select-group">
              <select className="tm-select" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
                <option value="">전체 담당자</option>
                {members.length > 0
                  ? members.map((m) => <option key={m.memberId} value={m.name}>{m.name}</option>)
                  : assigneeNames.map((n) => <option key={n} value={n}>{n}</option>)
                }
              </select>
              <select className="tm-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="전체">전체 카테고리</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="tm-select" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                <option value="">전체 월</option>
                {monthOptions.map((m) => {
                  const [y, mo] = m.split('-');
                  return <option key={m} value={m}>{y}년 {Number(mo)}월</option>;
                })}
              </select>
            </div>
          </div>

          <div className="tm-dashboard-layout">
          <div className="tm-main-col">
          {/* 날짜별 그룹 */}
          <div className="tm-weekly-view">
            {weeklyGroups.length === 0 && (
              <div className="tm-empty">이번 주 업무가 없습니다.</div>
            )}
            {weeklyGroups.map((group) => (
              <div key={group.dateKey} className="week-group">
                <div className={`week-date-header week-hdr-${group.colorClass}`}>
                  <span className="week-date-label">{group.label}</span>
                  {group.subLabel && <span className="week-date-sub">{group.subLabel}</span>}
                  <span className="week-date-count">{group.tasks.length}건</span>
                </div>
                <div className="week-cards">
                  {group.tasks.map((t) => {
                    const dd = t.dueDate?.toDate?.();
                    const dLeft = dd ? differenceInDays(dd, new Date()) : null;
                    const chipClass = dLeft !== null && dLeft < 0 ? 'chip-danger' : dLeft !== null && dLeft <= 2 ? 'chip-warning' : 'chip-info';
                    const isNew = !t.isNewDismissed && t.createdAt && differenceInDays(new Date(), t.createdAt instanceof Timestamp ? t.createdAt.toDate() : new Date(t.createdAt as unknown as string)) <= 7;

                    return (
                      <div key={t.taskId} className={`week-card ${isNew ? 'week-card-new' : ''} ${dLeft !== null && dLeft < 0 ? 'week-card-delayed' : ''}`} onClick={() => { setEditingTask(t); setParentForNewTask(null); setShowForm(true); }}>
                        <div className="week-card-top">
                          <StatusDropdownInline current={t.status} onChange={(s) => handleStatusChange(t.taskId, s)} />
                          <span className="week-card-title">{t.title}</span>
                          {isNew && (
                            <span className="week-new-badge" onClick={(e) => { e.stopPropagation(); handleDismissNew(t.taskId); }}>NEW</span>
                          )}
                          {dd && (
                            <span className={`week-chip ${chipClass}`}>
                              {`${dd.getMonth()+1}.${String(dd.getDate()).padStart(2,'0')}`}
                            </span>
                          )}
                        </div>
                        <div className="week-card-bottom">
                          {t.assigneeName && <span className="week-assignee">{t.assigneeName}</span>}
                          {t.progressRate > 0 && <span className="week-progress">{t.progressRate}%</span>}
                          {t.importance === 'high' && <span className="week-importance">중요</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          </div>
          {renderTaskSidebar()}
          </div>
        </>
      )}

      {view === 'list' && (
        <>
          {/* 통계 카드 — 기존 호환 유지 */}
          <div className="tm-stats" style={{ display: 'none' }}>
          </div>

          {urgentTasks.length > 0 && (
            <div className="tm-alert-banner">
              <span className="alert-dot" />
              긴급 업무 {urgentTasks.length}건: {urgentTasks.slice(0, 3).map((t) => t.title).join(', ')}
              {urgentTasks.length > 3 && ` 외 ${urgentTasks.length - 3}건`}
            </div>
          )}

          <div className="tm-dashboard-layout">
            <div className="tm-main-col">
              {/* 필터바 */}
              <div className="tm-controls">
                <div className="tm-filters">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`tm-filter ${statusFilter === opt.value ? 'active' : ''}`}
                      onClick={() => setStatusFilter(opt.value as TaskStatus | '')}
                    >
                      {opt.label}
                      <span className="tm-filter-count">
                        {opt.value === '' ? stats.total : tasks.filter((t) => t.status === opt.value).length}
                      </span>
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div className="tm-select-group">
                    <select className="tm-select" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                      <option value="">전체 월</option>
                      {monthOptions.map((m) => {
                        const [y, mo] = m.split('-');
                        return <option key={m} value={m}>{y}년 {Number(mo)}월</option>;
                      })}
                    </select>
                    <select className="tm-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                      <option value="전체">전체 카테고리</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <select className="tm-select" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
                      <option value="">전체 담당자</option>
                      {members.length > 0
                        ? members.map((m) => (
                            <option key={m.memberId} value={m.name}>{m.name}</option>
                          ))
                        : Array.from(new Set(tasks.map((t) => t.assigneeName).filter(Boolean))).map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))
                      }
                    </select>
                  </div>
                  <button className="tm-btn-add" onClick={() => { setEditingTask(null); setParentForNewTask(null); setShowForm(true); }}>
                    + 업무 추가
                  </button>
                </div>
              </div>

              {/* 업무 목록 (카테고리 > 상위 > 하위) */}
              {loading ? (
                <div className="tm-loading">업무를 불러오는 중...</div>
              ) : (
                <div className="tm-tasks">
                  {categoryGroups.length === 0 && tasks.length === 0 && (
                    <div className="tm-empty">등록된 업무가 없습니다.</div>
                  )}
                  {categoryGroups.map((group) => (
                    <CategorySection
                      key={group.category}
                      category={group.category}
                      parentTasks={group.tasks}
                      childMap={childMap}
                      currentUserName={userName}
                      onStatusChange={handleStatusChange}
                      onEdit={(t) => { setEditingTask(t); setParentForNewTask(null); setShowForm(true); }}
                      onDelete={handleDelete}
                      onAddSubTask={handleAddSubTask}
                    />
                  ))}
                </div>
              )}
            </div>

            {renderTaskSidebar()}
          </div>
        </>
      )}

      {view === 'matrix' && (
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          <EisenhowerMatrix
            tasks={tasks}
            onQuadrantChange={async (taskId: string, quadrant: Quadrant) => {
              if (!user) return;
              const task = tasks.find(t => t.taskId === taskId);
              const now = new Date();
              const updates: Partial<Task> = {};

              // 사분면별 마감일
              const dueDaysMap: Record<string, number> = { q1: 0, q3: 2, q2: 7, q4: 14 };
              const newDue = addDays(now, dueDaysMap[quadrant]);

              // 기존 마감일이 더 촉박하면 덮어쓰지 않음
              const existingDue = task?.dueDate instanceof Timestamp ? task.dueDate.toDate() : null;
              if (!existingDue || newDue < existingDue) {
                updates.dueDate = Timestamp.fromDate(newDue);
              }

              // 중요도
              const isImportant = quadrant === 'q1' || quadrant === 'q2';
              updates.importance = isImportant ? 'high' : 'normal';
              updates.ceoFlag = quadrant === 'q1' && (task?.ceoFlag || false);
              updates.priority = isImportant ? '높음' : '보통';

              try {
                await update(taskId, updates, user.uid, user.displayName || user.email || '');
                // 토스트 메시지
                if (updates.dueDate) {
                  const d = newDue;
                  addToast(`마감일이 ${d.getMonth()+1}.${String(d.getDate()).padStart(2,'0')}(으)로 조정되었습니다`);
                }
              } catch {}
            }}
          />
        </div>
      )}

      {view === 'report' && <MeetingReportPanel ceoMeetingDates={ceoMeetingDates} />}

      {view === 'kpi' && <KpiPanel />}

      {showForm && (
        <TaskForm
          task={editingTask}
          tasks={tasks}
          members={members}
          categories={categories}
          userName={userName}
          onSave={(data, keepFormOpen) => {
            // 하위업무 추가 시 parentTaskId 자동 설정
            if (parentForNewTask && !data.taskId) {
              data.parentTaskId = parentForNewTask;
            }
            handleSave(data, keepFormOpen);
          }}
          onClose={() => { setShowForm(false); setEditingTask(null); setParentForNewTask(null); }}
        />
      )}

      {showSettings && (
        <SettingsPanel
          taskCategories={categories}
          kpiCategories={kpiCategories}
          ceoMeetingDates={ceoMeetingDates}
          onSaveTaskCategories={saveTaskCategories}
          onSaveKpiCategories={saveKpiCategories}
          onSaveCeoMeetingDates={saveCeoMeetingDates}
          onClose={() => setShowSettings(false)}
          userId={user?.uid}
        />
      )}

      {/* 인앱 토스트 */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className="toast-item toast-success">
              <span className="toast-icon">✓</span>
              <span className="toast-msg">{t.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
