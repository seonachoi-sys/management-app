import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_TASK_CATEGORIES, DEFAULT_KPI_CATEGORIES } from '../types';
import type { AppSettings } from '../types';
import {
  subscribeSettings,
  updateTaskCategories,
  updateKpiCategories,
  updateCeoMeetingDates,
} from '../services/settingsService';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>({
    categories: DEFAULT_TASK_CATEGORIES,
    taskCategories: DEFAULT_TASK_CATEGORIES,
    kpiCategories: DEFAULT_KPI_CATEGORIES,
    ceoMeetingDates: [],
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

  const saveCeoMeetingDates = useCallback(async (dates: string[]) => {
    await updateCeoMeetingDates(dates);
  }, []);

  return {
    categories: settings.taskCategories,
    taskCategories: settings.taskCategories,
    kpiCategories: settings.kpiCategories,
    ceoMeetingDates: settings.ceoMeetingDates,
    loading,
    saveTaskCategories,
    saveKpiCategories,
    saveCeoMeetingDates,
    saveCategories: saveTaskCategories, // 레거시 호환
  };
}
