import {
  collection, doc, onSnapshot, setDoc, deleteDoc,
  query, where, Timestamp, Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { YearlyParticipation } from '../types/project';
import { logAction } from './auditService';

const COLLECTION = 'yearlyParticipations';

/** 연도별 전체 참여율 구독 */
export function subscribeYearlyParticipations(
  year: number,
  callback: (data: YearlyParticipation[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(collection(db, COLLECTION), where('year', '==', year));
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ ...d.data(), id: d.id } as YearlyParticipation)));
  }, onError);
}

/** 참여율 저장 (upsert) */
export async function saveParticipation(
  data: Omit<YearlyParticipation, 'updatedAt' | 'updatedBy'>,
  userEmail: string
) {
  const docId = `${data.projectId}_${data.employeeName}_${data.year}`;
  const docRef = doc(db, COLLECTION, docId);

  // averageRate 자동계산
  const rates = Object.values(data.monthlyRates).filter(v => v > 0);
  const averageRate = rates.length > 0 ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0;

  const payload = {
    ...data,
    id: docId,
    averageRate,
    updatedAt: Timestamp.now(),
    updatedBy: userEmail,
  };

  await setDoc(docRef, payload);
  return payload;
}

/** 월별 참여율 개별 업데이트 */
export async function updateMonthlyRate(
  projectId: string,
  employeeName: string,
  employeeId: string,
  year: number,
  month: number,
  rate: number,
  role: '책임연구원' | '연구원',
  userEmail: string,
  existingData?: YearlyParticipation | null
) {
  const monthKey = String(month);
  const monthlyRates = existingData
    ? { ...existingData.monthlyRates, [monthKey]: rate }
    : { [monthKey]: rate };

  await saveParticipation({
    id: `${projectId}_${employeeName}_${year}`,
    projectId,
    employeeId,
    employeeName,
    year,
    role: existingData?.role || role,
    monthlyRates,
    averageRate: 0, // saveParticipation에서 재계산
    participationType: existingData?.participationType, // 기존 형태 보존
  }, userEmail);

  await logAction('update', 'yearlyParticipations',
    `${projectId}_${employeeName}_${year}`,
    `monthlyRates.${monthKey}`,
    existingData?.monthlyRates[monthKey] ?? 0, rate, userEmail
  );
}

/** 참여형태(현금/현물) 토글 */
export async function updateParticipationType(
  projectId: string,
  employeeName: string,
  employeeId: string,
  year: number,
  newType: 'cash' | 'inKind',
  role: '책임연구원' | '연구원',
  userEmail: string,
  existingData?: YearlyParticipation | null,
) {
  const monthlyRates = existingData?.monthlyRates || {};
  await saveParticipation({
    id: `${projectId}_${employeeName}_${year}`,
    projectId,
    employeeId,
    employeeName,
    year,
    role: existingData?.role || role,
    monthlyRates,
    averageRate: 0,
    participationType: newType,
  }, userEmail);

  await logAction('update', 'yearlyParticipations',
    `${projectId}_${employeeName}_${year}`,
    'participationType',
    existingData?.participationType ?? 'cash', newType, userEmail
  );
}

/** 범위 적용 (startMonth~endMonth에 동일 rate) */
export async function applyRateRange(
  projectId: string,
  employeeName: string,
  employeeId: string,
  year: number,
  startMonth: number,
  endMonth: number,
  rate: number,
  role: '책임연구원' | '연구원',
  userEmail: string,
  existingData?: YearlyParticipation | null
) {
  const monthlyRates = existingData ? { ...existingData.monthlyRates } : {};
  for (let m = startMonth; m <= endMonth; m++) {
    monthlyRates[String(m)] = rate;
  }

  await saveParticipation({
    id: `${projectId}_${employeeName}_${year}`,
    projectId,
    employeeId,
    employeeName,
    year,
    role: existingData?.role || role,
    monthlyRates,
    averageRate: 0,
    participationType: existingData?.participationType,
  }, userEmail);
}

/** 참여율 삭제 */
export async function deleteParticipation(docId: string) {
  await deleteDoc(doc(db, COLLECTION, docId));
}
