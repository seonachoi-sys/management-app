import {
  collection,
  doc,
  addDoc,
  updateDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  getDocs,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import type { Kpi, ChildKpi, KpiStatus } from '../types';

const KPIS = 'kpis';

/* ─── 자동계산 ─── */
export function calcAchievementRate(current: number, target: number): number {
  if (target === 0) return 0;
  return Math.round((current / target) * 100);
}

export function calcKpiStatus(rate: number): KpiStatus {
  if (rate >= 100) return '달성';
  if (rate >= 70) return '진행중';
  return '위험';
}

/* ─── 상위 KPI CRUD ─── */
export function subscribeKpis(
  callback: (kpis: Kpi[]) => void,
  onError: (error: Error) => void,
) {
  const q = query(collection(db, KPIS));
  return onSnapshot(
    q,
    (snap) => {
      const kpis = snap.docs.map((d) => ({ kpiId: d.id, ...d.data() })) as Kpi[];
      callback(kpis);
    },
    onError,
  );
}

export async function createKpi(data: Partial<Kpi>): Promise<string> {
  const rate = calcAchievementRate(data.currentValue || 0, data.targetValue || 0);
  const ref = await addDoc(collection(db, KPIS), {
    ...data,
    achievementRate: rate,
    status: calcKpiStatus(rate),
    childKpiIds: data.childKpiIds || [],
    linkedTaskIds: data.linkedTaskIds || [],
    isParent: data.isParent ?? true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateKpi(kpiId: string, data: Partial<Kpi>): Promise<void> {
  const update: Record<string, unknown> = { ...data, updatedAt: serverTimestamp() };
  // 값 변경 시 달성률/상태 재계산
  if (data.currentValue !== undefined || data.targetValue !== undefined) {
    const rate = calcAchievementRate(
      data.currentValue ?? 0,
      data.targetValue ?? 0,
    );
    update.achievementRate = rate;
    update.status = calcKpiStatus(rate);
  }
  await updateDoc(doc(db, KPIS, kpiId), update);
}

export async function deleteKpi(kpiId: string): Promise<void> {
  // 하위 KPI 먼저 삭제
  const childSnap = await getDocs(collection(db, KPIS, kpiId, 'childKpis'));
  for (const d of childSnap.docs) {
    await deleteDoc(d.ref);
  }
  await deleteDoc(doc(db, KPIS, kpiId));
}

/* ─── 하위 KPI CRUD ─── */
export function subscribeChildKpis(
  parentKpiId: string,
  callback: (children: ChildKpi[]) => void,
  onError: (error: Error) => void,
) {
  const q = query(collection(db, KPIS, parentKpiId, 'childKpis'));
  return onSnapshot(
    q,
    (snap) => {
      const children = snap.docs.map((d) => ({ childKpiId: d.id, ...d.data() })) as ChildKpi[];
      callback(children);
    },
    onError,
  );
}

export async function createChildKpi(parentKpiId: string, data: Partial<ChildKpi>): Promise<string> {
  const rate = calcAchievementRate(data.currentValue || 0, data.targetValue || 0);
  const ref = await addDoc(collection(db, KPIS, parentKpiId, 'childKpis'), {
    ...data,
    parentKpiId,
    achievementRate: rate,
    status: calcKpiStatus(rate),
    linkedTaskIds: data.linkedTaskIds || [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // 상위 KPI의 childKpiIds 업데이트
  const parentRef = doc(db, KPIS, parentKpiId);
  const parentSnap = await getDocs(collection(db, KPIS, parentKpiId, 'childKpis'));
  const childIds = parentSnap.docs.map((d) => d.id);
  await updateDoc(parentRef, { childKpiIds: childIds, updatedAt: serverTimestamp() });

  // 상위 달성률 재계산
  await recalcParentRate(parentKpiId);

  return ref.id;
}

export async function updateChildKpi(
  parentKpiId: string,
  childKpiId: string,
  data: Partial<ChildKpi>,
): Promise<void> {
  const update: Record<string, unknown> = { ...data, updatedAt: serverTimestamp() };
  if (data.currentValue !== undefined || data.targetValue !== undefined) {
    const rate = calcAchievementRate(data.currentValue ?? 0, data.targetValue ?? 0);
    update.achievementRate = rate;
    update.status = calcKpiStatus(rate);
  }
  await updateDoc(doc(db, KPIS, parentKpiId, 'childKpis', childKpiId), update);
  await recalcParentRate(parentKpiId);
}

export async function deleteChildKpi(parentKpiId: string, childKpiId: string): Promise<void> {
  await deleteDoc(doc(db, KPIS, parentKpiId, 'childKpis', childKpiId));
  // childKpiIds 업데이트
  const snap = await getDocs(collection(db, KPIS, parentKpiId, 'childKpis'));
  const childIds = snap.docs.map((d) => d.id);
  await updateDoc(doc(db, KPIS, parentKpiId), { childKpiIds: childIds, updatedAt: serverTimestamp() });
  await recalcParentRate(parentKpiId);
}

/* ─── 상위 KPI 달성률 재계산 ─── */
async function recalcParentRate(parentKpiId: string): Promise<void> {
  const snap = await getDocs(collection(db, KPIS, parentKpiId, 'childKpis'));
  if (snap.empty) return;

  const children = snap.docs.map((d) => d.data() as ChildKpi);
  const avgRate = Math.round(
    children.reduce((sum, c) => sum + (c.achievementRate || 0), 0) / children.length,
  );

  await updateDoc(doc(db, KPIS, parentKpiId), {
    achievementRate: avgRate,
    status: calcKpiStatus(avgRate),
    updatedAt: serverTimestamp(),
  });
}

/* ─── 전체 조회 ─── */
export async function fetchAllKpis(): Promise<Kpi[]> {
  const q = query(collection(db, KPIS));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ kpiId: d.id, ...d.data() })) as Kpi[];
}

export async function fetchChildKpis(parentKpiId: string): Promise<ChildKpi[]> {
  const snap = await getDocs(collection(db, KPIS, parentKpiId, 'childKpis'));
  return snap.docs.map((d) => ({ childKpiId: d.id, ...d.data() })) as ChildKpi[];
}
