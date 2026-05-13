import React, { useState, useMemo, useCallback } from 'react';
import { Pencil, Check, X, Plus, Trash2, Upload } from 'lucide-react';
import RcmsUploadModal from './RcmsUploadModal';
import BudgetWizardModal from './BudgetWizardModal';
import {
  Project, ProjectYear,
  BudgetDetail, BudgetCategory, BudgetItem, BudgetSubItem,
} from '../../types/project';
import {
  updateBudgetDetail,
} from '../../services/budgetService';
import { updateProject } from '../../services/projectService';
import { logAction } from '../../services/auditService';
import { useAuth } from '../../hooks/useAuth';
import './BudgetTab.css';

// ═══ 유틸 ═══
function formatWon(n: number): string { return n.toLocaleString() + '원'; }
function formatBalance(n: number): React.ReactNode {
  if (n < 0) return <span className="bt-negative">{'-' + Math.abs(n).toLocaleString() + '원'}</span>;
  return formatWon(n);
}
function pct(part: number, total: number): string {
  if (total === 0) return '0';
  return ((part / total) * 100).toFixed(1);
}
function getCurrentYearIndex(p: Project): number {
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < p.years.length; i++) {
    if (today >= p.years[i].start && today <= p.years[i].end) return i;
  }
  return 0;
}
function isIrregularYear(y: ProjectYear): boolean {
  if (!y.start || !y.end) return false;
  return !(y.start.slice(5, 7) === '01' && y.end.slice(5, 7) === '12');
}

// 항목별 색상
const ITEM_COLORS: Record<string, string> = {
  labor: '#3B82F6', activity: '#10B981', material: '#8B5CF6',
  stipend: '#F59E0B', 'indirect-cost': '#6B7280',
};

// 활동비 자동완성
const ACTIVITY_SUGGESTIONS = [
  '국내출장비', '해외출장비', '전문가활용비', '위탁연구비',
  '기자재비', '시작품제작비', '수용비', '특허출원비',
];

// optional 항목 후보
const OPTIONAL_ITEMS: { categoryId: string; item: Omit<BudgetItem, 'budget' | 'executed'> }[] = [
  { categoryId: 'direct', item: { id: 'material', name: '재료비', type: 'optional', subItems: [] } },
  { categoryId: 'direct', item: { id: 'stipend', name: '연구수당', type: 'optional', subItems: [] } },
  { categoryId: 'indirect', item: { id: 'indirect-cost', name: '간접비', type: 'fixed', subItems: [] } },
];

// ═══ 인라인 편집 셀 ═══
function EditableCell({ value, onSave }: { value: number; onSave: (v: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');

  const startEdit = () => { setInput(value.toString()); setEditing(true); };
  const cancel = () => setEditing(false);
  const save = async () => {
    const v = parseInt(input.replace(/,/g, ''), 10) || 0;
    if (v !== value) await onSave(v);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="bt-edit-cell">
        <input className="bt-edit-input" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }} autoFocus />
        <button className="bt-edit-btn save" onClick={save}><Check size={14} /></button>
        <button className="bt-edit-btn cancel" onClick={cancel}><X size={14} /></button>
      </div>
    );
  }
  return (
    <span className="bt-editable" onClick={startEdit}>
      {formatWon(value)}<Pencil size={11} className="bt-pencil" />
    </span>
  );
}

