import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/config';

interface MigrationResult {
  seonaChoi: { tasks: number; kpis: number };
  multiAssignee: { tasks: number; kpis: number };
  unassigned: { tasks: { title: string; category: string; dueDate: string }[]; kpis: { title: string; period: string }[] };
}

/** 마이그레이션 대상 건수 확인 (실행 전 미리보기) */
export async function checkMigration(): Promise<MigrationResult> {
  const tasksSnap = await getDocs(collection(db, 'tasks'));
  const tasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];

  const kpisSnap = await getDocs(collection(db, 'kpis'));
  const kpis = kpisSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];

  const seonaChoi = {
    tasks: tasks.filter((t) => t.assigneeName === 'SeonA Choi').length,
    kpis: kpis.filter((k) => k.assigneeName === 'SeonA Choi').length,
  };

  const multiAssignee = {
    tasks: tasks.filter((t) => t.assigneeName?.includes(',')).length,
    kpis: kpis.filter((k) => k.assigneeName?.includes(',')).length,
  };

  const unassigned = {
    tasks: tasks.filter((t) => !t.assigneeName || t.assigneeName.trim() === '').map((t) => {
      const dd = t.dueDate?.toDate?.();
      return {
        title: t.title || '(제목없음)',
        category: t.category || '-',
        dueDate: dd ? `${dd.getMonth() + 1}.${dd.getDate()}` : '-',
      };
    }),
    kpis: kpis.filter((k) => !k.assigneeName || k.assigneeName.trim() === '').map((k) => ({
      title: k.title || '(제목없음)',
      period: k.period || '-',
    })),
  };

  return { seonaChoi, multiAssignee, unassigned };
}

/** 마이그레이션 실행 */
export async function runMigration(): Promise<string> {
  const results: string[] = [];

  const tasksSnap = await getDocs(collection(db, 'tasks'));
  const kpisSnap = await getDocs(collection(db, 'kpis'));

  let seonaCount = 0;
  let multiCount = 0;

  // SeonA Choi → 최선아
  for (const d of tasksSnap.docs) {
    const data = d.data();
    if (data.assigneeName === 'SeonA Choi') {
      await updateDoc(doc(db, 'tasks', d.id), { assigneeName: '최선아', assignee: '최선아' });
      seonaCount++;
    }
  }
  for (const d of kpisSnap.docs) {
    const data = d.data();
    if (data.assigneeName === 'SeonA Choi') {
      await updateDoc(doc(db, 'kpis', d.id), { assigneeName: '최선아', assignee: '최선아' });
      seonaCount++;
    }
  }
  results.push(`SeonA Choi → 최선아: ${seonaCount}건`);

  // 복수 담당자 → 첫번째만
  for (const d of tasksSnap.docs) {
    const data = d.data();
    if (data.assigneeName?.includes(',')) {
      const first = data.assigneeName.split(',')[0].trim();
      await updateDoc(doc(db, 'tasks', d.id), { assigneeName: first, assignee: first });
      multiCount++;
    }
  }
  for (const d of kpisSnap.docs) {
    const data = d.data();
    if (data.assigneeName?.includes(',')) {
      const first = data.assigneeName.split(',')[0].trim();
      await updateDoc(doc(db, 'kpis', d.id), { assigneeName: first, assignee: first });
      multiCount++;
    }
  }
  results.push(`복수 담당자 → 첫번째만: ${multiCount}건`);

  return results.join('\n');
}
