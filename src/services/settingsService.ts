import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { DEFAULT_TASK_CATEGORIES, DEFAULT_KPI_CATEGORIES } from '../types';
import type { AppSettings } from '../types';

const SETTINGS_REF = doc(db, 'settings', 'app-settings');

const DEFAULTS: AppSettings = {
  categories: [...DEFAULT_TASK_CATEGORIES],
  taskCategories: [...DEFAULT_TASK_CATEGORIES],
  kpiCategories: [...DEFAULT_KPI_CATEGORIES],
};

export function subscribeSettings(
  callback: (settings: AppSettings) => void,
  onError: (error: Error) => void,
) {
  return onSnapshot(
    SETTINGS_REF,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Partial<AppSettings>;
        callback({
          categories: data.taskCategories || data.categories || DEFAULTS.taskCategories,
          taskCategories: data.taskCategories || data.categories || DEFAULTS.taskCategories,
          kpiCategories: data.kpiCategories || DEFAULTS.kpiCategories,
        });
      } else {
        // 초기값 저장
        setDoc(SETTINGS_REF, DEFAULTS).catch(() => {});
        callback(DEFAULTS);
      }
    },
    onError,
  );
}

export async function updateTaskCategories(categories: string[]): Promise<void> {
  await setDoc(SETTINGS_REF, { taskCategories: categories, categories }, { merge: true });
}

export async function updateKpiCategories(categories: string[]): Promise<void> {
  await setDoc(SETTINGS_REF, { kpiCategories: categories }, { merge: true });
}
