import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  serverTimestamp,
  getDoc,
  getDocs,
  QueryConstraint,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import type { Task, TaskStatus, TaskHistory } from '../types';
import { calculatePriorityScore } from '../utils/priorityCalculator';

const TASKS = 'tasks';
const HISTORY = 'taskHistory';

/* ─── 실시간 구독 ─── */
export interface TaskFilters {
  status?: TaskStatus;
  assignee?: string;
  category?: string;
  priority?: string;
  startDate?: Date;
  endDate?: Date;
}

export function subscribeTasks(
  filters: TaskFilters,
  callback: (tasks: Task[]) => void,
  onError: (error: Error) => void,
) {
  // 단순 쿼리로 전체 조회 후 클라이언트에서 필터/정렬 (인덱스 불필요)
  const q = query(collection(db, TASKS), orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      let tasks = snapshot.docs.map((d) => ({
        taskId: d.id,
        ...d.data(),
      })) as Task[];

      // 클라이언트 필터링
      if (filters.status) {
        tasks = tasks.filter((t) => t.status === filters.status);
      }
      if (filters.assignee) {
        tasks = tasks.filter((t) => t.assignee === filters.assignee || t.assigneeName === filters.assignee);
      }
      if (filters.category) {
        tasks = tasks.filter((t) => t.category === filters.category);
      }

      // 우선순위 점수 높은 순 정렬
      tasks.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));

      callback(tasks);
    },
    onError,
  );
}

/* ─── 생성 ─── */
export async function createTask(
  data: Partial<Task>,
  userId: string,
): Promise<{ id: string; warning?: string }> {
  const { priorityScore, priority } = calculatePriorityScore(data);

  // 담당자 업무량 체크 (전체 조회 후 클라이언트 필터)
  let warning: string | undefined;
  if (data.assignee || data.assigneeName) {
    const allSnap = await getDocs(collection(db, TASKS));
    const assigneeTasks = allSnap.docs.filter((d) => {
      const t = d.data();
      const nameMatch = t.assignee === data.assignee || t.assigneeName === data.assigneeName;
      const activeStatus = t.status === '대기' || t.status === '진행중';
      return nameMatch && activeStatus;
    });
    if (assigneeTasks.length >= 5) {
      warning = `${data.assigneeName || data.assignee}님의 진행 중인 업무가 ${assigneeTasks.length}개입니다. 업무 과부하에 주의하세요.`;
    }
  }

  const now = serverTimestamp();
  const docRef = await addDoc(collection(db, TASKS), {
    ...data,
    priorityScore,
    priority,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
  });

  return { id: docRef.id, warning };
}

/* ─── 수정 ─── */
export async function updateTask(
  taskId: string,
  data: Partial<Task>,
  changedBy: string,
  changedByName?: string,
): Promise<void> {
  const ref = doc(db, TASKS, taskId);
  const prev = await getDoc(ref);
  if (!prev.exists()) throw new Error('업무를 찾을 수 없습니다.');

  const prevData = prev.data() as Task;

  // 변경 이력 저장
  const prevObj = prevData as unknown as Record<string, unknown>;
  const dataObj = data as unknown as Record<string, unknown>;
  const changedFields = Object.keys(data).filter(
    (key) => JSON.stringify(prevObj[key]) !== JSON.stringify(dataObj[key]),
  );

  for (const field of changedFields) {
    await addDoc(collection(db, HISTORY), {
      taskId,
      changedBy,
      changedAt: serverTimestamp(),
      field,
      oldValue: prevObj[field] ?? null,
      newValue: dataObj[field] ?? null,
    });
  }

  // 우선순위 재계산
  const merged = { ...prevData, ...data };
  const { priorityScore, priority } = calculatePriorityScore(merged);

  await updateDoc(ref, {
    ...data,
    priorityScore,
    priority,
    updatedAt: serverTimestamp(),
    ...(changedByName ? { lastModifiedBy: changedByName, lastModifiedAt: serverTimestamp() } : {}),
  });
}

/* ─── 삭제 (완전 삭제 + 하위업무도 함께 삭제) ─── */
export async function deleteTask(taskId: string): Promise<void> {
  // 하위업무 먼저 삭제
  const allSnap = await getDocs(collection(db, TASKS));
  const childDocs = allSnap.docs.filter((d) => d.data().parentTaskId === taskId);
  for (const child of childDocs) {
    await deleteDoc(doc(db, TASKS, child.id));
  }
  // 상위업무 삭제
  await deleteDoc(doc(db, TASKS, taskId));
}

/* ─── 전체 업무 한번 조회 (리포트용) ─── */
export async function fetchAllTasks(): Promise<Task[]> {
  const snap = await getDocs(collection(db, TASKS));
  return snap.docs.map((d) => ({ taskId: d.id, ...d.data() })) as Task[];
}
