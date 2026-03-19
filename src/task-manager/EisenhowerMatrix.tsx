import React, { useState, useMemo, useRef } from 'react';
import { Timestamp } from 'firebase/firestore';
import { differenceInDays, format } from 'date-fns';
import html2canvas from 'html2canvas';
import { saveBinaryFile, saveNote } from '../services/obsidianService';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  useDroppable,
  useDraggable,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Task, TaskStatus } from '../types';
import { formatShort, dDayLabel } from '../utils/dateUtils';

/* ─── 팀원 색상 ─── */
const MEMBER_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  '최선아': { bg: '#eef3fd', border: '#2f6ce5', text: '#2f6ce5' },
  '송은정': { bg: '#fdf6ee', border: '#d9730d', text: '#d9730d' },
  '이웅해': { bg: '#f4f0fa', border: '#6940a5', text: '#6940a5' },
};

const DEFAULT_COLOR = { bg: '#f5f5f5', border: '#999', text: '#666' };

function getMemberColor(name: string) {
  return MEMBER_COLORS[name] || DEFAULT_COLOR;
}

/* ─── 사분면 분류 로직 ─── */
type Quadrant = 'q1' | 'q2' | 'q3' | 'q4';

const QUADRANT_INFO: Record<Quadrant, { title: string; subtitle: string; color: string; bg: string }> = {
  q1: { title: '긴급 + 중요', subtitle: '즉시 처리', color: '#e03e3e', bg: '#fdf2f2' },
  q2: { title: '중요 (비긴급)', subtitle: '계획 수립', color: '#2f6ce5', bg: '#eef3fd' },
  q3: { title: '긴급 (비중요)', subtitle: '위임 검토', color: '#d9730d', bg: '#fdf6ee' },
  q4: { title: '비긴급 + 비중요', subtitle: '후순위', color: '#888', bg: '#fafafa' },
};

function classifyTask(task: Task): Quadrant {
  // 긴급도: 마감일 기준 (3일 이내 = 긴급)
  let isUrgent = false;
  if (task.dueDate) {
    const due = task.dueDate instanceof Timestamp ? task.dueDate.toDate() : new Date(task.dueDate as unknown as string);
    const daysLeft = differenceInDays(due, new Date());
    isUrgent = daysLeft <= 3;
  }

  // 중요도: importance 필드 기준, ceoFlag true면 자동 중요
  const isImportant = task.importance === 'high' || task.ceoFlag;

  if (isUrgent && isImportant) return 'q1';
  if (!isUrgent && isImportant) return 'q2';
  if (isUrgent && !isImportant) return 'q3';
  return 'q4';
}

/* ─── 드래그 가능한 카드 ─── */
function DraggableCard({
  task,
  dimmed,
}: {
  task: Task;
  dimmed: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.taskId,
    data: { task },
  });

  const color = getMemberColor(task.assigneeName);
  const dueDate = task.dueDate instanceof Timestamp ? task.dueDate.toDate() : null;
  const daysLeft = dueDate ? differenceInDays(dueDate, new Date()) : null;
  const isDelayed = daysLeft !== null && daysLeft < 0 && task.status !== '완료';

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`em-card ${isDelayed ? 'em-card-delayed' : ''} ${isDragging ? 'em-card-dragging' : ''}`}
      style={{
        borderLeftColor: color.border,
        opacity: dimmed ? 0.25 : 1,
        cursor: 'grab',
      }}
    >
      <div className="em-card-header">
        <span className="em-card-title">{task.title}</span>
        {task.ceoFlag && <span className="em-card-ceo">CEO</span>}
      </div>
      <div className="em-card-meta">
        <span className="em-card-assignee" style={{ color: color.text }}>{task.assigneeName || '미배정'}</span>
        {dueDate && (
          <span className={`em-card-dday ${isDelayed ? 'em-dday-over' : daysLeft !== null && daysLeft <= 5 ? 'em-dday-warn' : ''}`}>
            {`${dueDate.getMonth()+1}.${String(dueDate.getDate()).padStart(2,'0')}`}
          </span>
        )}
        {task.progressRate > 0 && (
          <span className="em-card-progress">{task.progressRate}%</span>
        )}
      </div>
      {task.notes && (
        <div className="em-card-tooltip" title={task.notes}>📋</div>
      )}
    </div>
  );
}

