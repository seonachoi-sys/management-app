import React, { useState, useMemo, useEffect } from 'react';
import { Timestamp } from 'firebase/firestore';
import type { Kpi, ChildKpi, KpiPeriod, KpiStatus, Task } from '../types';
import { useKpis, useChildKpis } from '../hooks/useKpis';
import { useTasks } from '../hooks/useTasks';
import { useSettings } from '../hooks/useSettings';
import { calcAchievementRate, calcKpiStatus } from '../services/kpiService';

const PERIOD_COLOR: Record<KpiPeriod, string> = {
  '월간': 'var(--tm-brand)',
  '분기': '#7c3aed',
  '반기': '#0891b2',
  '연간': 'var(--tm-success)',
};

const STATUS_COLOR: Record<KpiStatus, string> = {
  '달성': 'var(--tm-success)',
  '진행중': 'var(--tm-warning)',
  '위험': 'var(--tm-urgent)',
};

export default function KpiPanel() {
  const { kpis, loading, create, update, remove } = useKpis();
  const { tasks } = useTasks({});
  const [periodFilter, setPeriodFilter] = useState<KpiPeriod | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [editingKpi, setEditingKpi] = useState<Kpi | null>(null);
  const [editingChild, setEditingChild] = useState<{ child: ChildKpi | null; parentId: string } | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!periodFilter) return kpis;
    return kpis.filter((k) => k.period === periodFilter);
  }, [kpis, periodFilter]);

  const stats = useMemo(() => ({
    total: kpis.length,
    achieved: kpis.filter((k) => k.status === '달성').length,
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
    </div>
  );
}

/* ─── KPI 카드 (하위 포함) ─── */
function KpiCardWithChildren({
  kpi, tasks, expanded, onToggle, onEdit, onDelete, onEditChild, onAddChild,
}: {
  kpi: Kpi;
  tasks: Task[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEditChild: (child: ChildKpi) => void;
  onAddChild: () => void;
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
            <span className="kpi-badge" style={{ background: `${statusColor}15`, color: statusColor }}>
              {kpi.status}
            </span>
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
                <span className="kpi-badge" style={{ background: `${childColor}15`, color: childColor }}>
                  {child.status}
                </span>
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
  onSave,
  onClose,
}: {
  kpi: Kpi | null;
  childEdit: { child: ChildKpi | null; parentId: string } | null;
  parentKpis: Kpi[];
  tasks: Task[];
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
        startDate: form.startDate ? Timestamp.fromDate(new Date(form.startDate)) : null,
        endDate: form.endDate ? Timestamp.fromDate(new Date(form.endDate)) : null,
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
            <input name="assigneeName" value={form.assigneeName} onChange={handleChange} placeholder="담당자명" />
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
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-ink-secondary)', marginBottom: 6, letterSpacing: '0.02em' }}>
                업무 연결 ({form.linkedTaskIds.length}건)
              </div>
              <div style={{ maxHeight: 120, overflow: 'auto', border: '1px solid var(--tm-border-default)', borderRadius: 'var(--tm-radius-sm)', padding: 4 }}>
                {tasks.filter((t) => t.status !== '완료').slice(0, 20).map((t) => (
                  <label key={t.taskId} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                    fontSize: 12, cursor: 'pointer',
                    background: form.linkedTaskIds.includes(t.taskId) ? 'var(--tm-brand-light)' : 'transparent',
                    borderRadius: 4,
                  }}>
                    <input type="checkbox" checked={form.linkedTaskIds.includes(t.taskId)}
                      onChange={() => toggleTask(t.taskId)} style={{ width: 14, height: 14 }} />
                    {t.title}
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--tm-ink-tertiary)' }}>{t.assigneeName}</span>
                  </label>
                ))}
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
