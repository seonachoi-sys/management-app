import * as XLSX from 'xlsx';
import {
  BudgetDetail, BudgetSubItem, Project, ProjectYear,
} from '../types/project';

// ═══ 매칭 규칙 ═══
export const ITEM_MATCH: Record<string, { categoryId: string; itemId: string }> = {
  '인건비': { categoryId: 'direct', itemId: 'labor' },
  '활동비': { categoryId: 'direct', itemId: 'activity' },
  '여비': { categoryId: 'direct', itemId: 'activity' },
  '재료비': { categoryId: 'direct', itemId: 'material' },
  '기자재': { categoryId: 'direct', itemId: 'material' },
  '연구수당': { categoryId: 'direct', itemId: 'stipend' },
  '간접비': { categoryId: 'indirect', itemId: 'indirect-cost' },
  '위탁연구비': { categoryId: 'indirect', itemId: 'indirect-cost' },
};

export const USAGE_TO_SUBITEM: Record<string, { itemId: string; subItemId: string }> = {
  '내부인건비': { itemId: 'labor', subItemId: 'labor-cash' },
  '현물인건비': { itemId: 'labor', subItemId: 'labor-inkind' },
};

// ═══ 파싱된 행 ═══
export interface RcmsRow {
  projectNumber: string;
  item: string;        // 항목 (12번째)
  usage: string;       // 사용용도 (13번째)
  execDate: string;    // 집행일자 (10번째)
  amount: number;      // 연구비사용금액 (20번째)
  status: string;      // 상태 (11번째)
  cancelled: string;   // 취소여부 (21번째)
}

// ═══ 집계 결과 ═══
export interface RcmsAggItem {
  item: string;
  usage: string;
  count: number;
  amount: number;
  matchResult: {
    categoryId: string;
    itemId: string;
    subItemId?: string;
    label: string;
  } | null;
}

export interface RcmsParsed {
  rows: RcmsRow[];
  validRows: RcmsRow[];
  projectNumbers: string[];
  dateRange: { min: string; max: string };
  aggregated: RcmsAggItem[];
  totalCount: number;
  totalAmount: number;
}

// ═══ 파일 파싱 ═══
export async function parseRcmsFile(file: File): Promise<RcmsRow[]> {
  const buffer = await file.arrayBuffer();
  let wb: XLSX.WorkBook;

  if (file.name.endsWith('.csv')) {
    // CSV: EUC-KR / UTF-8 자동 감지
    const uint8 = new Uint8Array(buffer);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(uint8);
    } catch {
      // EUC-KR fallback (브라우저 TextDecoder)
      try {
        text = new TextDecoder('euc-kr').decode(uint8);
      } catch {
        text = new TextDecoder('utf-8').decode(uint8); // 최종 fallback
      }
    }
    wb = XLSX.read(text, { type: 'string' });
  } else {
    wb = XLSX.read(buffer, { type: 'array' });
  }

  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

  // 헤더 행 찾기 (첫 번째 행이 헤더일 수도, 아닐 수도)
  let startRow = 0;
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const row = data[i];
    if (row && row.some((cell: string) => typeof cell === 'string' && cell.includes('과제번호'))) {
      startRow = i + 1;
      break;
    }
  }
  if (startRow === 0) startRow = 1; // 첫 행이 헤더라고 가정

  const rows: RcmsRow[] = [];
  for (let i = startRow; i < data.length; i++) {
    const r = data[i];
    if (!r || r.length < 20) continue;

    const amount = parseFloat(String(r[19] || '0').replace(/,/g, '')) || 0;
    if (amount === 0) continue;

    rows.push({
      projectNumber: String(r[2] || '').trim(),
      item: String(r[11] || '').trim(),
      usage: String(r[12] || '').trim(),
      execDate: String(r[9] || '').trim(),
      amount,
      status: String(r[10] || '').trim(),
      cancelled: String(r[20] || '').trim(),
    });
  }

  return rows;
}

// ═══ 유효 행 필터 ═══
export function filterValidRows(rows: RcmsRow[]): RcmsRow[] {
  return rows.filter(r =>
    r.status === '집행완료' &&
    (r.cancelled === '아니요' || r.cancelled === 'N' || r.cancelled === '')
  );
}