/* ─── 카드 오버레이 (드래그 중 표시) ─── */
function CardOverlay({ task }: { task: Task }) {
  const color = getMemberColor(task.assigneeName);
  return (
    <div
      className="em-card em-card-overlay"
      style={{ borderLeftColor: color.border }}
    >
      <div className="em-card-header">
        <span className="em-card-title">{task.title}</span>
      </div>
      <div className="em-card-meta">
        <span className="em-card-assignee" style={{ color: color.text }}>{task.assigneeName}</span>
      </div>
    </div>
  );
}

/* ─── 드롭 가능한 사분면 ─── */
function QuadrantZone({
  quadrant,
  tasks,
  filterMember,
  totalCount,
}: {
  quadrant: Quadrant;
  tasks: Task[];
  filterMember: string;
  totalCount: number;
}) {
  const info = QUADRANT_INFO[quadrant];
  const { setNodeRef, isOver } = useDroppable({ id: quadrant });
  const isOverloaded = quadrant === 'q1' && totalCount >= 5;

  return (
    <div
      ref={setNodeRef}
      className={`em-quadrant ${isOver ? 'em-quadrant-over' : ''} ${isOverloaded ? 'em-quadrant-warn' : ''}`}
      style={{ background: isOver ? info.bg : undefined }}
    >
      <div className="em-quad-header">
        <span className="em-quad-dot" style={{ background: info.color }} />
        <span className="em-quad-title" style={{ color: info.color }}>{info.title}</span>
        <span className="em-quad-badge" style={{ background: info.color }}>{totalCount}</span>
        {isOverloaded && <span className="em-quad-alert">⚠ 과부하</span>}
      </div>
      <div className="em-quad-subtitle">{info.subtitle}</div>
      <div className="em-quad-cards">
        {tasks.map((t) => (
          <DraggableCard
            key={t.taskId}
            task={t}
            dimmed={!!filterMember && t.assigneeName !== filterMember}
          />
        ))}
        {tasks.length === 0 && <div className="em-quad-empty">업무 없음</div>}
      </div>
    </div>
  );
}

/* ─── 메인 매트릭스 ─── */
interface Props {
  tasks: Task[];
  onQuadrantChange: (taskId: string, quadrant: Quadrant) => void;
}

