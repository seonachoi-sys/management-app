import { useEffect, useRef } from 'react';
import { Timestamp } from 'firebase/firestore';
import { createTask } from '../services/taskService';

const LS_KEY = 'ts-tasks';
const MIGRATED_KEY = 'ts-tasks-migrated';

interface LegacyTask {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  dueDate?: string;
  status: string;
  isCeoDecision?: boolean;
  collaborationTeam?: string;
  createdAt?: string;
  completedAt?: string;
}

const STATUS_MAP: Record<string, string> = {
  'todo': '대기',
  'in-progress': '진행중',
  'done': '완료',
};

export function useMigration(userId: string | undefined) {
  const migrated = useRef(false);

  useEffect(() => {
    if (!userId || migrated.current) return;
    if (localStorage.getItem(MIGRATED_KEY)) return;

    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;

    let tasks: LegacyTask[];
    try {
      tasks = JSON.parse(raw);
    } catch {
      return;
    }

    if (!Array.isArray(tasks) || tasks.length === 0) return;

    migrated.current = true;

    (async () => {
      let count = 0;
      for (const t of tasks) {
        try {
          await createTask(
            {
              title: t.title,
              description: t.description || '',
              assignee: '',
              assigneeName: t.assignee || '',
              category: '일반업무',
              status: (STATUS_MAP[t.status] || '대기') as any,
              parentTaskId: null,
              startDate: null,
              dueDate: t.dueDate ? Timestamp.fromDate(new Date(t.dueDate)) : null,
              completedDate: t.completedAt ? Timestamp.fromDate(new Date(t.completedAt)) : null,
              progressRate: t.status === 'done' ? 100 : 0,
              kpiLinked: null,
              notes: t.collaborationTeam ? `협업: ${t.collaborationTeam}` : '',
              isRecurring: false,
              recurrenceRule: null,
              ceoFlag: t.isCeoDecision || false,
              ceoFlagReason: '',
              googleTaskId: null,
            },
            userId,
          );
          count++;
        } catch {
          // 개별 실패 무시
        }
      }
      if (count > 0) {
        localStorage.setItem(MIGRATED_KEY, 'true');
        alert(`기존 업무 ${count}건이 Firestore로 마이그레이션 되었습니다.`);
      }
    })();
  }, [userId]);
}
