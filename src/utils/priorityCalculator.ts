import { Timestamp } from 'firebase/firestore';
import { differenceInDays } from 'date-fns';
import type { Task, TaskCategory, TaskPriority } from '../types';

const CATEGORY_SCORE: Record<TaskCategory, number> = {
  '경영관리': 10,
  '재무': 9,
  '인사': 8,
  '기획': 8,
  '일반업무': 5,
};

export function calculatePriorityScore(task: Partial<Task>): {
  priorityScore: number;
  priority: TaskPriority;
} {
  let score = 0;

  // 마감 임박 점수
  if (task.dueDate) {
    const dueDate = task.dueDate instanceof Timestamp ? task.dueDate.toDate() : new Date(task.dueDate as unknown as string);
    const daysLeft = differenceInDays(dueDate, new Date());

    if (daysLeft < 0) {
      // 이미 지연
      score += 40 + 20; // 마감 임박 최대 + 지연 패널티
    } else if (daysLeft <= 1) {
      score += 40;
    } else if (daysLeft <= 3) {
      score += 30;
    } else if (daysLeft <= 7) {
      score += 20;
    } else if (daysLeft <= 14) {
      score += 10;
    }
  }

  // 업무 중요도
  if (task.category) {
    score += CATEGORY_SCORE[task.category] || 5;
  }

  // KPI 연결 보너스
  if (task.kpiLinked) {
    score += 15;
  }

  // 지연 상태 패널티 (상태가 명시적으로 '지연'인 경우)
  if (task.status === '지연') {
    score += 20;
  }

  // CEO 플래그 보너스
  if (task.ceoFlag) {
    score += 10;
  }

  // 0-100 범위 제한
  score = Math.min(100, Math.max(0, score));

  // 우선순위 레이블
  let priority: TaskPriority;
  if (score >= 80) priority = '긴급';
  else if (score >= 60) priority = '높음';
  else if (score >= 40) priority = '보통';
  else priority = '낮음';

  return { priorityScore: score, priority };
}
