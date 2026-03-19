import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Timestamp } from 'firebase/firestore';
import type { Kpi, ChildKpi, KpiPeriod, KpiStatus, Task } from '../types';
import { useKpis, useChildKpis } from '../hooks/useKpis';
import { useTasks } from '../hooks/useTasks';
import { useSettings } from '../hooks/useSettings';
import { useMembers } from '../hooks/useMembers';
import { calcAchievementRate, calcKpiStatus } from '../services/kpiService';

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
    if (newStatus === '완료' && kpi.achievementRate < 100) {
      if (!window.confirm(`완료 처리하시겠습니까? 현재 달성률 ${kpi.achievementRate}%`)) return;
    }
    const data: Partial<Kpi> = { status: newStatus };
    if (newStatus === '완료') {
      data.completedDate = Timestamp.now() as any;
    }
    await update(kpiId, data);
    addToast(`"${kpi.title}" 상태가 ${newStatus}(으)로 변경되었습니다`);
  }, [update, addToast]);

  const handleChildStatusChange = useCallback(async (parentKpiId: string, childKpiId: string, newStatus: KpiStatus, child: ChildKpi) => {
    if (newStatus === '완료' && child.achievementRate < 100) {
      if (!window.confirm(`완료 처리하시겠습니까? 현재 달성률 ${child.achievementRate}%`)) return;
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

  // 팀원별 KPI 담당
  const memberKpiCounts = useMemo(() => {
    const map: Record<string, number> = {};
    kpis.forEach((k) => {
      const name = k.assigneeName || '미배정';
      map[name] = (map[name] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [kpis]);

  // 위험/마감 임박 알림
  const warnings = useMemo(() => {
    return kpis
      .filter((k) => k.status === '위험' || (k.endDate && k.status !== '달성'))
      .map((k) => {
        const end = k.endDate instanceof Timestamp ? k.endDate.toDate() : null;
        const daysLeft = end ? Math.ceil((end.getTime() - Date.now()) / 86400000) : null;
        return { ...k, daysLeft };
      })
      .filter((k) => k.status === '위험' || (k.daysLeft !== null && k.daysLeft <= 14))
      .slice(0, 5);
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
          {/* 팀원별 KPI */}
          <div className="tm-workload-card" style={{ marginBottom: 12 }}>
            <div className="tm-workload-title">팀원별 KPI 담당</div>
            {memberKpiCounts.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--tm-ink-tertiary)', padding: '12px 0' }}>데이터 없음</div>
            ) : memberKpiCounts.map(([name, count]) => (
              <div key={name} className="tm-workload-item">
                <div className="tm-workload-name">{name}</div>
                <span className="tm-workload-count tm-wc-progress">{count}</span>
              </div>
            ))}
          </div>

          {/* 주의 알림 */}
          <div className="tm-workload-card">
            <div className="tm-workload-title">주의 필요</div>
            {warnings.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--tm-ink-tertiary)', padding: '12px 0' }}>이상 없음</div>
            ) : warnings.map((w) => (
              <div key={w.kpiId} style={{ padding: '6px 0', borderBottom: '1px solid var(--tm-border-subtle)', fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: 'var(--tm-ink-primary)', marginBottom: 2 }}>{w.title}</div>
                <div style={{ display: 'flex', gap: 8, color: 'var(--tm-ink-tertiary)' }}>
                  <span style={{ color: STATUS_COLOR[w.status], fontWeight: 600 }}>{w.status}</span>
                  <span>{w.achievementRate}%</span>
                  {w.daysLeft !== null && w.daysLeft <= 14 && (
                    <span style={{ color: 'var(--tm-urgent)' }}>
                      {w.daysLeft <= 0 ? '기한 초과' : `D-${w.daysLeft}`}
                    </span>
                  )}
                </div>
              </div>
            ))}
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
  const linkedCount = kpi.linkedTaskIds?.length || 0;
  const statusColor = STATUS_COLOR[kpi.status];
  const periodColor = PERIOD_COLOR[kpi.period];

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
            {children.length > 0 && (
              <span className="kpi-meta-tag">하위 {children.length}</span>
            )}
            {linkedCount > 0 && (
              <span className="kpi-meta-tag">연결업무 {linkedCount}</span>
            )}
          </div>

          {kpi.description && <div className="tm-task-desc">{kpi.description}</div>}

          <div className="kpi-value-row">
            <span className="kpi-current" style={{ color: statusColor }}>
              {kpi.currentValue}
            </span>
            <span className="kpi-target">/ {kpi.targetValue} {kpi.unit}</span>
            <div className="tm-progress-bar" style={{ maxWidth: 120, height: 5 }}>
              <div className="tm-progress-fill" style={{ width: `${Math.min(kpi.achievementRate, 100)}%`, background: statusColor }} />
            </div>
            <span className="tm-progress-text" style={{ color: statusColor, fontWeight: 700 }}>
              {kpi.achievementRate}%
            </span>
          </div>

          <div className="tm-task-meta">
            {kpi.assigneeName && <span>{kpi.assigneeName}</span>}
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
              </div>
              <div className="kpi-value-row">
                <span className="kpi-current kpi-current-sm" style={{ color: childColor }}>
                  {child.currentValue}
                </span>
                <span className="kpi-target">/ {child.targetValue} {child.unit}</span>
                <div className="tm-progress-bar" style={{ maxWidth: 80, height: 4 }}>
                  <div className="tm-progress-fill" style={{ width: `${Math.min(child.achievementRate, 100)}%`, background: childColor }} />
                </div>
                <span className="tm-progress-text" style={{ color: childColor, fontWeight: 700 }}>
                  {child.achievementRate}%
                </span>
              </div>
              {child.assigneeName && (
                <div className="tm-task-meta"><span>{child.assigneeName}</span></div>
              )}
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
    assigneeName: (existing as any)?.assigneeName || '',
    period: (existing as any)?.period || '분기' as KpiPeriod,
    targetValue: (existing as any)?.targetValue || 0,
    currentValue: (existing as any)?.currentValue || 0,
    unit: (existing as any)?.unit || '',
    startDate: tsToStr((existing as any)?.startDate),
    endDate: tsToStr((existing as any)?.endDate),
    linkedTaskIds: (existing as any)?.linkedTaskIds || [] as string[],
    isChild,
    parentId: childEdit?.parentId || '',
  });
  const [saving, setSaving] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');

  const rate = form.targetValue > 0 ? calcAchievementRate(Number(form.currentValue), Number(form.targetValue)) : 0;
  const status = calcKpiStatus(rate);

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
        assignee: form.assigneeName,
        assigneeName: form.assigneeName,
        period: form.period,
        targetValue: Number(form.targetValue),
        currentValue: Number(form.currentValue),
        unit: form.unit,
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

          <div className="tm-form-row-3">
            <label>목표값 *
              <input name="targetValue" type="number" min="0" step="any" value={form.targetValue} onChange={handleChange} />
            </label>
            <label>현재값
              <input name="currentValue" type="number" min="0" step="any" value={form.currentValue} onChange={handleChange} />
            </label>
            <label>단위
              <input name="unit" value={form.unit} onChange={handleChange} placeholder="건, %, 원" />
            </label>
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {members.map((m) => {
                const names = form.assigneeName ? form.assigneeName.split(',').map((n: string) => n.trim()).filter(Boolean) : [];
                const isSelected = names.includes(m.name);
                return (
                  <button key={m.memberId} type="button"
                    onClick={() => {
                      const next = isSelected ? names.filter((n: string) => n !== m.name) : [...names, m.name];
                      setForm((f) => ({ ...f, assigneeName: next.join(',') }));
                    }}
                    style={{
                      padding: '4px 10px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                      border: `1px solid ${isSelected ? 'var(--c-accent)' : 'var(--c-line)'}`,
                      background: isSelected ? 'var(--c-accent-light)' : 'var(--c-bg)',
                      color: isSelected ? 'var(--c-accent)' : 'var(--c-text-2)',
                      fontWeight: isSelected ? 600 : 400, fontFamily: 'var(--font)',
                    }}
                  >{m.name}</button>
                );
              })}
            </div>
            {form.assigneeName && (
              <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 4 }}>
                선택: {form.assigneeName}
              </div>
            )}
          </label>

          {/* 달성률 미리보기 */}
          {Number(form.targetValue) > 0 && (
            <div style={{
              margin: '12px 0', padding: 10,
              background: 'var(--tm-surface-inset)', borderRadius: 'var(--tm-radius-sm)',
              display: 'flex', alignItems: 'center', gap: 12, fontSize: 13,
            }}>
              <span>달성률:</span>
              <strong style={{ color: STATUS_COLOR[status], fontFamily: 'var(--tm-font-mono)' }}>{rate}%</strong>
              <span style={{ color: STATUS_COLOR[status], fontWeight: 600 }}>{status}</span>
              <div style={{ flex: 1, height: 5, background: 'var(--tm-surface-card)', borderRadius: 100, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(rate, 100)}%`, background: STATUS_COLOR[status], borderRadius: 100 }} />
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
