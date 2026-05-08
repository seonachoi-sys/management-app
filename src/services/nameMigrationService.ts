/**
 * 영문 사용자 이름 → 한글 표준 이름 일괄 마이그레이션
 *
 * Firestore 컬렉션:
 *  - tasks: assigneeName, lastModifiedBy
 *  - kpis: assigneeName, lastModifiedBy
 *  - meetings: createdByName, lastModifiedByName, attendees[]
 *
 * 사용 흐름:
 *  1) preview() — dry run, 영향받을 건수 + 변경 내역 보여주기
 *  2) apply() — 실제 일괄 업데이트
 */
import {
  collection,
  doc,
  getDocs,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { NAME_MAP } from '../utils/userNameNormalizer';

export interface MigrationFieldChange {
  field: string;
  before: string;
  after: string;
}

export interface MigrationDocChange {
  collection: 'tasks' | 'kpis' | 'meetings';
  docId: string;
  title?: string;
  changes: MigrationFieldChange[];
}

export interface MigrationPreview {
  total: number;
  byCollection: Record<string, number>;
  changes: MigrationDocChange[];
}

/** 단일 string 필드 변환 — 매핑 대상이면 새 값, 아니면 null (변경 없음) */
function convertString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const mapped = NAME_MAP[value];
  return mapped && mapped !== value ? mapped : null;
}

/** 배열 변환 — 변경된 항목이 있으면 새 배열, 아니면 null */
function convertStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  let changed = false;
  const next = value.map((v) => {
    if (typeof v !== 'string') return v;
    const mapped = NAME_MAP[v];
    if (mapped && mapped !== v) {
      changed = true;
      return mapped;
    }
    return v;
  });
  return changed ? (next as string[]) : null;
}

/** 모든 컬렉션 스캔 → 변경 대상 목록 */
export async function previewMigration(): Promise<MigrationPreview> {
  const result: MigrationPreview = {
    total: 0,
    byCollection: { tasks: 0, kpis: 0, meetings: 0 },
    changes: [],
  };

  // tasks
  const tasksSnap = await getDocs(collection(db, 'tasks'));
  for (const d of tasksSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    const docChange: MigrationDocChange = {
      collection: 'tasks',
      docId: d.id,
      title: typeof data.title === 'string' ? data.title : undefined,
      changes: [],
    };
    const fields = ['assigneeName', 'lastModifiedBy'];
    fields.forEach((f) => {
      const next = convertString(data[f]);
      if (next !== null) {
        docChange.changes.push({ field: f, before: data[f] as string, after: next });
      }
    });
    if (docChange.changes.length > 0) {
      result.changes.push(docChange);
      result.byCollection.tasks++;
    }
  }

  // kpis
  const kpisSnap = await getDocs(collection(db, 'kpis'));
  for (const d of kpisSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    const docChange: MigrationDocChange = {
      collection: 'kpis',
      docId: d.id,
      title: typeof data.title === 'string' ? data.title : undefined,
      changes: [],
    };
    const fields = ['assigneeName', 'lastModifiedBy'];
    fields.forEach((f) => {
      const next = convertString(data[f]);
      if (next !== null) {
        docChange.changes.push({ field: f, before: data[f] as string, after: next });
      }
    });
    if (docChange.changes.length > 0) {
      result.changes.push(docChange);
      result.byCollection.kpis++;
    }
  }

  // meetings
  const meetingsSnap = await getDocs(collection(db, 'meetings'));
  for (const d of meetingsSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    const docChange: MigrationDocChange = {
      collection: 'meetings',
      docId: d.id,
      title: typeof data.periodLabel === 'string' ? data.periodLabel : undefined,
      changes: [],
    };

    // string 필드들
    const stringFields = ['createdByName', 'lastModifiedByName'];
    stringFields.forEach((f) => {
      const next = convertString(data[f]);
      if (next !== null) {
        docChange.changes.push({ field: f, before: data[f] as string, after: next });
      }
    });

    // attendees 배열
    const nextAttendees = convertStringArray(data.attendees);
    if (nextAttendees !== null) {
      docChange.changes.push({
        field: 'attendees',
        before: JSON.stringify(data.attendees),
        after: JSON.stringify(nextAttendees),
      });
    }

    if (docChange.changes.length > 0) {
      result.changes.push(docChange);
      result.byCollection.meetings++;
    }
  }

  result.total = result.changes.length;
  return result;
}

/** 미리 받은 preview 결과를 그대로 적용 */
export async function applyMigration(
  preview: MigrationPreview,
  userId: string,
): Promise<{ updated: number; failed: number; errors: string[] }> {
  let updated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const docChange of preview.changes) {
    try {
      const updates: Record<string, unknown> = {};
      docChange.changes.forEach((c) => {
        if (c.field === 'attendees') {
          updates[c.field] = JSON.parse(c.after);
        } else {
          updates[c.field] = c.after;
        }
      });
      // 마이그레이션 표시 (원하면 제거 가능)
      updates.lastMigrationAt = serverTimestamp();
      updates.lastMigrationBy = userId;

      await updateDoc(doc(db, docChange.collection, docChange.docId), updates);
      updated++;
    } catch (err) {
      failed++;
      errors.push(`${docChange.collection}/${docChange.docId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { updated, failed, errors };
}
