import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { updateProject } from './projectService';
import { logAction } from './auditService';
import {
  BudgetDetail,
  BudgetCategory,
  BudgetItem,
  BudgetSubItem,
  ProjectYear,
} from '../types/project';

// ═══ 헬퍼: 프로젝트의 years 배열에서 특정 연차를 찾아 수정 후 저장 ═══
async function getYears(projectId: string): Promise<ProjectYear[]> {
  const snap = await getDoc(doc(db, 'projects', projectId));
  if (!snap.exists()) throw new Error('과제를 찾을 수 없습니다.');
  return (snap.data().years || []) as ProjectYear[];
}

function findYearIndex(years: ProjectYear[], yearKey: number): number {
  const idx = years.findIndex(y => y.yearNumber === yearKey);
  if (idx === -1) throw new Error(`${yearKey}차 연차를 찾을 수 없습니다.`);
  return idx;
}

async function saveYears(projectId: string, years: ProjectYear[]) {
  await updateProject(projectId, { years } as any);
}

// ═══ 기본 budgetDetail 템플릿 생성 ═══
export function createDefaultBudgetDetail(): BudgetDetail {
  return {
    categories: [
      {
        id: 'direct',
        name: '직접비',
        type: 'fixed',
        items: [
          {
            id: 'labor',
            name: '인건비',
            type: 'fixed',
            budget: 0,
            executed: 0,
            subItems: [
              { id: 'labor-cash', name: '현금', budget: 0, executed: 0 },
              { id: 'labor-inkind', name: '현물', budget: 0, executed: 0 },
            ],
          },
          {
            id: 'activity',
            name: '활동비',
            type: 'fixed',
            budget: 0,
            executed: 0,
            subItems: [],
          },
          {
            id: 'material',
            name: '재료비',
            type: 'optional',
            budget: 0,
            executed: 0,
            subItems: [],
          },
          {
            id: 'stipend',
            name: '연구수당',
            type: 'optional',
            budget: 0,
            executed: 0,
            subItems: [],
          },
        ],
      },
      {
        id: 'indirect',
        name: '간접비',
        type: 'optional',
        items: [
          {
            id: 'indirect-cost',
            name: '간접비',
            type: 'fixed',
            budget: 0,
            executed: 0,
            subItems: [],
          },
        ],
      },
    ],
  };
}

// ═══ 조회 ═══
export async function getBudgetDetail(
  projectId: string,
  yearKey: number
): Promise<BudgetDetail | null> {
  const years = await getYears(projectId);
  const idx = findYearIndex(years, yearKey);
  return years[idx].budgetDetail || null;
}

// ═══ 전체 저장 ═══
export async function updateBudgetDetail(
  projectId: string,
  yearKey: number,
  budgetDetail: BudgetDetail,
  userEmail?: string
) {
  const years = await getYears(projectId);
  const idx = findYearIndex(years, yearKey);
  const old = years[idx].budgetDetail;
  years[idx] = { ...years[idx], budgetDetail };
  await saveYears(projectId, years);

  if (userEmail) {
    await logAction(
      'update', 'projects', projectId,
      `years[${idx}].budgetDetail`, old || null, budgetDetail, userEmail
    );
  }
}

// ═══ 개별 항목 수정 ═══
export async function updateBudgetItem(
  projectId: string,
  yearKey: number,
  categoryId: string,
  itemId: string,
  field: 'budget' | 'executed',
  value: number,
  userEmail?: string
) {
  const years = await getYears(projectId);
  const yIdx = findYearIndex(years, yearKey);
  const detail = years[yIdx].budgetDetail;
  if (!detail) throw new Error('budgetDetail이 없습니다. 먼저 초기화하세요.');

  const cat = detail.categories.find(c => c.id === categoryId);
  if (!cat) throw new Error(`카테고리 ${categoryId}를 찾을 수 없습니다.`);

  const item = cat.items.find(i => i.id === itemId);
  if (!item) throw new Error(`항목 ${itemId}를 찾을 수 없습니다.`);

  const oldValue = item[field];
  item[field] = value;

  years[yIdx] = { ...years[yIdx], budgetDetail: detail };
  await saveYears(projectId, years);

  if (userEmail) {
    await logAction(
      'update', 'projects', projectId,
      `budgetDetail.${categoryId}.${itemId}.${field}`, oldValue, value, userEmail
    );
  }
}

