import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import type { MeetingType } from '../types';

const COL = 'meetings';

export interface MeetingTaskSnapshot {
  taskId?: string;
  title: string;
  assigneeName: string;
  category?: string;
  status?: string;
  progressRate?: number;
  dueDate?: string; // yyyy.MM.dd
  completedDate?: string;
  memo?: string;
  notes?: string;
  meetingNote?: string; // 회의 중 추가 기재한 비고
  isManual?: boolean; // 회의 중 수동 추가된 안건
}

export interface MeetingLogRecord {
  id: string;
  meetingType: MeetingType;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  meetingDate: string; // 실제 회의 진행일 (yyyy-MM-dd)

  stats: {
    total: number;
    completed: number;
    incomplete: number;
    delayed: number;
  };

  // 업무 스냅샷 (담당자별로 저장)
  completedTasks: MeetingTaskSnapshot[];
  inProgressTasks: MeetingTaskSnapshot[];
  upcomingTasks: MeetingTaskSnapshot[];
  delayedTasks: MeetingTaskSnapshot[];
  ceoItems: MeetingTaskSnapshot[];

  // 회의록 수동 입력
  attendees: string[];
  notes: string;
  decisions: string[];
  nextActions: string[];
  extraAgenda: MeetingTaskSnapshot[];
  kpiNotes?: Record<string, string>;

  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
  lastModifiedAt?: Timestamp | null;
  lastModifiedBy?: string | null;
}

export type MeetingLogInput = Omit<MeetingLogRecord, 'id' | 'createdAt' | 'lastModifiedAt' | 'lastModifiedBy'>;

export function subscribeMeetingLogs(
  callback: (records: MeetingLogRecord[]) => void,
  onError: (err: Error) => void,
) {
  const q = query(collection(db, COL), orderBy('meetingDate', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const records = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as MeetingLogRecord[];
      callback(records);
    },
    onError,
  );
}

export async function saveMeetingLog(input: MeetingLogInput): Promise<string> {
  const ref = await addDoc(collection(db, COL), {
    ...input,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateMeetingLog(
  id: string,
  updates: Partial<MeetingLogInput>,
  userId: string,
  userName: string,
): Promise<void> {
  await updateDoc(doc(db, COL, id), {
    ...updates,
    lastModifiedBy: userId,
    lastModifiedByName: userName,
    lastModifiedAt: serverTimestamp(),
  });
}

export async function deleteMeetingLog(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
}
