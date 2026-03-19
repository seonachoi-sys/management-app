import { useState, useEffect, useCallback } from 'react';
import type { Task } from '../types';
import {
  subscribeTasks,
  createTask,
  updateTask,
  deleteTask,
  type TaskFilters,
} from '../services/taskService';

export function useTasks(filters: TaskFilters = {}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeTasks(
      filters,
      (data) => {
        setTasks(data);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, [
    filters.status,
    filters.assignee,
    filters.category,
  ]);

  return { tasks, loading, error };
}

export function useCreateTask() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (data: Partial<Task>, userId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await createTask(data, userId);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '업무 생성에 실패했습니다.';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { create, loading, error };
}

export function useUpdateTask() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(async (taskId: string, data: Partial<Task>, changedBy: string, changedByName?: string) => {
    setLoading(true);
    setError(null);
    try {
      await updateTask(taskId, data, changedBy, changedByName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '업무 수정에 실패했습니다.';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { update, loading, error };
}

export function useDeleteTask() {
  const del = useCallback(async (taskId: string) => {
    await deleteTask(taskId);
  }, []);

  return { del };
}
