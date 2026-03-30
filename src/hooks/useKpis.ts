import { useState, useEffect, useCallback } from 'react';
import type { Kpi, ChildKpi } from '../types';
import {
  subscribeKpis,
  subscribeChildKpis,
  createKpi,
  updateKpi,
  deleteKpi,
  createChildKpi,
  updateChildKpi,
  deleteChildKpi,
} from '../services/kpiService';

export function useKpis() {
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeKpis(
      (data) => { setKpis(data); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); },
    );
    return unsub;
  }, []);

  const create = useCallback(async (data: Partial<Kpi>) => {
    return await createKpi(data);
  }, []);

  const update = useCallback(async (kpiId: string, data: Partial<Kpi>, userEmail?: string) => {
    await updateKpi(kpiId, data, userEmail);
  }, []);

  const remove = useCallback(async (kpiId: string) => {
    await deleteKpi(kpiId);
  }, []);

  return { kpis, loading, error, create, update, remove };
}

export function useChildKpis(parentKpiId: string | null) {
  const [children, setChildren] = useState<ChildKpi[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!parentKpiId) { setChildren([]); return; }
    setLoading(true);
    const unsub = subscribeChildKpis(
      parentKpiId,
      (data) => { setChildren(data); setLoading(false); },
      () => setLoading(false),
    );
    return unsub;
  }, [parentKpiId]);

  const create = useCallback(async (data: Partial<ChildKpi>) => {
    if (!parentKpiId) return;
    await createChildKpi(parentKpiId, data);
  }, [parentKpiId]);

  const update = useCallback(async (childKpiId: string, data: Partial<ChildKpi>, userEmail?: string) => {
    if (!parentKpiId) return;
    await updateChildKpi(parentKpiId, childKpiId, data, userEmail);
  }, [parentKpiId]);

  const remove = useCallback(async (childKpiId: string) => {
    if (!parentKpiId) return;
    await deleteChildKpi(parentKpiId, childKpiId);
  }, [parentKpiId]);

  return { children, loading, create, update, remove };
}
