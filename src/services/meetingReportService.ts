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

const COL = 'meetingReports';

/**
 * 저장된 회의 리포트.
 * 업무 데이터 자체는 저장하지 않고 "리포트 설정"만 저장한다.
 * 다시 조회할 때 업무를 새로 불러오므로 업무 수정이 자동 반영된다.
 */
export interface SavedReportRecord {
  id: string;
  title: string;
  reportType: MeetingType;
  selectedCeoDate: string; // 격주 보고용 미팅일 (yyyy-MM-dd)
  selectedMonth: string; // 월간 보고용 기준월 (yyyy-MM)
  startDate: string;
  endDate: string;
  taskNotes: Record<string, string>; // 업무별 비고 (회의 중 입력)
  hiddenTaskIds: string[]; // 리포트에서 숨긴 업무
  createdAt: Timestamp | null;
  createdBy: string;
  createdByName: string;
  updatedAt?: Timestamp | null;
  updatedBy?: string;
  updatedByName?: string;
}

export type SavedReportInput = Omit<
  SavedReportRecord,
  'id' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'updatedByName'
>;

export function subscribeSavedReports(
  callback: (records: SavedReportRecord[]) => void,
  onError: (err: Error) => void,
) {
  const q = query(collection(db, COL), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const records = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as SavedReportRecord[];
      callback(records);
    },
    onError,
  );
}

export async function saveReport(input: SavedReportInput): Promise<string> {
  const ref = await addDoc(collection(db, COL), {
    ...input,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateSavedReport(
  id: string,
  updates: Partial<SavedReportInput>,
  userId: string,
  userName: string,
): Promise<void> {
  await updateDoc(doc(db, COL, id), {
    ...updates,
    updatedBy: userId,
    updatedByName: userName,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSavedReport(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
}
