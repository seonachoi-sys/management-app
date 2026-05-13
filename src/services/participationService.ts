import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  Timestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Participation } from '../types/project';

const COLLECTION = 'participations';

/** 과제별 + 월별 참여율 조회 (실시간) */
export function subscribeParticipations(
  projectId: string,
  yearMonth: string,
  callback: (participations: Participation[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(
    collection(db, COLLECTION),
    where('projectId', '==', projectId),
    where('yearMonth', '==', yearMonth),
    orderBy('employeeId')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((doc) => ({
        ...doc.data(),
        participationId: doc.id,
      })) as Participation[];
      callback(list);
    },
    onError
  );
}

/** 전체 참여율 조회 (월별) */
export function subscribeAllParticipations(
  yearMonth: string,
  callback: (participations: Participation[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(
    collection(db, COLLECTION),
    where('yearMonth', '==', yearMonth)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((doc) => ({
        ...doc.data(),
        participationId: doc.id,
      })) as Participation[];
      callback(list);
    },
    onError
  );
}

/** 연도별 전체 참여율 조회 (실시간) — yearMonth가 해당 연도로 시작하는 것 */
export function subscribeYearParticipations(
  year: number,
  callback: (participations: Participation[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const startMonth = `${year}-01`;
  const endMonth = `${year}-12`;
  const q = query(
    collection(db, COLLECTION),
    where('yearMonth', '>=', startMonth),
    where('yearMonth', '<=', endMonth)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => ({
        ...d.data(),
        participationId: d.id,
      })) as Participation[];
      callback(list);
    },
    onError
  );
}

/** 참여율 추가 */
export async function addParticipation(data: Omit<Participation, 'participationId' | 'updatedAt'>) {
  return addDoc(collection(db, COLLECTION), {
    ...data,
    updatedAt: Timestamp.now(),
  });
}

/** 참여율 수정 */
export async function updateParticipation(participationId: string, data: Partial<Participation>) {
  const docRef = doc(db, COLLECTION, participationId);
  return updateDoc(docRef, {
    ...data,
    updatedAt: Timestamp.now(),
  });
}
