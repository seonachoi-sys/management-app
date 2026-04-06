import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Timestamp } from 'firebase/firestore';
import type { Kpi, ChildKpi, KpiPeriod, KpiStatus, Task } from '../types';
import { useKpis, useChildKpis } from '../hooks/useKpis';
import { useTasks } from '../hooks/useTasks';
import { useSettings } from '../hooks/useSettings';
import { useMembers } from '../hooks/useMembers';
// calcAchievementRate/calcKpiStatus는 kpiService 내부에서 자동계산 시 사용
import { daysLeft, dDayLabel, formatShort } from '../utils/dateUtils';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

const PERIOD_COLOR: Record<KpiPeriod, string> = {
  '월간': 'var(--tm-brand)',
  '분기': '#7c3aed',
  '반기': '#0891b2',
  '연간': 'var(--tm-success)',
};

const STATUS_COLOR: Record<KpiStatus, string> = {
  '대기': '#999',
  '진행중': 'var(--c-accent, #2f6ce5)',
  '완료': 'var(--c-green, #0d9f61)',
  '달성': 'var(--tm-success, #0d9f61)',
  '위험': 'var(--c-red, #e03e3e)',
};

const KPI_STATUS_OPTIONS: KpiStatus[] = ['대기', '진행중', '완료'];

