import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_TASK_CATEGORIES, DEFAULT_KPI_CATEGORIES } from '../types';
import type { AppSettings } from '../types';
import {
  subscribeSettings,
  updateTaskCategories,
  updateKpiCategories,
} from '../services/settingsService';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>({
    categories: DEFAULT_TASK_CATEGORIES,
    taskCategories: DEFAULT_TASK_CATEGORIES,
    kpiCategories: DEFAULT_KPI_CATEGORIES,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeSettings(
      (s) => { setSettings(s); setLoading(false); },
      () => setLoading(false),
    );
    return unsub;
  }, []);

  const saveTaskCategories = useCallback(async (cats: string[]) => {
    await updateTaskCategories(cats);
  }, []);

  const saveKpiCategories = useCallback(async (cats: string[]) => {
    await updateKpiCategories(cats);
  }, []);

  return {
    categories: settings.taskCategories,
    taskCategories: settings.taskCategories,
    kpiCategories: settings.kpiCategories,
    loading,
    saveTaskCategories,
    saveKpiCategories,
    saveCategories: saveTaskCategories, // 레거시 호환
  };
}
