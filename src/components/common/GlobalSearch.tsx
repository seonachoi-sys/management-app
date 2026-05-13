import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjects } from '../../hooks/useProjects';
import { useEmployees } from '../../hooks/useEmployees';
import './GlobalSearch.css';

interface SearchResult {
  type: 'project' | 'employee' | 'page';
  label: string;
  sub: string;
  path?: string;
}

const PAGES: SearchResult[] = [
  { type: 'page', label: '수주현황', sub: '국책과제 관리', path: '/project/overview' },
  { type: 'page', label: '참여율관리', sub: '국책과제 관리', path: '/project/participation' },
  { type: 'page', label: '인건비증빙', sub: '국책과제 관리', path: '/project/payroll' },
  { type: 'page', label: '시뮬레이터', sub: '국책과제 관리', path: '/project/simulator' },
  { type: 'page', label: '업무관리', sub: '인사총무', path: '/tasks' },
];

const GlobalSearch: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { projects } = useProjects();
  const { employees } = useEmployees();

  // Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const results: SearchResult[] = (() => {
    if (!query.trim()) return PAGES;
    const q = query.toLowerCase();

    const pageResults = PAGES.filter(p =>
      p.label.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q)
    );

    const projResults = projects
      .filter(p => p.shortName?.toLowerCase().includes(q) || p.projectName?.toLowerCase().includes(q) || p.pi?.toLowerCase().includes(q))
      .slice(0, 5)
      .map(p => ({
        type: 'project' as const,
        label: p.shortName || p.projectName,
        sub: `${p.status} · ${p.pi}`,
        path: '/project/overview',
      }));

    const empResults = employees
      .filter(e => e.name?.toLowerCase().includes(q) || e.department?.toLowerCase().includes(q))
      .slice(0, 5)
      .map(e => ({
        type: 'employee' as const,
        label: e.name,
        sub: `${e.position} · ${e.department}`,
      }));

    return [...pageResults, ...projResults, ...empResults];
  })();

  const handleSelect = useCallback((item: SearchResult) => {
    if (item.path) navigate(item.path);
    setOpen(false);
  }, [navigate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIdx]) {
      handleSelect(results[selectedIdx]);
    }
  };

  if (!open) return null;

  return (
    <div className="gs-overlay" onClick={() => setOpen(false)}>
      <div className="gs-modal" onClick={e => e.stopPropagation()}>
        <div className="gs-input-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            className="gs-input"
            placeholder="연구원, 과제, 페이지 검색..."
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="gs-kbd">ESC</kbd>
        </div>
        <div className="gs-results">
          {results.length === 0 && (
            <div className="gs-empty">검색 결과가 없습니다</div>
          )}
          {results.map((r, i) => (
            <div
              key={`${r.type}-${r.label}-${i}`}
              className={`gs-result-item ${i === selectedIdx ? 'selected' : ''}`}
              onClick={() => handleSelect(r)}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span className="gs-result-type">
                {r.type === 'page' ? '📄' : r.type === 'project' ? '📊' : '👤'}
              </span>
              <div className="gs-result-text">
                <span className="gs-result-label">{r.label}</span>
                <span className="gs-result-sub">{r.sub}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default GlobalSearch;