// ═══ 집계 + 매칭 ═══
export function aggregateAndMatch(
  validRows: RcmsRow[],
  detail: BudgetDetail | null
): RcmsAggItem[] {
  const groups = new Map<string, { item: string; usage: string; count: number; amount: number }>();

  for (const row of validRows) {
    const key = `${row.item}||${row.usage}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      existing.amount += row.amount;
    } else {
      groups.set(key, { item: row.item, usage: row.usage, count: 1, amount: row.amount });
    }
  }

  return Array.from(groups.values()).map(g => {
    const match = ITEM_MATCH[g.item];
    if (!match) {
      return { ...g, matchResult: null };
    }

    // 사용용도 → subItem 매칭
    const usageMatch = USAGE_TO_SUBITEM[g.usage];
    if (usageMatch) {
      return {
        ...g,
        matchResult: {
          ...match,
          subItemId: usageMatch.subItemId,
          label: `${g.item} > ${g.usage}`,
        },
      };
    }

    // detail의 subItems에서 이름으로 매칭
    if (detail) {
      const cat = detail.categories.find(c => c.id === match.categoryId);
      const item = cat?.items.find(i => i.id === match.itemId);
      const sub = item?.subItems.find(s => s.name === g.usage);
      if (sub) {
        return {
          ...g,
          matchResult: { ...match, subItemId: sub.id, label: `${item!.name} > ${sub.name}` },
        };
      }
    }

    // item 레벨 매칭만
    return {
      ...g,
      matchResult: { ...match, label: g.item },
    };
  });
}

// ═══ 연차 판별 ═══
export function detectYear(
  project: Project,
  dateRange: { min: string; max: string }
): { yearIndex: number; year: ProjectYear } | null {
  const mid = dateRange.min; // 시작일 기준
  for (let i = 0; i < project.years.length; i++) {
    const y = project.years[i];
    if (mid >= y.start && mid <= y.end) return { yearIndex: i, year: y };
  }
  return null;
}

// ═══ 날짜 범위 ═══
export function getDateRange(rows: RcmsRow[]): { min: string; max: string } {
  const dates = rows.map(r => r.execDate).filter(Boolean).sort();
  return { min: dates[0] || '', max: dates[dates.length - 1] || '' };
}

// ═══ 과제번호 추출 ═══
export function extractProjectNumbers(rows: RcmsRow[]): string[] {
  return Array.from(new Set(rows.map(r => r.projectNumber).filter(Boolean)));
}

// ═══ 적용 (budgetDetail 업데이트) ═══
export interface ApplyResult {
  changes: { path: string; old: number; new: number }[];
  newSubItems: { itemName: string; subName: string }[];
}

export function applyToBudgetDetail(
  detail: BudgetDetail,
  aggregated: RcmsAggItem[],
  mode: 'overwrite' | 'add'
): { newDetail: BudgetDetail; result: ApplyResult } {
  const newDetail: BudgetDetail = JSON.parse(JSON.stringify(detail));
  const changes: ApplyResult['changes'] = [];
  const newSubItems: ApplyResult['newSubItems'] = [];

  // 덮어쓰기 모드: 먼저 모든 executed를 0으로
  if (mode === 'overwrite') {
    for (const cat of newDetail.categories) {
      for (const item of cat.items) {
        item.executed = 0;
        for (const sub of item.subItems) sub.executed = 0;
      }
    }
  }

  for (const agg of aggregated) {
    if (!agg.matchResult) continue;
    const { categoryId, itemId, subItemId } = agg.matchResult;

    const cat = newDetail.categories.find(c => c.id === categoryId);
    if (!cat) continue;
    const item = cat.items.find(i => i.id === itemId);
    if (!item) continue;

    if (subItemId) {
      let sub = item.subItems.find(s => s.id === subItemId);
      if (!sub) {
        // 새 subItem 생성
        sub = { id: subItemId, name: agg.usage, budget: 0, executed: 0 };
        item.subItems.push(sub);
        newSubItems.push({ itemName: item.name, subName: agg.usage });
      }
      const old = sub.executed;
      sub.executed += agg.amount;
      changes.push({ path: `${item.name} > ${sub.name}`, old, new: sub.executed });
    } else {
      // item 레벨에 직접 합산
      const old = item.executed;
      item.executed += agg.amount;
      changes.push({ path: item.name, old, new: item.executed });
    }
  }

  return { newDetail, result: { changes, newSubItems } };
}