export default function EisenhowerMatrix({ tasks, onQuadrantChange }: Props) {
  const [filterMember, setFilterMember] = useState('');
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [capturing, setCapturing] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // 상위업무(그룹 헤더) 제외, 완료 제외
  const activeTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (t.status === '완료') return false;
      // 상위업무 제외 (하위가 있는 것)
      if (!t.parentTaskId && tasks.some((c) => c.parentTaskId === t.taskId)) return false;
      return true;
    });
  }, [tasks]);

  // 사분면별 분류
  const quadrants = useMemo(() => {
    const result: Record<Quadrant, Task[]> = { q1: [], q2: [], q3: [], q4: [] };
    for (const t of activeTasks) {
      result[classifyTask(t)].push(t);
    }
    return result;
  }, [activeTasks]);

  // 팀원 목록
  const memberNames = useMemo(() => {
    const names = new Set<string>();
    activeTasks.forEach((t) => { if (t.assigneeName) names.add(t.assigneeName); });
    return Array.from(names);
  }, [activeTasks]);

  const handleDragStart = (event: DragStartEvent) => {
    const task = activeTasks.find((t) => t.taskId === event.active.id);
    setActiveTask(task || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const targetQuadrant = over.id as Quadrant;
    const taskId = active.id as string;
    const task = activeTasks.find((t) => t.taskId === taskId);
    if (!task) return;

    const currentQuadrant = classifyTask(task);
    if (currentQuadrant !== targetQuadrant) {
      onQuadrantChange(taskId, targetQuadrant);
    }
  };

  // 스크린샷 → Obsidian 저장
  const handleScreenshot = async () => {
    if (!gridRef.current) return;
    setCapturing(true);
    try {
      const canvas = await html2canvas(gridRef.current, { backgroundColor: '#ffffff', scale: 2 });
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));

      const today = format(new Date(), 'yyyy-MM-dd');
      const year = new Date().getFullYear();
      const month = String(new Date().getMonth() + 1).padStart(2, '0');

      // 이미지 저장
      const imgPath = `회의록/${year}/${month}/${today} 매트릭스.png`;
      await saveBinaryFile(imgPath, blob);

      // 마크다운 노트 (이미지 임베드)
      const mdContent = [
        `---`,
        `tags: [매트릭스, 스냅샷]`,
        `date: ${today}`,
        `---`,
        `# 업무 매트릭스 스냅샷`,
        `> ${today} 기준`,
        ``,
        `![[${today} 매트릭스.png]]`,
        ``,
        `## 사분면 요약`,
        `| 구분 | 건수 |`,
        `|------|------|`,
        `| 긴급+중요 | ${quadrants.q1.length} |`,
        `| 중요(비긴급) | ${quadrants.q2.length} |`,
        `| 긴급(비중요) | ${quadrants.q3.length} |`,
        `| 비긴급+비중요 | ${quadrants.q4.length} |`,
      ].join('\n');

      const mdPath = `회의록/${year}/${month}/${today} 매트릭스 스냅샷.md`;
      await saveNote(mdPath, mdContent);

      alert(`Obsidian에 저장 완료!\n📸 ${imgPath}\n📝 ${mdPath}`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Obsidian 저장 실패. Obsidian이 실행 중인지 확인해주세요.');
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="em-container">
      {/* 팀원 필터 + 스크린샷 */}
      <div className="em-team-filter">
        <button
          className={`em-filter-btn ${filterMember === '' ? 'active' : ''}`}
          onClick={() => setFilterMember('')}
        >
          전체
        </button>
        {memberNames.map((name) => {
          const c = getMemberColor(name);
          return (
            <button
              key={name}
              className={`em-filter-btn ${filterMember === name ? 'active' : ''}`}
              onClick={() => setFilterMember(filterMember === name ? '' : name)}
              style={{
                borderColor: c.border,
                color: filterMember === name ? '#fff' : c.text,
                background: filterMember === name ? c.border : c.bg,
              }}
            >
              <span className="em-filter-dot" style={{ background: c.border }} />
              {name}
            </button>
          );
        })}
        <button
          className="em-screenshot-btn"
          onClick={handleScreenshot}
          disabled={capturing}
          title="매트릭스 스크린샷 → Obsidian 저장"
        >
          {capturing ? '저장 중...' : '📸 Obsidian 저장'}
        </button>
      </div>

      {/* 축 레이블 */}
      <div className="em-axis-labels">
        <div className="em-axis-y">← 중요 —————— 일반 →</div>
        <div className="em-axis-x">← 긴급 —————— 여유 →</div>
      </div>

      {/* 사사분면 그리드 */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="em-grid" ref={gridRef}>
          <QuadrantZone quadrant="q1" tasks={quadrants.q1} filterMember={filterMember} totalCount={quadrants.q1.length} />
          <QuadrantZone quadrant="q2" tasks={quadrants.q2} filterMember={filterMember} totalCount={quadrants.q2.length} />
          <QuadrantZone quadrant="q3" tasks={quadrants.q3} filterMember={filterMember} totalCount={quadrants.q3.length} />
          <QuadrantZone quadrant="q4" tasks={quadrants.q4} filterMember={filterMember} totalCount={quadrants.q4.length} />
        </div>

        <DragOverlay>
          {activeTask && <CardOverlay task={activeTask} />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

export { classifyTask };
export type { Quadrant };
