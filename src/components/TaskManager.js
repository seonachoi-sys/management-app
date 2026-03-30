import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './TaskManager.css';

/* ─── helpers ─── */
const LS_KEY = 'ts-tasks';
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const loadTasks = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || [];
  } catch {
    return [];
  }
};
const saveTasks = (tasks) =>
  localStorage.setItem(LS_KEY, JSON.stringify(tasks));

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* 자동 우선순위 계산 */
const calcPriority = (task) => {
  if (task.status === 'done') return task.manualPriority || 'low';
  const due = task.dueDate ? new Date(task.dueDate) : null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  let base = 'low';
  if (due) {
    const diff = (due - now) / 86400000;
    if (diff < 0) base = 'urgent';
    else if (diff <= 2) base = 'high';
    else if (diff <= 7) base = 'medium';
  }
  // 대표이사 결정사항은 한 단계 상향
  if (task.isCeoDecision) {
    const bump = { low: 'medium', medium: 'high', high: 'urgent', urgent: 'urgent' };
    base = bump[base];
  }
  return base;
};

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_LABEL = { urgent: '긴급', high: '높음', medium: '보통', low: '낮음' };
const STATUS_LABEL = { todo: '할일', 'in-progress': '진행중', done: '완료' };

/* 날짜 유틸 */
const getMonday = (d) => {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = addDays(dt, diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
};

const fmt = (dateStr) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const fmtFull = (dateStr) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

/* ─── 메인 컴포넌트 ─── */
export default function TaskManager() {
  const [tasks, setTasks] = useState(loadTasks);
  const [view, setView] = useState('list'); // list | report
  const [reportType, setReportType] = useState('weekly');
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [filter, setFilter] = useState('all'); // all | todo | in-progress | done

  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  /* 우선순위 자동 적용 후 정렬 */
  const enriched = useMemo(
    () =>
      tasks
        .map((t) => ({ ...t, priority: calcPriority(t) }))
        .sort((a, b) => {
          if (a.status === 'done' && b.status !== 'done') return 1;
          if (a.status !== 'done' && b.status === 'done') return -1;
          return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        }),
    [tasks],
  );

  const filtered = useMemo(
    () => (filter === 'all' ? enriched : enriched.filter((t) => t.status === filter)),
    [enriched, filter],
  );

  /* CRUD */
  const upsertTask = useCallback(
    (task) => {
      setTasks((prev) => {
        const exists = prev.find((t) => t.id === task.id);
        if (exists) return prev.map((t) => (t.id === task.id ? { ...t, ...task } : t));
        return [...prev, { ...task, id: uid(), createdAt: todayLocal() }];
      });
      setShowForm(false);
      setEditingTask(null);
    },
    [],
  );

  const deleteTask = useCallback((id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleStatus = useCallback((id) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const next =
          t.status === 'todo'
            ? 'in-progress'
            : t.status === 'in-progress'
              ? 'done'
              : 'todo';
        return {
          ...t,
          status: next,
          completedAt: next === 'done' ? todayLocal() : null,
        };
      }),
    );
  }, []);

  /* ─── 회의록 생성 ─── */
  const generateReport = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const monday = getMonday(now);

    if (reportType === 'weekly') {
      // 주간: 지난주 완료/미완료 + 금주 업무
      const lastMonday = addDays(monday, -7);
      const lastSunday = addDays(monday, -1);
      const thisSunday = addDays(monday, 6);

      const lastWeekDone = enriched.filter(
        (t) =>
          t.completedAt &&
          new Date(t.completedAt) >= lastMonday &&
          new Date(t.completedAt) <= lastSunday,
      );
      const lastWeekUndone = enriched.filter(
        (t) =>
          t.status !== 'done' &&
          t.dueDate &&
          new Date(t.dueDate) >= lastMonday &&
          new Date(t.dueDate) <= lastSunday,
      );
      // 기한이 지났지만 미완료 (이월)
      const carryOver = enriched.filter(
        (t) =>
          t.status !== 'done' &&
          t.dueDate &&
          new Date(t.dueDate) < monday,
      );
      const thisWeek = enriched.filter(
        (t) =>
          t.status !== 'done' &&
          t.dueDate &&
          new Date(t.dueDate) >= monday &&
          new Date(t.dueDate) <= thisSunday,
      );

      return {
        title: `주간업무 보고 (${fmtFull(monday.toISOString())} ~ ${fmtFull(thisSunday.toISOString())})`,
        sections: [
          { label: '지난주 완료 업무', tasks: lastWeekDone, empty: '완료 업무 없음' },
          { label: '지난주 미완료 업무', tasks: lastWeekUndone, empty: '미완료 업무 없음' },
          { label: '이월 업무 (기한 초과)', tasks: carryOver, empty: '이월 업무 없음' },
          { label: '금주 업무', tasks: thisWeek, empty: '금주 예정 업무 없음' },
        ],
      };
    }

    if (reportType === 'biweekly') {
      // 2주 단위: 대표이사 보고
      const twoWeeksAgo = addDays(monday, -14);
      const lastSunday = addDays(monday, -1);
      const nextSunday = addDays(monday, 13);

      const past2wDone = enriched.filter(
        (t) =>
          t.completedAt &&
          new Date(t.completedAt) >= twoWeeksAgo &&
          new Date(t.completedAt) <= lastSunday,
      );
      const past2wUndone = enriched.filter(
        (t) =>
          t.status !== 'done' &&
          t.dueDate &&
          new Date(t.dueDate) >= twoWeeksAgo &&
          new Date(t.dueDate) <= lastSunday,
      );
      const next2w = enriched.filter(
        (t) =>
          t.status !== 'done' &&
          t.dueDate &&
          new Date(t.dueDate) >= monday &&
          new Date(t.dueDate) <= nextSunday,
      );
      const ceoDecisions = enriched.filter((t) => t.isCeoDecision && t.status !== 'done');

      return {
        title: `대표이사 2주 보고 (${fmtFull(twoWeeksAgo.toISOString())} ~ ${fmtFull(lastSunday.toISOString())})`,
        sections: [
          { label: '지난 2주 완료 업무', tasks: past2wDone, empty: '완료 업무 없음' },
          { label: '지난 2주 미완료 업무', tasks: past2wUndone, empty: '미완료 업무 없음' },
          { label: '향후 2주 예정 업무', tasks: next2w, empty: '예정 업무 없음' },
          { label: '대표이사 결정사항 (미완료)', tasks: ceoDecisions, empty: '미결 결정사항 없음', highlight: true },
        ],
      };
    }

    // monthly
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

    const monthDone = enriched.filter(
      (t) =>
        t.completedAt &&
        new Date(t.completedAt) >= monthStart &&
        new Date(t.completedAt) <= monthEnd,
    );
    const monthUndone = enriched.filter(
      (t) =>
        t.status !== 'done' &&
        t.dueDate &&
        new Date(t.dueDate) >= monthStart &&
        new Date(t.dueDate) <= monthEnd,
    );
    const nextMonth = enriched.filter(
      (t) =>
        t.status !== 'done' &&
        t.dueDate &&
        new Date(t.dueDate) > monthEnd &&
        new Date(t.dueDate) <= nextMonthEnd,
    );
    const carryOver = enriched.filter(
      (t) => t.status !== 'done' && t.dueDate && new Date(t.dueDate) < monthStart,
    );
    const collabTasks = enriched.filter(
      (t) => t.status !== 'done' && t.collaborationTeam,
    );

    return {
      title: `월간업무 보고 (${now.getFullYear()}년 ${now.getMonth() + 1}월)`,
      sections: [
        { label: '이번달 완료 업무', tasks: monthDone, empty: '완료 업무 없음' },
        { label: '이번달 미완료 업무', tasks: monthUndone, empty: '미완료 업무 없음' },
        { label: '이월 업무', tasks: carryOver, empty: '이월 업무 없음' },
        { label: '다음달 예정 업무', tasks: nextMonth, empty: '예정 업무 없음' },
        { label: '협업 필요 업무', tasks: collabTasks, empty: '협업 필요 업무 없음', highlight: true },
      ],
    };
  }, [enriched, reportType]);

  /* ─── 회의록 텍스트 복사 ─── */
  const copyReport = () => {
    const report = generateReport;
    let text = `${report.title}\n${'='.repeat(40)}\n\n`;
    report.sections.forEach((s) => {
      text += `■ ${s.label}\n`;
      if (s.tasks.length === 0) {
        text += `  ${s.empty}\n\n`;
      } else {
        s.tasks.forEach((t) => {
          const pri = PRIORITY_LABEL[t.priority];
          const due = t.dueDate ? fmtFull(t.dueDate) : '기한없음';
          const status = STATUS_LABEL[t.status];
          text += `  - [${status}][${pri}] ${t.title} (마감: ${due})`;
          if (t.isCeoDecision) text += ' ★대표이사결정';
          if (t.collaborationTeam) text += ` [협업:${t.collaborationTeam}]`;
          text += '\n';
          if (t.description) text += `    → ${t.description}\n`;
        });
        text += '\n';
      }
    });
    navigator.clipboard.writeText(text);
    alert('회의록이 클립보드에 복사되었습니다.');
  };

  /* ─── 렌더 ─── */
  return (
    <div className="tm">
      {/* 탭 */}
      <div className="tm-tabs">
        <button
          className={`tm-tab ${view === 'list' ? 'active' : ''}`}
          onClick={() => setView('list')}
        >
          업무 목록
        </button>
        <button
          className={`tm-tab ${view === 'report' ? 'active' : ''}`}
          onClick={() => setView('report')}
        >
          회의록 자동생성
        </button>
      </div>

      {view === 'list' && (
        <div className="tm-list-view">
          {/* 상단 컨트롤 */}
          <div className="tm-controls">
            <div className="tm-filters">
              {['all', 'todo', 'in-progress', 'done'].map((f) => (
                <button
                  key={f}
                  className={`tm-filter ${filter === f ? 'active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? '전체' : STATUS_LABEL[f]}
                  <span className="tm-filter-count">
                    {f === 'all'
                      ? enriched.length
                      : enriched.filter((t) => t.status === f).length}
                  </span>
                </button>
              ))}
            </div>
            <button
              className="tm-btn-add"
              onClick={() => {
                setEditingTask(null);
                setShowForm(true);
              }}
            >
              + 업무 추가
            </button>
          </div>

          {/* 업무 리스트 */}
          <div className="tm-tasks">
            {filtered.length === 0 && (
              <div className="tm-empty">등록된 업무가 없습니다.</div>
            )}
            {filtered.map((task) => (
              <div
                key={task.id}
                className={`tm-task ${task.status === 'done' ? 'tm-task-done' : ''}`}
              >
                <button
                  className={`tm-status-btn tm-status-${task.status}`}
                  onClick={() => toggleStatus(task.id)}
                  title="상태 변경"
                >
                  {task.status === 'done'
                    ? '✓'
                    : task.status === 'in-progress'
                      ? '▶'
                      : '○'}
                </button>
                <div className="tm-task-body">
                  <div className="tm-task-header">
                    <span className="tm-task-title">{task.title}</span>
                    <span className={`tm-priority tm-priority-${task.priority}`}>
                      {PRIORITY_LABEL[task.priority]}
                    </span>
                    {task.isCeoDecision && (
                      <span className="tm-badge tm-badge-ceo">대표이사</span>
                    )}
                    {task.collaborationTeam && (
                      <span className="tm-badge tm-badge-collab">
                        협업:{task.collaborationTeam}
                      </span>
                    )}
                  </div>
                  {task.description && (
                    <div className="tm-task-desc">{task.description}</div>
                  )}
                  <div className="tm-task-meta">
                    {task.assignee && <span>담당: {task.assignee}</span>}
                    {task.dueDate && <span>마감: {fmt(task.dueDate)}</span>}
                    <span>등록: {fmt(task.createdAt)}</span>
                  </div>
                </div>
                <div className="tm-task-actions">
                  <button
                    onClick={() => {
                      setEditingTask(task);
                      setShowForm(true);
                    }}
                    title="수정"
                  >
                    수정
                  </button>
                  <button onClick={() => deleteTask(task.id)} title="삭제">
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'report' && (
        <div className="tm-report-view">
          <div className="tm-report-tabs">
            {[
              { key: 'weekly', label: '주간 (팀)' },
              { key: 'biweekly', label: '2주 (대표이사)' },
              { key: 'monthly', label: '월간 (전체)' },
            ].map((r) => (
              <button
                key={r.key}
                className={`tm-report-tab ${reportType === r.key ? 'active' : ''}`}
                onClick={() => setReportType(r.key)}
              >
                {r.label}
              </button>
            ))}
            <button className="tm-btn-copy" onClick={copyReport}>
              클립보드 복사
            </button>
          </div>

          <div className="tm-report-content">
            <h2 className="tm-report-title">{generateReport.title}</h2>
            {generateReport.sections.map((section, i) => (
              <div
                key={i}
                className={`tm-report-section ${section.highlight ? 'tm-report-highlight' : ''}`}
              >
                <h3>{section.label}</h3>
                {section.tasks.length === 0 ? (
                  <p className="tm-report-empty">{section.empty}</p>
                ) : (
                  <table className="tm-report-table">
                    <thead>
                      <tr>
                        <th>상태</th>
                        <th>우선순위</th>
                        <th>업무</th>
                        <th>담당</th>
                        <th>마감</th>
                        <th>비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.tasks.map((t) => (
                        <tr key={t.id}>
                          <td>
                            <span className={`tm-status-dot tm-status-${t.status}`}>
                              {STATUS_LABEL[t.status]}
                            </span>
                          </td>
                          <td>
                            <span className={`tm-priority tm-priority-${t.priority}`}>
                              {PRIORITY_LABEL[t.priority]}
                            </span>
                          </td>
                          <td>
                            <strong>{t.title}</strong>
                            {t.description && (
                              <div className="tm-report-desc">{t.description}</div>
                            )}
                          </td>
                          <td>{t.assignee || '-'}</td>
                          <td>{t.dueDate ? fmtFull(t.dueDate) : '-'}</td>
                          <td>
                            {t.isCeoDecision && '★대표이사결정 '}
                            {t.collaborationTeam && `[협업:${t.collaborationTeam}]`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 업무 추가/수정 모달 */}
      {showForm && (
        <TaskForm
          task={editingTask}
          onSave={upsertTask}
          onClose={() => {
            setShowForm(false);
            setEditingTask(null);
          }}
        />
      )}
    </div>
  );
}

/* ─── 업무 폼 ─── */
function TaskForm({ task, onSave, onClose }) {
  const [form, setForm] = useState(
    task || {
      title: '',
      description: '',
      assignee: '',
      dueDate: '',
      status: 'todo',
      isCeoDecision: false,
      collaborationTeam: '',
    },
  );

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return alert('업무명을 입력하세요.');
    onSave(form);
  };

  return (
    <div className="tm-modal-overlay" onClick={onClose}>
      <div className="tm-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{task ? '업무 수정' : '업무 추가'}</h2>
        <form onSubmit={handleSubmit}>
          <label>
            업무명 *
            <input
              name="title"
              value={form.title}
              onChange={handleChange}
              placeholder="업무 제목을 입력하세요"
              autoFocus
            />
          </label>
          <label>
            상세 내용
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="업무 상세 내용"
              rows={3}
            />
          </label>
          <div className="tm-form-row">
            <label>
              담당자
              <input
                name="assignee"
                value={form.assignee}
                onChange={handleChange}
                placeholder="담당자명"
              />
            </label>
            <label>
              마감일
              <input
                name="dueDate"
                type="date"
                value={form.dueDate}
                onChange={handleChange}
              />
            </label>
          </div>
          <div className="tm-form-row">
            <label>
              상태
              <select name="status" value={form.status} onChange={handleChange}>
                <option value="todo">할일</option>
                <option value="in-progress">진행중</option>
                <option value="done">완료</option>
              </select>
            </label>
            <label>
              협업 팀
              <input
                name="collaborationTeam"
                value={form.collaborationTeam}
                onChange={handleChange}
                placeholder="예: 개발팀, 마케팅팀"
              />
            </label>
          </div>
          <label className="tm-checkbox">
            <input
              name="isCeoDecision"
              type="checkbox"
              checked={form.isCeoDecision}
              onChange={handleChange}
            />
            대표이사 결정사항
          </label>
          <div className="tm-form-actions">
            <button type="button" className="tm-btn-cancel" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="tm-btn-save">
              {task ? '수정' : '추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
