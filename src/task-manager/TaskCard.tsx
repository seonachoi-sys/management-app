import React, { useState, useRef, useEffect } from 'react';
import type { Task, TaskStatus } from '../types';
import { formatShort, dDayLabel, daysLeft, toDate } from '../utils/dateUtils';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

interface Props {
  task: Task;
  childTasks: Task[];
  currentUserName: string;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onAddSubTask: (parentId: string) => void;
}

const ALL_STATUSES: TaskStatus[] = ['대기', '진행중', '완료', '지연', '보류'];

const STATUS_COLOR: Record<string, string> = {
  '대기': 'var(--c-text-3)',
  '진행중': 'var(--c-accent)',
  '완료': 'var(--c-green)',
  '지연': 'var(--c-red)',
  '보류': 'var(--c-text-4)',
};

const STATUS_BG: Record<string, string> = {
  '대기': 'var(--c-bg-sub)',
  '진행중': 'var(--c-accent-light)',
  '완료': 'var(--c-green-bg)',
  '지연': 'var(--c-red-bg)',
  '보류': 'var(--c-bg-sub)',
};

function getDdayClass(ts: Task['dueDate']): string {
  const d = daysLeft(ts);
  if (d === null) return '';
  if (d < 0) return 'dday-overdue';
  if (d === 0) return 'dday-today';
  if (d <= 3) return 'dday-soon';
  return 'dday-normal';
}

/* ─── 상태 드롭다운 ─── */
function StatusDropdown({
  current,
  onChange,
}: {
  current: TaskStatus;
  onChange: (status: TaskStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(!open);
  };

  return (
    <div ref={ref} className="tm-status-dropdown">
      <button
        ref={btnRef}
        className="tm-status-badge"
        style={{
          color: STATUS_COLOR[current],
          background: STATUS_BG[current],
          borderColor: STATUS_COLOR[current],
        }}
        onClick={handleToggle}
      >
        {current}
      </button>
      {open && (
        <div className="tm-status-menu" style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}>
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              className={`tm-status-option ${s === current ? 'selected' : ''}`}
              style={{ color: STATUS_COLOR[s] }}
              onClick={() => {
                if (s !== current) onChange(s);
                setOpen(false);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatModifiedAt(ts: Task['lastModifiedAt']): string {
  const d = toDate(ts);
  if (!d) return '';
  return format(d, 'M.d a h:mm', { locale: ko });
}

function TaskRow({
  task,
  indent,
  currentUserName,
  onStatusChange,
  onEdit,
  onDelete,
}: {
  task: Task;
  indent: number;
  currentUserName: string;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
}) {
  const handleDelete = () => {
    const msg = indent === 0
      ? '이 상위업무와 하위업무 모두 삭제됩니다. 삭제하시겠습니까?'
      : '이 업무를 삭제하시겠습니까?';
    if (window.confirm(msg)) {
      onDelete(task.taskId);
    }
  };

  return (
    <div
      className={`tm-task ${task.status === '완료' ? 'tm-task-done' : ''}`}
      style={indent > 0 ? { marginLeft: 28, borderLeft: '2px solid var(--tm-border-default)' } : undefined}
    >
      <StatusDropdown
        current={task.status}
        onChange={(newStatus) => onStatusChange(task.taskId, newStatus)}
      />

      <div className="tm-task-body">
        <div className="tm-task-header">
          {indent > 0 && <span style={{ fontSize: 10, color: 'var(--tm-ink-tertiary)', marginRight: 4 }}>└</span>}
          <span className="tm-task-title">{task.title}</span>
          <span className={`tm-priority tm-priority-${task.priority}`}>
            {task.priority}
          </span>
          <span className="tm-badge tm-badge-category">{task.category}</span>
          {task.ceoFlag && <span className="tm-badge tm-badge-ceo">CEO</span>}
        </div>

        {task.description && (
          <div className="tm-task-desc">{task.description}</div>
        )}

        <div className="tm-task-meta">
          {task.assigneeName && <span>{task.assigneeName}</span>}
          {task.dueDate && (
            <>
              <span>{formatShort(task.dueDate)}</span>
              <span className={`tm-dday ${getDdayClass(task.dueDate)}`}>
                {dDayLabel(task.dueDate)}
              </span>
            </>
          )}
          {task.progressRate > 0 && (
            <div className="tm-progress-wrap">
              <div className="tm-progress-bar">
                <div
                  className="tm-progress-fill"
                  style={{ width: `${task.progressRate}%` }}
                />
              </div>
              <span className="tm-progress-text">{task.progressRate}%</span>
            </div>
          )}
          {task.lastModifiedBy && task.lastModifiedAt && (
            <span className="tm-modified-info">
              {task.lastModifiedBy === currentUserName ? '내가 수정' : `${task.lastModifiedBy} 수정`} · {formatModifiedAt(task.lastModifiedAt)}
            </span>
          )}
        </div>
      </div>

      <div className="tm-task-actions">
        <button onClick={() => onEdit(task)}>수정</button>
        <button className="btn-delete" onClick={handleDelete}>삭제</button>
      </div>
    </div>
  );
}

export default function TaskCard({ task, childTasks, currentUserName, onStatusChange, onEdit, onDelete, onAddSubTask }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = childTasks.length > 0;

  // 하위업무 통계
  const childDone = childTasks.filter((c) => c.status === '완료').length;
  const childDelayed = childTasks.filter((c) => c.status === '지연').length;

  return (
    <div className="tm-card-group">
      {/* 상위업무 행 */}
      <div className="tm-parent-row">
        <TaskRow
          task={task}
          indent={0}
          currentUserName={currentUserName}
          onStatusChange={onStatusChange}
          onEdit={onEdit}
          onDelete={onDelete}
        />

        {/* 아코디언 토글 버튼 */}
        {hasChildren && (
          <button
            className="tm-accordion-toggle"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? '하위업무 접기' : '하위업무 펼치기'}
          >
            <span className={`tm-accordion-arrow ${expanded ? 'expanded' : ''}`}>▶</span>
            <span className="tm-accordion-label">
              하위업무 {childTasks.length}건
              {childDone > 0 && <span className="tm-acc-done"> · 완료 {childDone}</span>}
              {childDelayed > 0 && <span className="tm-acc-delayed"> · 지연 {childDelayed}</span>}
            </span>
          </button>
        )}
      </div>

      {/* 하위업무 목록 (아코디언) */}
      <div className={`tm-children ${expanded ? 'tm-children-open' : 'tm-children-closed'}`}>
        {expanded && (
          <>
            {childTasks.map((child) => (
              <TaskRow
                key={child.taskId}
                task={child}
                indent={1}
                currentUserName={currentUserName}
                onStatusChange={onStatusChange}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
            <button
              className="tm-subtask-add-btn"
              onClick={() => onAddSubTask(task.taskId)}
            >
              + 하위업무 추가
            </button>
          </>
        )}
      </div>
    </div>
  );
}
