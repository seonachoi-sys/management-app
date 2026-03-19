import React, { useState, useMemo, useCallback } from 'react';
import type { Task, TaskStatus } from '../types';
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
} from '../services/googleTasksService';
import TaskCard from './TaskCard';
import TaskForm from './TaskForm';
import MeetingReportPanel from './MeetingReportPanel';
import NotificationCenter from './NotificationCenter';
import SettingsPanel from './SettingsPanel';
import KpiPanel from './KpiPanel';
import EisenhowerMatrix from './EisenhowerMatrix';
import type { Quadrant } from './EisenhowerMatrix';
import { Timestamp } from 'firebase/firestore';
import { addDays } from 'date-fns';
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
              childTasks={childMap[task.taskId] || []}
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

const STATUS_OPTIONS: { value: TaskStatus | ''; label: string }[] = [
  { value: '', label: '전체' },
  { value: '대기', label: '대기' },
  { value: '진행중', label: '진행중' },
  { value: '완료', label: '완료' },
  { value: '지연', label: '지연' },
  { value: '보류', label: '보류' },
];

export default function TaskDashboard() {
  const { user, loading: authLoading, signIn, signOut } = useAuth();
  const { categories, kpiCategories, saveTaskCategories, saveKpiCategories } = useSettings();

  // localStorage → Firestore 마이그레이션
  useMigration(user?.uid);

  const [view, setView] = useState<'list' | 'matrix' | 'report' | 'kpi'>('kpi');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');
  const [categoryFilter, setCategoryFilter] = useState('전체');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState(''); // 'YYYY-MM' or ''
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [parentForNewTask, setParentForNewTask] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(getLastSyncTime());

  const filters: TaskFilters = useMemo(() => {
    const f: TaskFilters = {};
    if (statusFilter) f.status = statusFilter;
    if (categoryFilter !== '전체') f.category = categoryFilter;
    if (assigneeFilter) f.assignee = assigneeFilter;
    return f;
  }, [statusFilter, categoryFilter, assigneeFilter]);

  const { tasks, loading, error } = useTasks(filters);
  const { members } = useMembers();
  const { notifications, unreadCount, read, readAll } = useNotifications(user?.uid);
  const { create } = useCreateTask();
  const { update } = useUpdateTask();
  const { del } = useDeleteTask();

  // 월별 필터 옵션 생성
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

  // 월별 필터 적용된 업무
  const filteredTasks = useMemo(() => {
    if (!monthFilter) return tasks;
    const [y, m] = monthFilter.split('-').map(Number);
    return tasks.filter((t) => {
      const sd = t.startDate?.toDate?.();
      const dd = t.dueDate?.toDate?.();
      if (sd && sd.getFullYear() === y && sd.getMonth() + 1 === m) return true;
      if (dd && dd.getFullYear() === y && dd.getMonth() + 1 === m) return true;
      // 상위업무는 날짜 없어도 하위업무가 해당 월에 있으면 포함
      if (!t.parentTaskId && !sd && !dd) return true;
      return false;
    });
  }, [tasks, monthFilter]);

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

  const handleSave = useCallback(
    async (data: Partial<Task>, keepFormOpen?: boolean) => {
      if (!user) return;
      try {
        if (data.taskId) {
          await update(data.taskId, data, user.uid, user.displayName || user.email || '');
        } else {
          const result = await create(data, user.uid);
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
      } catch {}
    },
    [user, update],
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
      // Firestore → Google Tasks
      for (const t of tasks) {
        await syncTaskToGoogleTasks(t);
      }
      // Google Tasks → Firestore (신규 태스크)
      const googleTasks = await fetchGoogleTasks();
      for (const gt of googleTasks) {
        if (!gt.firestoreTaskId && gt.title && user) {
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
      setLastSyncTime();
      setLastSync(new Date().toISOString());
      alert('Google Tasks 동기화 완료!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const detail = (err as any)?.result?.error?.message || '';
      alert(`동기화 실패:\n${msg}${detail ? '\n\n상세: ' + detail : ''}\n\n[확인사항]\n1. Google Cloud Console에서 Tasks API 활성화\n2. OAuth 승인된 JavaScript 출처에 현재 도메인 추가`);
      console.error('Google Tasks 동기화 에러:', err);
    } finally {
      setSyncing(false);
    }
  }, [tasks, user, create, categories]);

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

      {view === 'list' && (
        <>
          {/* 통계 카드 */}
          <div className="tm-stats">
            <div className="tm-stat-card stat-total">
              <div className="tm-stat-label">전체 업무</div>
              <div className="tm-stat-value">{stats.total}</div>
            </div>
            <div className="tm-stat-card stat-progress">
              <div className="tm-stat-label">진행중</div>
              <div className="tm-stat-value">{stats.inProgress}</div>
            </div>
            <div className="tm-stat-card stat-done">
              <div className="tm-stat-label">완료</div>
              <div className="tm-stat-value">{stats.done}</div>
            </div>
            <div className="tm-stat-card stat-delayed">
              <div className="tm-stat-label">지연</div>
              <div className="tm-stat-value">{stats.delayed}</div>
            </div>
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
                            <option key={m.memberId} value={m.memberId}>{m.name}</option>
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

            <div className="tm-side-col">
              <div className="tm-workload-card">
                <div className="tm-workload-title">팀원별 업무량</div>
                {workload.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--tm-ink-tertiary)', padding: '16px 0' }}>
                    업무 데이터 없음
                  </div>
                ) : (
                  workload.map((w) => (
                    <div key={w.name} className="tm-workload-item">
                      <div className="tm-workload-name">{w.name}</div>
                      <div className="tm-workload-counts">
                        <span className="tm-workload-count tm-wc-progress">{w.progress}</span>
                        <span className="tm-workload-count tm-wc-done">{w.done}</span>
                        {w.delayed > 0 && (
                          <span className="tm-workload-count tm-wc-delayed">{w.delayed}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {view === 'matrix' && (
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          <EisenhowerMatrix
            tasks={tasks}
            onQuadrantChange={async (taskId: string, quadrant: Quadrant) => {
              if (!user) return;
              // 사분면에 따라 마감일/중요도 업데이트
              const now = new Date();
              const updates: Partial<Task> = {};

              const isUrgent = quadrant === 'q1' || quadrant === 'q3';
              const isImportant = quadrant === 'q1' || quadrant === 'q2';

              // 긴급 → 마감일을 내일로, 비긴급 → 7일 후
              if (isUrgent) {
                updates.dueDate = Timestamp.fromDate(addDays(now, 1));
              } else {
                updates.dueDate = Timestamp.fromDate(addDays(now, 7));
              }

              // 중요 → CEO 플래그 or 높은 우선순위
              updates.ceoFlag = isImportant && (quadrant === 'q1');
              updates.priority = isImportant ? '높음' : '보통';

              try {
                await update(taskId, updates, user.uid, user.displayName || user.email || '');
              } catch {}
            }}
          />
        </div>
      )}

      {view === 'report' && <MeetingReportPanel />}

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
          onSaveTaskCategories={saveTaskCategories}
          onSaveKpiCategories={saveKpiCategories}
          onClose={() => setShowSettings(false)}
          userId={user?.uid}
        />
      )}
    </div>
  );
}