/* ─── KPI 상태 드롭다운 ─── */
function KpiStatusDropdown({ current, onChange }: { current: KpiStatus; onChange: (s: KpiStatus) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(!open);
  };

  // 외부 클릭 닫기
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  const color = STATUS_COLOR[current] || '#999';
  return (
    <span style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <button ref={btnRef} className="tm-status-badge-sm" style={{ color, borderColor: color }} onClick={handleOpen}>
        {current}
      </button>
      {open && (
        <div className="tm-status-menu" style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 200 }}>
          {KPI_STATUS_OPTIONS.map((s) => (
            <button key={s} className={`tm-status-option ${s === current ? 'selected' : ''}`}
              style={{ color: STATUS_COLOR[s] }}
              onClick={() => { if (s !== current) onChange(s); setOpen(false); }}>
              {s}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/* ─── D-Day CSS 클래스 ─── */
function getKpiDdayClass(endDate: Kpi['endDate']): string {
  const d = daysLeft(endDate);
  if (d === null) return '';
  if (d < 0) return 'dday-overdue';
  if (d === 0) return 'dday-today';
  if (d <= 3) return 'dday-soon';
  return 'dday-normal';
}

/* ─── 수정 시간 포맷 ─── */
function formatModifiedAt(ts: Timestamp | null | undefined): string {
  if (!ts) return '';
  const d = ts instanceof Timestamp ? ts.toDate() : null;
  if (!d) return '';
  return format(d, 'M.d a h:mm', { locale: ko });
}

export default function KpiPanel() {
  const { kpis, loading, create, update, remove } = useKpis();
  const { tasks } = useTasks({});
  const { members } = useMembers();
  const [periodFilter, setPeriodFilter] = useState<KpiPeriod | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [editingKpi, setEditingKpi] = useState<Kpi | null>(null);
  const [editingChild, setEditingChild] = useState<{ child: ChildKpi | null; parentId: string } | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const toastIdRef = useRef(0);
  const addToast = useCallback((message: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  const handleKpiStatusChange = useCallback(async (kpiId: string, newStatus: KpiStatus, kpi: Kpi) => {
    if (newStatus === '완료' && (kpi.progressRate || 0) < 100) {
      if (!window.confirm(`완료 처리하시겠습니까? 현재 진행률 ${kpi.progressRate || 0}%`)) return;
    }
    const data: Partial<Kpi> = { status: newStatus };
    if (newStatus === '완료') {
      data.completedDate = Timestamp.now() as any;
    }
    await update(kpiId, data);
    addToast(`"${kpi.title}" 상태가 ${newStatus}(으)로 변경되었습니다`);
  }, [update, addToast]);

  const handleChildStatusChange = useCallback(async (parentKpiId: string, childKpiId: string, newStatus: KpiStatus, child: ChildKpi) => {
    if (newStatus === '완료' && (child.progressRate || 0) < 100) {
      if (!window.confirm(`완료 처리하시겠습니까? 현재 진행률 ${child.progressRate || 0}%`)) return;
    }
    const { updateChildKpi, fetchChildKpis } = await import('../services/kpiService');
    const data: Partial<ChildKpi> = { status: newStatus };
    if (newStatus === '완료') {
      data.completedDate = Timestamp.now() as any;
    }
    await updateChildKpi(parentKpiId, childKpiId, data);
    addToast(`"${child.title}" 상태가 ${newStatus}(으)로 변경되었습니다`);

    // 하위 KPI 전부 완료 시 상위 KPI 자동 완료
    if (newStatus === '완료') {
      const siblings = await fetchChildKpis(parentKpiId);
      const allDone = siblings.every((c) =>
        c.childKpiId === childKpiId ? true : c.status === '완료' || c.status === '달성',
      );
      if (allDone && siblings.length > 0) {
        const parent = kpis.find((k) => k.kpiId === parentKpiId);
        await update(parentKpiId, { status: '완료', completedDate: Timestamp.now() } as Partial<Kpi>);
        if (parent) {
          addToast(`"${parent.title}" 하위 KPI 전부 완료로 자동 완료 처리되었습니다`);
        }
      }
    }
  }, [addToast, kpis, update]);

  const filtered = useMemo(() => {
    if (!periodFilter) return kpis;
    return kpis.filter((k) => k.period === periodFilter);
  }, [kpis, periodFilter]);

  const stats = useMemo(() => ({
    total: kpis.length,
    achieved: kpis.filter((k) => k.status === '달성' || k.status === '완료').length,
    inProgress: kpis.filter((k) => k.status === '진행중').length,
    risk: kpis.filter((k) => k.status === '위험').length,
  }), [kpis]);

  // ─── 사이드바 데이터 ───
  const kpiSidebar = useMemo(() => {
    const total = kpis.length;
    const achieved = kpis.filter((k) => k.status === '달성' || k.status === '완료').length;
    const pct = total > 0 ? Math.round((achieved / total) * 100) : 0;

    // 위험 KPI (진행률 30% 이하)
    const riskKpis = kpis.filter((k) => (k.progressRate || 0) <= 30 && k.status !== '완료' && k.status !== '달성');

    // 담당자별 현황
    const memberMap: Record<string, { done: number; progress: number }> = {};
    kpis.forEach((k) => {
      const name = k.assigneeName || '미배정';
      if (!memberMap[name]) memberMap[name] = { done: 0, progress: 0 };
      if (k.status === '완료' || k.status === '달성') memberMap[name].done++;
      else memberMap[name].progress++;
    });
    const memberStats = Object.entries(memberMap).sort((a, b) => b[1].progress - a[1].progress);

    // 담당자별 평균 진행률
    const rateMap: Record<string, { sum: number; count: number }> = {};
    kpis.forEach((k) => {
      const name = k.assigneeName || '미배정';
      if (!rateMap[name]) rateMap[name] = { sum: 0, count: 0 };
      rateMap[name].sum += (k.progressRate || 0);
      rateMap[name].count++;
    });
    const memberRates = Object.entries(rateMap)
      .map(([name, d]) => ({ name, pct: d.count > 0 ? Math.round(d.sum / d.count) : 0, done: memberMap[name]?.done || 0, total: (memberMap[name]?.done || 0) + (memberMap[name]?.progress || 0) }))
      .sort((a, b) => b.pct - a.pct);

    return { total, achieved, pct, riskKpis, memberStats, memberRates };
  }, [kpis]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="tm" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 통계 카드 */}
      <div className="tm-stats">
        <div className="tm-stat-card stat-total">
          <div className="tm-stat-label">전체 KPI</div>
          <div className="tm-stat-value">{stats.total}</div>
        </div>
        <div className="tm-stat-card stat-done">
          <div className="tm-stat-label">달성</div>
          <div className="tm-stat-value">{stats.achieved}</div>
        </div>
        <div className="tm-stat-card stat-progress">
          <div className="tm-stat-label">진행중</div>
          <div className="tm-stat-value">{stats.inProgress}</div>
        </div>
        <div className="tm-stat-card stat-delayed">
          <div className="tm-stat-label">위험</div>
          <div className="tm-stat-value">{stats.risk}</div>
        </div>
      </div>

      {/* 메인 레이아웃 */}
      <div className="tm-dashboard-layout">
        <div className="tm-main-col">
          {/* 필터 + 추가 */}
          <div className="tm-controls">
            <div className="tm-filters">
              {(['', '월간', '분기', '반기', '연간'] as (KpiPeriod | '')[]).map((p) => (
                <button key={p} className={`tm-filter ${periodFilter === p ? 'active' : ''}`}
                  onClick={() => setPeriodFilter(p)}>
                  {p || '전체'}
                </button>
              ))}
            </div>
            <button className="tm-btn-add" onClick={() => { setEditingKpi(null); setEditingChild(null); setShowForm(true); }}>
              + KPI 추가
            </button>
          </div>

          {/* KPI 목록 */}
          {loading ? (
            <div className="tm-loading">KPI를 불러오는 중...</div>
          ) : filtered.length === 0 ? (
            <div className="tm-empty">등록된 KPI가 없습니다.</div>
          ) : (
            <div className="tm-tasks">
              {filtered.map((kpi) => (
                <KpiCardWithChildren
                  key={kpi.kpiId}
                  kpi={kpi}
                  tasks={tasks}
                  expanded={expandedIds.has(kpi.kpiId)}
                  onToggle={() => toggleExpand(kpi.kpiId)}
                  onEdit={() => { setEditingKpi(kpi); setEditingChild(null); setShowForm(true); }}
                  onDelete={() => { if (window.confirm('이 KPI를 삭제하시겠습니까?')) remove(kpi.kpiId); }}
                  onEditChild={(child) => { setEditingChild({ child, parentId: kpi.kpiId }); setEditingKpi(null); setShowForm(true); }}
                  onAddChild={() => { setEditingChild({ child: null, parentId: kpi.kpiId }); setEditingKpi(null); setShowForm(true); }}
                  onStatusChange={(newStatus) => handleKpiStatusChange(kpi.kpiId, newStatus, kpi)}
                  onChildStatusChange={(childKpiId, newStatus, child) => handleChildStatusChange(kpi.kpiId, childKpiId, newStatus, child)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 사이드 패널 */}
        <div className="tm-side-col">
          {/* 전체 KPI 달성률 */}
          <div className="sidebar-card">
            <div className="sidebar-title">전체 KPI 달성률</div>
            <div className="sidebar-stat-row">
              <span className="sidebar-big">{kpiSidebar.achieved} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--c-text-3)' }}>/ {kpiSidebar.total} 완료</span></span>
              <span className="sidebar-pct" style={{ color: 'var(--c-green)' }}>{kpiSidebar.pct}%</span>
            </div>
            <div className="sidebar-bar">
              <div className="sidebar-bar-fill" style={{ width: `${kpiSidebar.pct}%`, background: 'var(--c-green)' }} />
            </div>
          </div>

          {/* 위험 KPI */}
          {kpiSidebar.riskKpis.length > 0 && (
            <div className="sidebar-card">
              <div className="sidebar-title" style={{ color: 'var(--c-red)' }}>위험 KPI ({kpiSidebar.riskKpis.length})</div>
              <div className="sidebar-list">
                {kpiSidebar.riskKpis.map((k) => (
                  <div key={k.kpiId} className="sidebar-list-item">
                    <span className="sidebar-dot" style={{ background: 'var(--c-red)' }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.title}</span>
                    <span className="sidebar-meta">{k.assigneeName} · {k.progressRate || 0}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 담당자별 KPI 달성률 */}
          <div className="sidebar-card">
            <div className="sidebar-title">담당자별 KPI 진행률</div>
            {kpiSidebar.memberRates.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--c-text-3)', padding: '8px 0' }}>데이터 없음</div>
            ) : kpiSidebar.memberRates.map((a) => {
              const COLORS: Record<string, string> = { '최선아': 'var(--c-accent)', '송은정': 'var(--c-green)', '이웅해': 'var(--c-orange)' };
              const barColor = COLORS[a.name] || 'var(--c-text-4)';
              return (
                <div key={a.name} className="sidebar-progress-row">
                  <span className="sidebar-progress-name">{a.name}</span>
                  <div className="sidebar-progress-bar-wrap">
                    <div className="sidebar-bar" style={{ margin: 0, flex: 1 }}>
                      <div className="sidebar-bar-fill" style={{ width: `${Math.min(a.pct, 100)}%`, background: barColor }} />
                    </div>
                    <span className="sidebar-progress-pct" style={{ color: barColor }}>{a.pct}%</span>
                  </div>
                  <span className="sidebar-progress-detail">{a.done}/{a.total}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 폼 모달 */}
      {showForm && (
        <KpiFormModal
          kpi={editingKpi}
          childEdit={editingChild}
          parentKpis={kpis}
          tasks={tasks}
          members={members}
          onSave={async (data, isChild, parentId) => {
            if (isChild && parentId) {
              const { createChildKpi, updateChildKpi } = await import('../services/kpiService');
              if (editingChild?.child) {
                await updateChildKpi(parentId, editingChild.child.childKpiId, data as Partial<ChildKpi>);
              } else {
                await createChildKpi(parentId, data as Partial<ChildKpi>);
              }
            } else if (editingKpi) {
              await update(editingKpi.kpiId, data as Partial<Kpi>);
            } else {
              await create(data as Partial<Kpi>);
            }
            setShowForm(false);
            setEditingKpi(null);
            setEditingChild(null);
          }}
          onClose={() => { setShowForm(false); setEditingKpi(null); setEditingChild(null); }}
        />
      )}

      {/* 토스트 */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className="toast-item toast-success">
              <span className="toast-icon">✓</span>
              <span className="toast-msg">{t.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── KPI 카드 (하위 포함) ─── */
function KpiCardWithChildren({
  kpi, tasks, expanded, onToggle, onEdit, onDelete, onEditChild, onAddChild, onStatusChange, onChildStatusChange,
}: {
  kpi: Kpi;
  tasks: Task[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEditChild: (child: ChildKpi) => void;
  onAddChild: () => void;
  onStatusChange: (status: KpiStatus) => void;
  onChildStatusChange: (childKpiId: string, status: KpiStatus, child: ChildKpi) => void;
}) {
  const { children } = useChildKpis(expanded || kpi.childKpiIds?.length > 0 ? kpi.kpiId : null);
  const statusColor = STATUS_COLOR[kpi.status];
  const periodColor = PERIOD_COLOR[kpi.period];

  // 연결업무 완료 현황
  const linkedTaskStats = useMemo(() => {
    if (!kpi.linkedTaskIds?.length) return null;
    const linked = tasks.filter(t => kpi.linkedTaskIds.includes(t.taskId));
    const completed = linked.filter(t => t.status === '완료').length;
    return { completed, total: linked.length };
  }, [kpi.linkedTaskIds, tasks]);

  return (
    <div>
      <div className="tm-task" style={{ borderLeft: `3px solid ${statusColor}` }}>
        {/* 접기/펼치기 */}
        {(kpi.childKpiIds?.length > 0 || children.length > 0) && (
          <button className="tm-cat-arrow" onClick={onToggle} style={{ alignSelf: 'flex-start', marginTop: 6, border: 'none', background: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--c-text-3)' }}>
            {expanded ? '▼' : '▶'}
          </button>
        )}

        <div className="tm-task-body">
          <div className="tm-task-header">
            <span className="tm-task-title">{kpi.title}</span>
            <span className="kpi-badge" style={{ background: `${periodColor}15`, color: periodColor }}>
              {kpi.period}
            </span>
            <KpiStatusDropdown current={kpi.status} onChange={onStatusChange} />
            {/* D-Day 배지 */}
            {kpi.endDate && kpi.status !== '완료' && kpi.status !== '달성' && (
              <span className={`tm-dday ${getKpiDdayClass(kpi.endDate)}`}>
                {dDayLabel(kpi.endDate)}
              </span>
            )}
            {children.length > 0 && (
              <span className="kpi-meta-tag">하위 {children.length}</span>
            )}
            {/* 연결업무 완료 현황 */}
            {linkedTaskStats && (
              <span className="kpi-meta-tag kpi-linked-progress">
                연결업무 {linkedTaskStats.completed}/{linkedTaskStats.total} 완료
              </span>
            )}
          </div>

          {kpi.description && <div className="tm-task-desc">{kpi.description}</div>}
          {kpi.notes && <div className="kpi-notes">{kpi.notes}</div>}

          {/* 진행률 바 */}
          <div className="kpi-progress-row">
            <div className="tm-progress-bar" style={{ flex: 1, height: 6 }}>
              <div className="tm-progress-fill" style={{ width: `${Math.min(kpi.progressRate || 0, 100)}%`, background: statusColor }} />
            </div>
            <span className="tm-progress-text" style={{ color: statusColor, fontWeight: 700 }}>
              {kpi.progressRate || 0}%
            </span>
          </div>

          {/* 진행상황 텍스트 */}
          {kpi.progressNote && (
            <div className="kpi-progress-note">{kpi.progressNote}</div>
          )}

          {/* 마일스톤 체크리스트 */}
          {(kpi.milestones?.length > 0) && (
            <div className="kpi-milestones">
              {kpi.milestones.map((ms, i) => (
                <label key={i} className={`kpi-milestone-item ${ms.done ? 'done' : ''}`}>
                  <input type="checkbox" checked={ms.done} onChange={async () => {
                    const newMs = kpi.milestones.map((m, j) => j === i ? { ...m, done: !m.done } : m);
                    const doneCount = newMs.filter(m => m.done).length;
                    const newRate = newMs.length > 0 ? Math.round((doneCount / newMs.length) * 100) : 0;
                    const { updateKpi } = await import('../services/kpiService');
                    await updateKpi(kpi.kpiId, { milestones: newMs, progressRate: newRate });
                  }} />
                  <span>{ms.label}</span>
                </label>
              ))}
            </div>
          )}

          <div className="tm-task-meta">
            {kpi.assigneeName && <span>{kpi.assigneeName}</span>}
            {(kpi.startDate || kpi.endDate) && (
              <span className="kpi-date-range">
                {kpi.startDate ? formatShort(kpi.startDate) : '?'} ~ {kpi.endDate ? formatShort(kpi.endDate) : '?'}
              </span>
            )}
            {kpi.lastModifiedBy && kpi.lastModifiedAt && (
              <span className="tm-modified-info">
                {kpi.lastModifiedBy} 수정 · {formatModifiedAt(kpi.lastModifiedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="tm-task-actions">
          <button onClick={onAddChild}>+하위</button>
          <button onClick={onEdit}>수정</button>
          <button className="btn-delete" onClick={onDelete}>삭제</button>
        </div>
      </div>

      {/* 하위 KPI */}
      {expanded && children.map((child) => {
        const childColor = STATUS_COLOR[child.status] || 'var(--c-line)';
        return (
          <div key={child.childKpiId} className="tm-task kpi-child" style={{ borderLeft: `2px solid ${childColor}` }}>
            <div className="tm-task-body">
              <div className="tm-task-header">
                <span className="kpi-child-arrow">└</span>
                <span className="tm-task-title">{child.title}</span>
                <KpiStatusDropdown current={child.status} onChange={(s) => onChildStatusChange(child.childKpiId, s, child)} />
                {/* 하위 KPI D-Day */}
                {child.endDate && child.status !== '완료' && child.status !== '달성' && (
                  <span className={`tm-dday ${getKpiDdayClass(child.endDate)}`}>
                    {dDayLabel(child.endDate)}
                  </span>
                )}
              </div>
              {child.notes && <div className="kpi-notes">{child.notes}</div>}

              {/* 진행률 바 */}
              <div className="kpi-progress-row">
                <div className="tm-progress-bar" style={{ flex: 1, height: 5 }}>
                  <div className="tm-progress-fill" style={{ width: `${Math.min(child.progressRate || 0, 100)}%`, background: childColor }} />
                </div>
                <span className="tm-progress-text" style={{ color: childColor, fontWeight: 700 }}>
                  {child.progressRate || 0}%
                </span>
              </div>

              {child.progressNote && (
                <div className="kpi-progress-note">{child.progressNote}</div>
              )}

              {(child.milestones?.length > 0) && (
                <div className="kpi-milestones">
                  {child.milestones.map((ms, i) => (
                    <label key={i} className={`kpi-milestone-item ${ms.done ? 'done' : ''}`}>
                      <input type="checkbox" checked={ms.done} onChange={async () => {
                        const newMs = child.milestones.map((m, j) => j === i ? { ...m, done: !m.done } : m);
                        const doneCount = newMs.filter(m => m.done).length;
                        const newRate = newMs.length > 0 ? Math.round((doneCount / newMs.length) * 100) : 0;
                        const { updateChildKpi } = await import('../services/kpiService');
                        await updateChildKpi(kpi.kpiId, child.childKpiId, { milestones: newMs, progressRate: newRate });
                      }} />
                      <span>{ms.label}</span>
                    </label>
                  ))}
                </div>
              )}
              <div className="tm-task-meta">
                {child.assigneeName && <span>{child.assigneeName}</span>}
                {(child.startDate || child.endDate) && (
                  <span className="kpi-date-range">
                    {child.startDate ? formatShort(child.startDate) : '?'} ~ {child.endDate ? formatShort(child.endDate) : '?'}
                  </span>
                )}
                {child.lastModifiedBy && child.lastModifiedAt && (
                  <span className="tm-modified-info">
                    {child.lastModifiedBy} 수정 · {formatModifiedAt(child.lastModifiedAt)}
                  </span>
                )}
              </div>
            </div>
            <div className="tm-task-actions">
              <button onClick={() => onEditChild(child)}>수정</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── KPI 폼 모달 ─── */
function KpiFormModal({
  kpi,
  childEdit,
  parentKpis,
  tasks,
  members,
  onSave,
  onClose,
}: {
  kpi: Kpi | null;
  childEdit: { child: ChildKpi | null; parentId: string } | null;
  parentKpis: Kpi[];
  tasks: Task[];
  members: { memberId: string; name: string }[];
  onSave: (data: Record<string, any>, isChild: boolean, parentId?: string) => Promise<void>;
  onClose: () => void;
}) {
  const isChild = !!childEdit;
  const existing = isChild ? childEdit?.child : kpi;
  const { kpiCategories } = useSettings();

  const [form, setForm] = useState({
    title: (existing as any)?.title || '',
    description: (existing as any)?.description || '',
    notes: (existing as any)?.notes || '',
    assigneeName: (existing as any)?.assigneeName || '',
    period: (existing as any)?.period || '분기' as KpiPeriod,
    targetValue: (existing as any)?.targetValue || 0,
    currentValue: (existing as any)?.currentValue || 0,
    unit: (existing as any)?.unit || '',
    progressRate: (existing as any)?.progressRate || 0,
    progressNote: (existing as any)?.progressNote || '',
    milestones: (existing as any)?.milestones || [] as { label: string; done: boolean }[],
    newMilestone: '',
    startDate: tsToStr((existing as any)?.startDate),
    endDate: tsToStr((existing as any)?.endDate),
    linkedTaskIds: (existing as any)?.linkedTaskIds || [] as string[],
    isChild,
    parentId: childEdit?.parentId || '',
  });
  const [saving, setSaving] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const toggleTask = (taskId: string) => {
    setForm((f) => {
      const ids = f.linkedTaskIds.includes(taskId)
        ? f.linkedTaskIds.filter((id: string) => id !== taskId)
        : [...f.linkedTaskIds, taskId];
      return { ...f, linkedTaskIds: ids };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { alert('KPI 명을 입력하세요.'); return; }
    setSaving(true);
    try {
      const data: Record<string, any> = {
        title: form.title.trim(),
        description: form.description.trim(),
        notes: form.notes.trim(),
        assignee: form.assigneeName,
        assigneeName: form.assigneeName,
        period: form.period,
        targetValue: Number(form.targetValue),
        currentValue: Number(form.currentValue),
        unit: form.unit,
        progressRate: Number(form.progressRate),
        progressNote: form.progressNote.trim(),
        milestones: form.milestones,
        startDate: form.startDate ? Timestamp.fromDate(new Date(form.startDate + 'T00:00:00')) : null,
        endDate: form.endDate ? Timestamp.fromDate(new Date(form.endDate + 'T00:00:00')) : null,
        linkedTaskIds: form.linkedTaskIds,
      };
      if (!form.isChild) {
        data.isParent = true;
      }
      await onSave(data, form.isChild, form.isChild ? form.parentId : undefined);
    } catch (err: any) {
      alert(err?.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tm-modal-overlay" onClick={onClose}>
      <div className="tm-modal" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
        <h2>{existing ? 'KPI 수정' : isChild ? '하위 KPI 추가' : '새 KPI'}</h2>
        <form onSubmit={handleSubmit}>
          {/* 상위/하위 선택 (신규만) */}
          {!existing && !childEdit && (
            <div className="tm-form-row" style={{ marginBottom: 12 }}>
              <label className="tm-checkbox">
                <input type="checkbox" checked={form.isChild}
                  onChange={(e) => setForm((f) => ({ ...f, isChild: e.target.checked }))} />
                하위 KPI로 등록
              </label>
              {form.isChild && (
                <label>
                  상위 KPI
                  <select name="parentId" value={form.parentId} onChange={handleChange}>
                    <option value="">선택</option>
                    {parentKpis.map((p) => <option key={p.kpiId} value={p.kpiId}>{p.title}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}

          <label>KPI 명 *
            <input name="title" value={form.title} onChange={handleChange} placeholder="예: 월간 매출 목표" autoFocus />
          </label>
          <label>설명
            <textarea name="description" value={form.description} onChange={handleChange} rows={2} placeholder="KPI 상세 설명" />
          </label>
          <label>메모/노트
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={2} placeholder="참고사항, 진행 메모 등" />
          </label>

          {/* 진행률 슬라이더 */}
          <label>진행률: {form.progressRate}%
            <input name="progressRate" type="range" min="0" max="100" step="5"
              value={form.progressRate} onChange={handleChange}
              style={{ width: '100%', accentColor: 'var(--c-accent)' }} />
          </label>

          {/* 진행상황 텍스트 */}
          <label>현재 진행상황
            <textarea name="progressNote" value={form.progressNote} onChange={handleChange} rows={2}
              placeholder="예: 1차 초안 작성 완료, 다음주 검토 예정" />
          </label>

          {/* 마일스톤 체크리스트 */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-2)', marginBottom: 6 }}>
              단계 체크리스트 ({form.milestones.filter((m: { done: boolean }) => m.done).length}/{form.milestones.length})
            </div>
            {form.milestones.map((ms: { label: string; done: boolean }, i: number) => (
              <div key={i} className="kpi-milestone-edit-row">
                <input type="checkbox" checked={ms.done}
                  onChange={() => setForm(f => ({
                    ...f,
                    milestones: f.milestones.map((m: { label: string; done: boolean }, j: number) => j === i ? { ...m, done: !m.done } : m),
                  }))}
                  style={{ width: 14, height: 14 }} />
                <input value={ms.label}
                  onChange={(e) => setForm(f => ({
                    ...f,
                    milestones: f.milestones.map((m: { label: string; done: boolean }, j: number) => j === i ? { ...m, label: e.target.value } : m),
                  }))}
                  style={{ flex: 1, fontSize: 13 }} />
                <button type="button" onClick={() => setForm(f => ({
                  ...f,
                  milestones: f.milestones.filter((_: unknown, j: number) => j !== i),
                }))} style={{ fontSize: 11, color: 'var(--c-red)', background: 'none', border: 'none', cursor: 'pointer' }}>삭제</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <input placeholder="새 단계 추가..." value={form.newMilestone}
                onChange={(e) => setForm(f => ({ ...f, newMilestone: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && form.newMilestone.trim()) {
                    e.preventDefault();
                    setForm(f => ({
                      ...f,
                      milestones: [...f.milestones, { label: f.newMilestone.trim(), done: false }],
                      newMilestone: '',
                    }));
                  }
                }}
                style={{ flex: 1, fontSize: 13 }} />
              <button type="button" onClick={() => {
                if (!form.newMilestone.trim()) return;
                setForm(f => ({
                  ...f,
                  milestones: [...f.milestones, { label: f.newMilestone.trim(), done: false }],
                  newMilestone: '',
                }));
              }} className="tm-btn-add" style={{ padding: '4px 10px', fontSize: 12 }}>추가</button>
            </div>
          </div>

          <div className="tm-form-row-3">
            <label>기간
              <select name="period" value={form.period} onChange={handleChange}>
                {(['월간', '분기', '반기', '연간'] as KpiPeriod[]).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label>시작일
              <input name="startDate" type="date" value={form.startDate} onChange={handleChange} />
            </label>
            <label>종료일
              <input name="endDate" type="date" value={form.endDate} onChange={handleChange} />
            </label>
          </div>

          <label>담당자
            <select name="assigneeName" value={form.assigneeName} onChange={handleChange}>
              <option value="">선택</option>
              {members.map((m) => (
                <option key={m.memberId} value={m.name}>{m.name}</option>
              ))}
            </select>
          </label>

          {/* 진행률 미리보기 */}
          {Number(form.progressRate) > 0 && (
            <div style={{
              margin: '12px 0', padding: 10,
              background: 'var(--tm-surface-inset)', borderRadius: 'var(--tm-radius-sm)',
              display: 'flex', alignItems: 'center', gap: 12, fontSize: 13,
            }}>
              <span>진행률:</span>
              <strong style={{ fontFamily: 'var(--tm-font-mono)' }}>{form.progressRate}%</strong>
              <div style={{ flex: 1, height: 5, background: 'var(--tm-surface-card)', borderRadius: 100, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(Number(form.progressRate), 100)}%`, background: 'var(--c-accent)', borderRadius: 100 }} />
              </div>
            </div>
          )}

          {/* 업무 연결 */}
          {tasks.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-2)', marginBottom: 6, letterSpacing: '0.02em' }}>
                업무 연결 ({form.linkedTaskIds.length}건 선택)
              </div>
              <div className="kpi-task-link-list">
                <input
                  className="kpi-task-search"
                  placeholder="업무명 검색..."
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                />
                {(() => {
                  const q = taskSearch.trim().toLowerCase();
                  const filtered = q ? tasks.filter((t) => t.title.toLowerCase().includes(q)) : tasks;
                  // 선택된 업무 먼저, 카테고리별 그룹핑
                  const selected = filtered.filter((t) => form.linkedTaskIds.includes(t.taskId));
                  const unselected = filtered.filter((t) => !form.linkedTaskIds.includes(t.taskId));
                  const grouped: Record<string, Task[]> = {};
                  for (const t of [...selected, ...unselected]) {
                    const cat = t.category || '기타';
                    if (!grouped[cat]) grouped[cat] = [];
                    grouped[cat].push(t);
                  }
                  return Object.entries(grouped).map(([cat, catTasks]) => (
                    <div key={cat} className="kpi-task-link-group">
                      <div className="kpi-task-link-group-label">{cat}</div>
                      {catTasks.map((t) => {
                        const isLinked = form.linkedTaskIds.includes(t.taskId);
                        const dd = t.dueDate instanceof Timestamp ? t.dueDate.toDate() : null;
                        const dateStr = dd ? `${dd.getMonth()+1}.${String(dd.getDate()).padStart(2,'0')}` : '';
                        return (
                          <label key={t.taskId} className={`kpi-task-link-item ${isLinked ? 'selected' : ''}`}>
                            <input type="checkbox" checked={isLinked}
                              onChange={() => toggleTask(t.taskId)} style={{ width: 14, height: 14 }} />
                            <span>{t.title}</span>
                            <span className="kpi-task-link-meta">
                              {t.assigneeName && <span>{t.assigneeName}</span>}
                              {dateStr && <span>{dateStr}</span>}
                              {t.status === '완료' && <span style={{ color: 'var(--c-green)' }}>완료</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}

          <div className="tm-form-actions">
            <button type="button" className="tm-btn-cancel" onClick={onClose}>취소</button>
            <button type="submit" className="tm-btn-save" disabled={saving}>
              {saving ? '저장 중...' : existing ? '수정' : '추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function tsToStr(ts: Timestamp | null | undefined): string {
  if (!ts) return '';
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts as unknown as string);
  return d.toISOString().slice(0, 10);
}