// ═══ 세부항목 추가 인라인 폼 ═══
function AddSubItemForm({ onAdd, onCancel }: { onAdd: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const filtered = ACTIVITY_SUGGESTIONS.filter(s => !name || s.includes(name));

  return (
    <tr className="bt-row-sub bt-add-row">
      <td style={{ paddingLeft: 48 }}>
        <div className="bt-add-form">
          <span className="bt-sub-prefix">- </span>
          <div className="bt-autocomplete">
            <input className="bt-add-input" placeholder="항목명 입력..." value={name}
              onChange={e => { setName(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { onAdd(name.trim()); } if (e.key === 'Escape') onCancel(); }}
              autoFocus />
            {showSuggestions && filtered.length > 0 && (
              <div className="bt-suggestions">
                {filtered.map(s => (
                  <div key={s} className="bt-suggestion" onMouseDown={() => { onAdd(s); }}>{s}</div>
                ))}
              </div>
            )}
          </div>
          <button className="bt-edit-btn save" onClick={() => name.trim() && onAdd(name.trim())}><Check size={14} /></button>
          <button className="bt-edit-btn cancel" onClick={onCancel}><X size={14} /></button>
        </div>
      </td>
      <td colSpan={3} />
    </tr>
  );
}

// ═══ 항목별 진행바 ═══
function DetailProgressBar({ detail, totalBudget }: { detail: BudgetDetail; totalBudget: number }) {
  if (totalBudget === 0) return null;
  const segments: { id: string; name: string; executed: number; color: string }[] = [];

  for (const cat of detail.categories) {
    for (const item of cat.items) {
      const exec = item.executed + item.subItems.reduce((s, si) => s + si.executed, 0);
      if (exec > 0) {
        segments.push({ id: item.id, name: item.name, executed: exec, color: ITEM_COLORS[item.id] || '#94A3B8' });
      }
    }
  }

  const totalExec = segments.reduce((s, seg) => s + seg.executed, 0);

  return (
    <div className="bt-progress">
      <div className="bt-progress-bar">
        {segments.map(seg => {
          const w = (seg.executed / totalBudget) * 100;
          return (
            <div key={seg.id} className="bt-bar-seg" style={{ width: `${w}%`, background: seg.color }}
              title={`${seg.name}: ${formatWon(seg.executed)}`}>
              {w > 10 && <span>{seg.name}</span>}
            </div>
          );
        })}
        {totalExec < totalBudget && (
          <div className="bt-bar-seg" style={{ width: `${((totalBudget - totalExec) / totalBudget) * 100}%`, background: '#E2E8F0' }} />
        )}
      </div>
      <div className="bt-progress-labels">
        <span>잔액: {formatWon(totalBudget - totalExec)} ({pct(totalBudget - totalExec, totalBudget)}%)</span>
        <span>집행률: {pct(totalExec, totalBudget)}%</span>
      </div>
      <div className="bt-progress-legend">
        {segments.map(seg => (
          <span key={seg.id} className="bt-legend-item">
            <span className="bt-dot" style={{ background: seg.color }} />{seg.name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ═══ 요약 카드 ═══
function BudgetSummaryCards({ projects }: { projects: Project[] }) {
  const summary = useMemo(() => {
    let totalBudget = 0, totalExecuted = 0;
    for (const p of projects) {
      for (const y of p.years) {
        totalBudget += y.budget.total;
        if (y.budgetDetail) {
          for (const cat of y.budgetDetail.categories) {
            for (const item of cat.items) {
              totalExecuted += item.executed + item.subItems.reduce((s, si) => s + si.executed, 0);
            }
          }
        } else {
          totalExecuted += y.budgetExecution?.executed || 0;
        }
      }
    }
    return { budget: totalBudget, executed: totalExecuted, remaining: totalBudget - totalExecuted,
      rate: totalBudget > 0 ? ((totalExecuted / totalBudget) * 100).toFixed(1) : '0' };
  }, [projects]);

  const cards = [
    { label: '전체 예산', value: formatWon(summary.budget), color: 'var(--text-primary)' },
    { label: '전체 집행', value: formatWon(summary.executed), color: 'var(--accent)' },
    { label: '전체 잔액', value: formatWon(summary.remaining), color: 'var(--success)' },
    { label: '전체 집행률', value: `${summary.rate}%`, color: summary.executed > 0 ? 'var(--accent)' : 'var(--text-hint)' },
  ];

  return (
    <div className="bt-summary-cards">
      {cards.map(c => (
        <div key={c.label} className="bt-summary-card card">
          <div className="bt-summary-label">{c.label}</div>
          <div className="bt-summary-value" style={{ color: c.color }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// ═══ 트리 구조 테이블 ═══
function BudgetTreeTable({ project, yearIdx, detail }: {
  project: Project; yearIdx: number; detail: BudgetDetail;
}) {
  const { user } = useAuth();
  const email = user?.email || '';
  const yearKey = project.years[yearIdx].yearNumber;
  const pid = project.projectId;
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);

  // 합계 계산
  const catTotals = (cat: BudgetCategory) => {
    let b = 0, e = 0;
    for (const item of cat.items) {
      const ib = item.budget + item.subItems.reduce((s, si) => s + si.budget, 0);
      const ie = item.executed + item.subItems.reduce((s, si) => s + si.executed, 0);
      b += ib; e += ie;
    }
    return { budget: b, executed: e };
  };

  const itemTotals = (item: BudgetItem) => {
    if (item.subItems.length === 0) return { budget: item.budget, executed: item.executed };
    return {
      budget: item.subItems.reduce((s, si) => s + si.budget, 0),
      executed: item.subItems.reduce((s, si) => s + si.executed, 0),
    };
  };

  const grandTotal = detail.categories.reduce((acc, cat) => {
    const t = catTotals(cat);
    return { budget: acc.budget + t.budget, executed: acc.executed + t.executed };
  }, { budget: 0, executed: 0 });

  // Firebase 저장 헬퍼
  const saveDetail = async (newDetail: BudgetDetail) => {
    await updateBudgetDetail(pid, yearKey, newDetail, email);
  };

  const updateItemField = async (catId: string, itemId: string, field: 'budget' | 'executed', value: number) => {
    const newDetail = JSON.parse(JSON.stringify(detail)) as BudgetDetail;
    const cat = newDetail.categories.find(c => c.id === catId);
    const item = cat?.items.find(i => i.id === itemId);
    if (item) { item[field] = value; }
    await saveDetail(newDetail);
  };

  const updateSubItemField = async (catId: string, itemId: string, subId: string, field: 'budget' | 'executed', value: number) => {
    const newDetail = JSON.parse(JSON.stringify(detail)) as BudgetDetail;
    const cat = newDetail.categories.find(c => c.id === catId);
    const item = cat?.items.find(i => i.id === itemId);
    const sub = item?.subItems.find(s => s.id === subId);
    if (sub) { sub[field] = value; }
    await saveDetail(newDetail);
  };

  const handleAddSubItem = async (catId: string, itemId: string, name: string) => {
    const id = `${itemId}-${name.replace(/\s/g, '-')}-${Date.now()}`;
    const newDetail = JSON.parse(JSON.stringify(detail)) as BudgetDetail;
    const cat = newDetail.categories.find(c => c.id === catId);
    const item = cat?.items.find(i => i.id === itemId);
    item?.subItems.push({ id, name, budget: 0, executed: 0 });
    await saveDetail(newDetail);
    setAddingSubFor(null);
  };

  const handleRemoveSubItem = async (catId: string, itemId: string, sub: BudgetSubItem) => {
    if (!window.confirm(`'${sub.name}'을 삭제하시겠습니까?`)) return;
    const newDetail = JSON.parse(JSON.stringify(detail)) as BudgetDetail;
    const cat = newDetail.categories.find(c => c.id === catId);
    const item = cat?.items.find(i => i.id === itemId);
    if (item) item.subItems = item.subItems.filter(s => s.id !== sub.id);
    await saveDetail(newDetail);
  };

  const handleRemoveOptionalItem = async (catId: string, item: BudgetItem) => {
    if (!window.confirm(`'${item.name}'을 삭제하시겠습니까?`)) return;
    const newDetail = JSON.parse(JSON.stringify(detail)) as BudgetDetail;
    const cat = newDetail.categories.find(c => c.id === catId);
    if (cat) cat.items = cat.items.filter(i => i.id !== item.id);
    await saveDetail(newDetail);
  };

  // 존재하는 항목 ID 수집 (추가 메뉴용)
  const existingItemIds = new Set<string>();
  detail.categories.forEach(c => c.items.forEach(i => existingItemIds.add(i.id)));

  const handleAddOptionalItem = async (opt: typeof OPTIONAL_ITEMS[0]) => {
    const newDetail = JSON.parse(JSON.stringify(detail)) as BudgetDetail;
    let cat = newDetail.categories.find(c => c.id === opt.categoryId);
    if (!cat) {
      cat = { id: opt.categoryId, name: opt.categoryId === 'indirect' ? '간접비' : '직접비', type: 'optional', items: [] };
      newDetail.categories.push(cat);
    }
    cat.items.push({ ...opt.item, budget: 0, executed: 0 });
    await saveDetail(newDetail);
  };

  return (
    <div className="bt-table-wrap">
      <table className="table bt-tree-table">
        <thead>
          <tr>
            <th style={{ width: '40%' }}>항목</th>
            <th style={{ textAlign: 'right' }}>예산</th>
            <th style={{ textAlign: 'right' }}>집행</th>
            <th style={{ textAlign: 'right' }}>잔액</th>
          </tr>
        </thead>
        <tbody>
          {detail.categories.map(cat => {
            const ct = catTotals(cat);
            const isIndirect = cat.id === 'indirect';
            return (
              <React.Fragment key={cat.id}>
                {/* 대분류 행 */}
                <tr className={`bt-row-cat ${isIndirect ? 'indirect' : 'direct'}`}>
                  <td><span className="bt-cat-marker">■</span> {cat.name}</td>
                  <td className="money">{formatWon(ct.budget)}</td>
                  <td className="money">{formatWon(ct.executed)}</td>
                  <td className="money">{formatBalance(ct.budget - ct.executed)}</td>
                </tr>

                {cat.items.map(item => {
                  const it = itemTotals(item);
                  const hasSubItems = item.subItems.length > 0;
                  const isEditable = !hasSubItems;

                  return (
                    <React.Fragment key={item.id}>
                      {/* 중분류 행 */}
                      <tr className="bt-row-item">
                        <td style={{ paddingLeft: 28 }}>
                          {item.name}
                          {item.type === 'optional' && (
                            <button className="bt-remove-btn" onClick={() => handleRemoveOptionalItem(cat.id, item)}
                              title="항목 삭제"><Trash2 size={12} /></button>
                          )}
                        </td>
                        <td className="money">
                          {isEditable ? (
                            <EditableCell value={item.budget}
                              onSave={v => updateItemField(cat.id, item.id, 'budget', v)} />
                          ) : formatWon(it.budget)}
                        </td>
                        <td className="money">
                          {isEditable ? (
                            <EditableCell value={item.executed}
                              onSave={v => updateItemField(cat.id, item.id, 'executed', v)} />
                          ) : formatWon(it.executed)}
                        </td>
                        <td className="money">{formatBalance(it.budget - it.executed)}</td>
                      </tr>

                      {/* 소분류 행 */}
                      {item.subItems.map(sub => (
                        <tr key={sub.id} className="bt-row-sub">
                          <td style={{ paddingLeft: 48 }}>
                            <span className="bt-sub-prefix">- </span>{sub.name}
                            <button className="bt-remove-btn" onClick={() => handleRemoveSubItem(cat.id, item.id, sub)}
                              title="삭제"><Trash2 size={11} /></button>
                          </td>
                          <td className="money">
                            <EditableCell value={sub.budget}
                              onSave={v => updateSubItemField(cat.id, item.id, sub.id, 'budget', v)} />
                          </td>
                          <td className="money">
                            <EditableCell value={sub.executed}
                              onSave={v => updateSubItemField(cat.id, item.id, sub.id, 'executed', v)} />
                          </td>
                          <td className="money">{formatBalance(sub.budget - sub.executed)}</td>
                        </tr>
                      ))}

                      {/* 세부항목 추가 (활동비 등 subItems가 있는 항목) */}
                      {hasSubItems && addingSubFor === item.id && (
                        <AddSubItemForm
                          onAdd={name => handleAddSubItem(cat.id, item.id, name)}
                          onCancel={() => setAddingSubFor(null)}
                        />
                      )}
                      {hasSubItems && addingSubFor !== item.id && (
                        <tr className="bt-row-sub bt-add-trigger">
                          <td style={{ paddingLeft: 48 }} colSpan={4}>
                            <button className="bt-add-sub-btn" onClick={() => setAddingSubFor(item.id)}>
                              <Plus size={12} /> 세부항목 추가
                            </button>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bt-row-total">
            <td><strong>합계</strong></td>
            <td className="money"><strong>{formatWon(grandTotal.budget)}</strong></td>
            <td className="money"><strong>{formatWon(grandTotal.executed)}</strong></td>
            <td className="money"><strong>{formatBalance(grandTotal.budget - grandTotal.executed)}</strong></td>
          </tr>
        </tfoot>
      </table>

      {/* 항목 추가 */}
      {OPTIONAL_ITEMS.filter(o => !existingItemIds.has(o.item.id)).length > 0 && (
        <div className="bt-add-optional">
          <span className="bt-add-optional-label">+ 항목 추가:</span>
          {OPTIONAL_ITEMS.filter(o => !existingItemIds.has(o.item.id)).map(o => (
            <button key={o.item.id} className="bt-add-optional-btn" onClick={() => handleAddOptionalItem(o)}>
              {o.item.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ 과제별 예산 카드 ═══
function BudgetProjectCard({ project }: { project: Project }) {
  const [selectedYearIdx, setSelectedYearIdx] = useState(() => getCurrentYearIndex(project));
  const [showWizard, setShowWizard] = useState(false);

  const year = project.years[selectedYearIdx];
  if (!year) return null;

  const detail = year.budgetDetail;
  const irregular = isIrregularYear(year);

  return (
    <div className="bt-project-card card">
      <div className="bt-card-header">
        <div className="bt-card-title">
          <strong>{project.shortName}</strong>
          <span className="bt-card-year-info">
            {year.yearNumber}차 ({year.start} ~ {year.end})
            {irregular && <span className="bt-irregular"> ⚠</span>}
          </span>
        </div>
        <div className="bt-year-tabs">
          {project.years.map((y, i) => (
            <button key={i} className={`bt-year-tab ${i === selectedYearIdx ? 'active' : ''}`}
              onClick={() => setSelectedYearIdx(i)}>{y.yearNumber}차</button>
          ))}
        </div>
      </div>

      {detail ? (
        <>
          <DetailProgressBar detail={detail} totalBudget={year.budget.total} />
          <BudgetTreeTable project={project} yearIdx={selectedYearIdx} detail={detail} />
        </>
      ) : (
        <div className="bt-empty-detail">
          <p>예산 상세를 설정해주세요</p>
          <p className="bt-empty-sub">직접비/간접비 세부 항목별로 예산과 집행을 관리합니다.</p>
          <button className="btn-primary" onClick={() => setShowWizard(true)}>
            예산 설정 마법사
          </button>
        </div>
      )}

      {showWizard && (
        <BudgetWizardModal
          projectId={project.projectId}
          projectName={project.shortName}
          year={year}
          onClose={() => setShowWizard(false)}
          onComplete={() => {}}
        />
      )}
    </div>
  );
}

// ═══ 메인 ═══
const BudgetTab: React.FC<{ activeProjects: Project[] }> = ({ activeProjects }) => {
  const [showUpload, setShowUpload] = useState(false);

  return (
    <div className="bt-container">
      <div className="bt-toolbar">
        <BudgetSummaryCards projects={activeProjects} />
        <button className="btn-secondary bt-upload-btn" onClick={() => setShowUpload(true)}>
          <Upload size={15} /> 이지바로 데이터 업로드
        </button>
      </div>
      <div className="bt-project-list">
        {activeProjects.map(p => (
          <BudgetProjectCard key={p.projectId} project={p} />
        ))}
      </div>
      {showUpload && (
        <RcmsUploadModal
          projects={activeProjects}
          onClose={() => setShowUpload(false)}
          onComplete={() => {}}
        />
      )}
    </div>
  );
};

export default BudgetTab;