// ═══ 서브 아이템 추가 ═══
export async function addSubItem(
  projectId: string,
  yearKey: number,
  categoryId: string,
  itemId: string,
  subItem: BudgetSubItem,
  userEmail?: string
) {
  const years = await getYears(projectId);
  const yIdx = findYearIndex(years, yearKey);
  const detail = years[yIdx].budgetDetail;
  if (!detail) throw new Error('budgetDetail이 없습니다.');

  const cat = detail.categories.find(c => c.id === categoryId);
  if (!cat) throw new Error(`카테고리 ${categoryId}를 찾을 수 없습니다.`);

  const item = cat.items.find(i => i.id === itemId);
  if (!item) throw new Error(`항목 ${itemId}를 찾을 수 없습니다.`);

  item.subItems.push(subItem);
  years[yIdx] = { ...years[yIdx], budgetDetail: detail };
  await saveYears(projectId, years);

  if (userEmail) {
    await logAction(
      'add', 'projects', projectId,
      `budgetDetail.${categoryId}.${itemId}.subItems`, null, subItem, userEmail
    );
  }
}

// ═══ 서브 아이템 삭제 ═══
export async function removeSubItem(
  projectId: string,
  yearKey: number,
  categoryId: string,
  itemId: string,
  subItemId: string,
  userEmail?: string
) {
  const years = await getYears(projectId);
  const yIdx = findYearIndex(years, yearKey);
  const detail = years[yIdx].budgetDetail;
  if (!detail) throw new Error('budgetDetail이 없습니다.');

  const cat = detail.categories.find(c => c.id === categoryId);
  if (!cat) throw new Error(`카테고리 ${categoryId}를 찾을 수 없습니다.`);

  const item = cat.items.find(i => i.id === itemId);
  if (!item) throw new Error(`항목 ${itemId}를 찾을 수 없습니다.`);

  const removed = item.subItems.find(s => s.id === subItemId);
  item.subItems = item.subItems.filter(s => s.id !== subItemId);
  years[yIdx] = { ...years[yIdx], budgetDetail: detail };
  await saveYears(projectId, years);

  if (userEmail) {
    await logAction(
      'delete', 'projects', projectId,
      `budgetDetail.${categoryId}.${itemId}.subItems.${subItemId}`, removed, null, userEmail
    );
  }
}

// ═══ optional 항목 추가 ═══
export async function addOptionalItem(
  projectId: string,
  yearKey: number,
  categoryId: string,
  item: BudgetItem,
  userEmail?: string
) {
  const years = await getYears(projectId);
  const yIdx = findYearIndex(years, yearKey);
  const detail = years[yIdx].budgetDetail;
  if (!detail) throw new Error('budgetDetail이 없습니다.');

  const cat = detail.categories.find(c => c.id === categoryId);
  if (!cat) throw new Error(`카테고리 ${categoryId}를 찾을 수 없습니다.`);

  cat.items.push(item);
  years[yIdx] = { ...years[yIdx], budgetDetail: detail };
  await saveYears(projectId, years);

  if (userEmail) {
    await logAction(
      'add', 'projects', projectId,
      `budgetDetail.${categoryId}.items`, null, item, userEmail
    );
  }
}

// ═══ optional 항목 삭제 ═══
export async function removeOptionalItem(
  projectId: string,
  yearKey: number,
  categoryId: string,
  itemId: string,
  userEmail?: string
) {
  const years = await getYears(projectId);
  const yIdx = findYearIndex(years, yearKey);
  const detail = years[yIdx].budgetDetail;
  if (!detail) throw new Error('budgetDetail이 없습니다.');

  const cat = detail.categories.find(c => c.id === categoryId);
  if (!cat) throw new Error(`카테고리 ${categoryId}를 찾을 수 없습니다.`);

  const removed = cat.items.find(i => i.id === itemId);
  if (removed?.type === 'fixed') throw new Error('고정 항목은 삭제할 수 없습니다.');

  cat.items = cat.items.filter(i => i.id !== itemId);
  years[yIdx] = { ...years[yIdx], budgetDetail: detail };
  await saveYears(projectId, years);

  if (userEmail) {
    await logAction(
      'delete', 'projects', projectId,
      `budgetDetail.${categoryId}.items.${itemId}`, removed, null, userEmail
    );
  }
}
