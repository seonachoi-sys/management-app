import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  updateDoc,
  doc,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { differenceInDays, subHours } from 'date-fns';
import { db } from '../firebase/config';
import type { Notification, NotificationType, Task } from '../types';
import { fetchAllTasks } from './taskService';

const NOTIFICATIONS = 'notifications';

/* ─── 실시간 구독 ─── */
export function subscribeNotifications(
  userId: string,
  callback: (notifications: Notification[]) => void,
  onError: (error: Error) => void,
) {
  const q = query(collection(db, NOTIFICATIONS));
  return onSnapshot(
    q,
    (snap) => {
      let notifs = snap.docs.map((d) => ({
        notifId: d.id,
        ...d.data(),
      })) as Notification[];
      // 클라이언트 필터링 + 정렬
      notifs = notifs
        .filter((n) => n.targetUserId === userId)
        .sort((a, b) => {
          const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
          const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
          return bTime - aTime;
        });
      callback(notifs);
    },
    onError,
  );
}

/* ─── 읽음 처리 ─── */
export async function markAsRead(notifId: string): Promise<void> {
  await updateDoc(doc(db, NOTIFICATIONS, notifId), { isRead: true });
}

export async function markAllAsRead(userId: string): Promise<void> {
  const q = query(
    collection(db, NOTIFICATIONS),
    where('targetUserId', '==', userId),
    where('isRead', '==', false),
  );
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(d.ref, { isRead: true }));
  await batch.commit();
}

/* ─── 마감 알림 체크 ─── */
export async function checkDeadlineNotifications(userId: string): Promise<number> {
  const tasks = await fetchAllTasks();
  const now = new Date();
  let created = 0;

  for (const task of tasks) {
    if (task.status === '완료' || task.status === '보류') continue;
    if (!task.dueDate) continue;

    const dueDate = task.dueDate instanceof Timestamp ? task.dueDate.toDate() : new Date(task.dueDate as unknown as string);
    const days = differenceInDays(dueDate, now);

    let type: NotificationType | null = null;
    let message = '';

    if (days < 0) {
      type = '지연';
      message = `"${task.title}" 업무가 ${Math.abs(days)}일 지연되었습니다.`;
    } else if (days === 0) {
      type = 'D-day';
      message = `"${task.title}" 업무 마감일입니다.`;
    } else if (days === 1) {
      type = 'D-1';
      message = `"${task.title}" 마감 1일 전입니다.`;
    } else if (days === 3) {
      type = 'D-3';
      message = `"${task.title}" 마감 3일 전입니다.`;
    } else if (days === 7) {
      type = 'D-7';
      message = `"${task.title}" 마감 7일 전입니다.`;
    }

    if (!type) continue;

    // 24시간 내 중복 방지
    const cutoff = Timestamp.fromDate(subHours(now, 24));
    const dupQ = query(
      collection(db, NOTIFICATIONS),
      where('taskId', '==', task.taskId),
      where('type', '==', type),
      where('createdAt', '>=', cutoff),
    );
    const dupSnap = await getDocs(dupQ);
    if (dupSnap.size > 0) continue;

    const target = task.assignee || userId;
    await addDoc(collection(db, NOTIFICATIONS), {
      taskId: task.taskId,
      type,
      message,
      targetUserId: target,
      isRead: false,
      createdAt: serverTimestamp(),
    });
    created++;
  }

  // 과부하 체크 (5개 초과 진행 업무)
  const assigneeCounts: Record<string, number> = {};
  for (const task of tasks) {
    if (task.status === '진행중' || task.status === '대기') {
      const key = task.assignee || 'unknown';
      assigneeCounts[key] = (assigneeCounts[key] || 0) + 1;
    }
  }

  for (const [assignee, count] of Object.entries(assigneeCounts)) {
    if (count <= 5) continue;

    const cutoff = Timestamp.fromDate(subHours(now, 24));
    const dupQ = query(
      collection(db, NOTIFICATIONS),
      where('type', '==', '과부하'),
      where('targetUserId', '==', assignee),
      where('createdAt', '>=', cutoff),
    );
    const dupSnap = await getDocs(dupQ);
    if (dupSnap.size > 0) continue;

    await addDoc(collection(db, NOTIFICATIONS), {
      taskId: '',
      type: '과부하' as NotificationType,
      message: `${assignee}님의 진행 중인 업무가 ${count}개입니다. 업무 분배를 확인하세요.`,
      targetUserId: userId,
      isRead: false,
      createdAt: serverTimestamp(),
    });
    created++;
  }

  return created;
}
