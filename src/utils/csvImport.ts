import {
  collection,
  addDoc,
  getDocs,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { calculatePriorityScore } from './priorityCalculator';
import type { Task, TaskStatus, TaskPriority } from '../types';

interface CsvRow {
  구분: string;
  계층: string;
  내용: string;
  담당자: string;
  우선순위: string;
  착수일: string;
  마감일: string;
  진척도: string;
  업무완료일: string;
  '상태 설명': string;
  '결정필요 사항': string;
  '필요 자원': string;
  '미팅 요청': string;
  기타: string;
}

/* ─── CSV 파싱 ─── */
function parseCsvText(text: string): CsvRow[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || '').trim();
    });
    rows.push(row as unknown as CsvRow);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/* ─── 날짜 파싱 (오타 보정 포함) ─── */
function parseDate(raw: string): Timestamp | null {
  if (!raw) return null;
  // "20226-3-16" → "2026-3-16" 오타 보정
  let fixed = raw.replace(/^(\d{5,})/, (match) => {
    if (match.length === 5) return '20' + match.slice(2);
    return match;
  });
  // "20226" 같은 케이스
  fixed = fixed.replace(/^20226/, '2026');

  const d = new Date(fixed);
  if (isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
}

/* ─── 진척도 파싱 ─── */
function parseProgress(raw: string): number {
  if (!raw) return 0;
  const num = parseFloat(raw.replace('%', ''));
  return isNaN(num) ? 0 : Math.min(100, Math.max(0, num));
}

/* ─── 우선순위 매핑 ─── */
function mapPriority(raw: string): TaskPriority {
  if (raw.includes('1순위')) return '긴급';
  if (raw.includes('2순위')) return '높음';
  if (raw.includes('3순위')) return '보통';
  if (raw.includes('4순위')) return '낮음';
  return '보통';
}

/* ─── 상태 결정 ─── */
function deriveStatus(progress: number, dueDate: Timestamp | null, completedDate: Timestamp | null): TaskStatus {
  if (progress >= 100 && completedDate) return '완료';
  if (progress >= 100) return '완료';
  if (dueDate) {
    const due = dueDate.toDate();
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (due < now && progress < 100) return '지연';
  }
  if (progress > 0) return '진행중';
  return '대기';
}

/* ─── 중복 체크용: 기존 업무 제목 목록 가져오기 ─── */
async function getExistingTaskTitles(): Promise<Set<string>> {
  const snap = await getDocs(collection(db, 'tasks'));
  const titles = new Set<string>();
  snap.docs.forEach((d) => {
    const data = d.data();
    if (data.title) titles.add(data.title.trim());
  });
  return titles;
}

/* ─── 메인 임포트 함수 ─── */
export async function importCsvToFirestore(
  file: File,
  userId: string,
  onProgress?: (current: number, total: number, title: string) => void,
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const text = await file.text();
  const rows = parseCsvText(text);

  const existingTitles = await getExistingTaskTitles();
  const errors: string[] = [];
  let created = 0;
  let skipped = 0;

  // 1단계: 상위 업무 먼저 생성하고 ID 매핑
  // parentKey = "카테고리::상위업무명"
  const parentIdMap: Record<string, string> = {};
  let lastParentKey = '';
  let lastCategory = '';

  // 빈 행과 데이터 행 구분
  const dataRows = rows.filter((r) => r.계층 === '상위' || r.계층 === '하위');
  const totalCount = dataRows.length;

  // Pass 1: 상위 업무 생성
  for (const row of dataRows) {
    if (row.계층 !== '상위') continue;

    const category = row.구분 || lastCategory;
    lastCategory = category;
    const title = row.내용 || category;
    const parentKey = `${category}::${title}`;

    if (existingTitles.has(title)) {
      // 기존 상위 업무 ID 찾기
      const snap = await getDocs(collection(db, 'tasks'));
      const existing = snap.docs.find((d) => d.data().title === title && !d.data().parentTaskId);
      if (existing) {
        parentIdMap[parentKey] = existing.id;
      }
      skipped++;
      onProgress?.(skipped + created, totalCount, `[건너뜀] ${title}`);
      continue;
    }

    try {
      const assigneeName = row.담당자 || '';
      const progress = parseProgress(row.진척도);
      const dueDate = parseDate(row.마감일);
      const completedDate = parseDate(row.업무완료일);
      const startDate = parseDate(row.착수일);
      const ceoFlagReason = row['결정필요 사항'] || '';

      const taskData: Partial<Task> = {
        title,
        description: '',
        assignee: '',
        assigneeName,
        category,
        status: deriveStatus(progress, dueDate, completedDate),
        priority: mapPriority(row.우선순위),
        parentTaskId: null,
        startDate,
        dueDate,
        completedDate,
        progressRate: progress,
        kpiLinked: null,
        notes: row['상태 설명'] || '',
        isRecurring: false,
        recurrenceRule: null,
        ceoFlag: !!ceoFlagReason,
        ceoFlagReason,
        googleTaskId: null,
      };

      const { priorityScore, priority } = calculatePriorityScore(taskData);
      const docRef = await addDoc(collection(db, 'tasks'), {
        ...taskData,
        priorityScore,
        priority,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
      });

      parentIdMap[parentKey] = docRef.id;
      existingTitles.add(title);
      created++;
      onProgress?.(skipped + created, totalCount, `[상위] ${title}`);
    } catch (err) {
      errors.push(`상위 업무 "${title}" 생성 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Pass 2: 하위 업무 생성
  lastCategory = '';
  let currentParentKey = '';

  for (const row of dataRows) {
    if (row.계층 === '상위') {
      const category = row.구분 || lastCategory;
      lastCategory = category;
      const title = row.내용 || category;
      currentParentKey = `${category}::${title}`;
      continue;
    }

    if (row.계층 !== '하위') continue;

    const title = row.내용;
    if (!title) {
      skipped++;
      continue;
    }

    // 카테고리: 행에 있으면 사용, 없으면 마지막 상위의 카테고리
    const category = row.구분 || lastCategory;
    if (row.구분) lastCategory = row.구분;

    if (existingTitles.has(title)) {
      skipped++;
      onProgress?.(skipped + created, totalCount, `[건너뜀] ${title}`);
      continue;
    }

    try {
      const assigneeRaw = row.담당자 || '';
      // 복수 담당자 처리: 첫 번째를 메인으로, 전체를 이름에
      const assigneeName = assigneeRaw.replace(/\s/g, '');
      const progress = parseProgress(row.진척도);
      const dueDate = parseDate(row.마감일);
      const completedDate = parseDate(row.업무완료일);
      const startDate = parseDate(row.착수일);
      const ceoFlagReason = row['결정필요 사항'] || '';

      // notes 조합: 상태 설명 + 필요 자원 + 미팅 요청 + 기타
      const notesParts: string[] = [];
      if (row['상태 설명']) notesParts.push(row['상태 설명']);
      if (row['필요 자원']) notesParts.push(`[필요자원] ${row['필요 자원']}`);
      if (row['미팅 요청']) notesParts.push(`[미팅] ${row['미팅 요청']}`);
      if (row.기타) notesParts.push(row.기타);

      const parentTaskId = parentIdMap[currentParentKey] || null;

      const taskData: Partial<Task> = {
        title,
        description: '',
        assignee: '',
        assigneeName,
        category,
        status: deriveStatus(progress, dueDate, completedDate),
        priority: mapPriority(row.우선순위),
        parentTaskId,
        startDate,
        dueDate,
        completedDate,
        progressRate: progress,
        kpiLinked: null,
        notes: notesParts.join(' / '),
        isRecurring: false,
        recurrenceRule: null,
        ceoFlag: !!ceoFlagReason,
        ceoFlagReason,
        googleTaskId: null,
      };

      const { priorityScore, priority } = calculatePriorityScore(taskData);
      await addDoc(collection(db, 'tasks'), {
        ...taskData,
        priorityScore,
        priority,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
      });

      existingTitles.add(title);
      created++;
      onProgress?.(skipped + created, totalCount, `[하위] ${title}`);
    } catch (err) {
      errors.push(`하위 업무 "${title}" 생성 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { created, skipped, errors };
}
