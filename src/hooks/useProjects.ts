import { useState, useEffect, useMemo } from 'react';
import { Project } from '../types/project';
import { subscribeProjects } from '../services/projectService';

/** 활성 과제 판별 — '진행' 또는 '신규수주' 상태 */
export function isActiveProject(p: Project): boolean {
  return p.status === '진행' || p.status === '신규수주';
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeProjects(
      (data) => {
        setProjects(data);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  const activeProjects = useMemo(() => projects.filter(isActiveProject), [projects]);
  const closedProjects = useMemo(() => projects.filter((p) => p.status === '종료'), [projects]);

  return { projects, activeProjects, closedProjects, loading, error };
}
