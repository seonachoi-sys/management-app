import React, { useState, useMemo } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { ProjectYear, BudgetDetail, BudgetItem, BudgetSubItem } from '../../types/project';
import { updateBudgetDetail } from '../../services/budgetService';
import { useAuth } from '../../hooks/useAuth';
import './BudgetWizardModal.css';

const ACTIVITY_SUGGESTIONS = [
  '국내출장비', '해외출장비', '전문가활용비', '위탁연구비',
  '기자재비', '시작품제작비', '수용비', '특허출원비',
];

interface Props {
  projectId: string;
  projectName: string;
  year: ProjectYear;
  onClose: () => void;
  onComplete: () => void;
}

type WizardStep = 1 | 2 | 3;

function formatWon(n: number): string { return n.toLocaleString() + '원'; }

const BudgetWizardModal: React.FC<Props> = ({ projectId, projectName, year, onClose, onComplete }) => {
  const { user } = useAuth();
  const [step, setStep] = useState<WizardStep>(1);
  const [saving, setSaving] = useState(false);

  // Step 1: 항목 선택
  const [includeMaterial, setIncludeMaterial] = useState(false);
  const [includeStipend, setIncludeStipend] = useState(false);
  const [includeIndirect, setIncludeIndirect] = useState(false);

  // Step 2: 활동비 세부항목
  const [activitySubs, setActivitySubs] = useState<string[]>([]);
  const [subInput, setSubInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Step 3: 예산 입력
  const [budgets, setBudgets] = useState<Record<string, number>>({});

  // 기존 데이터 참고
  const [useExisting, setUseExisting] = useState(false);
  const hasExistingBudget = year.budget && year.budget.total > 0;

  const filteredSuggestions = ACTIVITY_SUGGESTIONS.filter(
    s => !activitySubs.includes(s) && (!subInput || s.includes(subInput))
  );

  const addActivitySub = (name: string) => {
    if (name.trim() && !activitySubs.includes(name.trim())) {
      setActivitySubs([...activitySubs, name.trim()]);
    }
    setSubInput('');
    setShowSuggestions(false);
  };

  const removeActivitySub = (name: string) => {
    setActivitySubs(activitySubs.filter(s => s !== name));
  };

  // Step 3에서 표시할 항목 구조
  const structure = useMemo(() => {
    const items: { id: string; name: string; indent: number; key: string; editable: boolean }[] = [];

    // 직접비 > 인건비
    items.push({ id: 'labor', name: '인건비', indent: 0, key: 'labor', editable: false });
    items.push({ id: 'labor-cash', name: '현금', indent: 1, key: 'labor-cash', editable: true });
    items.push({ id: 'labor-inkind', name: '현물', indent: 1, key: 'labor-inkind', editable: true });

    // 직접비 > 활동비
    if (activitySubs.length > 0) {
      items.push({ id: 'activity', name: '활동비', indent: 0, key: 'activity', editable: false });
      activitySubs.forEach(s => {
        const key = `activity-${s}`;
        items.push({ id: key, name: s, indent: 1, key, editable: true });
      });
    } else {
      items.push({ id: 'activity', name: '활동비', indent: 0, key: 'activity', editable: true });
    }

    if (includeMaterial) {
      items.push({ id: 'material', name: '재료비', indent: 0, key: 'material', editable: true });
    }
    if (includeStipend) {
      items.push({ id: 'stipend', name: '연구수당', indent: 0, key: 'stipend', editable: true });
    }
    if (includeIndirect) {
      items.push({ id: 'indirect-cost', name: '간접비', indent: 0, key: 'indirect-cost', editable: true });
    }

    return items;
  }, [activitySubs, includeMaterial, includeStipend, includeIndirect]);

  // 기존 데이터 참고 시 자동 입력
  const applyExisting = () => {
    if (!hasExistingBudget) return;
    const b = year.budget;
    setBudgets(prev => ({
      ...prev,
      'labor-cash': b.privateCash || 0,
      'labor-inkind': b.privateInKind || 0,
    }));
  };

  const getBudgetVal = (key: string): number => budgets[key] || 0;
  const setBudgetVal = (key: string, val: number) => setBudgets(prev => ({ ...prev, [key]: val }));

  // 합계 계산
  const totalBudget = useMemo(() => {
    return structure.filter(s => s.editable).reduce((sum, s) => sum + getBudgetVal(s.key), 0);
  }, [structure, budgets]);

  // 저장
  const handleSave = async () => {
    setSaving(true);
    try {
      const detail: BudgetDetail = { categories: [] };

      // 직접비
      const directItems: BudgetItem[] = [];

      // 인건비
      const laborSubs: BudgetSubItem[] = [
        { id: 'labor-cash', name: '현금', budget: getBudgetVal('labor-cash'), executed: 0 },
        { id: 'labor-inkind', name: '현물', budget: getBudgetVal('labor-inkind'), executed: 0 },
      ];
      directItems.push({
        id: 'labor', name: '인건비', type: 'fixed', budget: 0, executed: 0, subItems: laborSubs,
      });

      // 활동비
      if (activitySubs.length > 0) {
        const subs: BudgetSubItem[] = activitySubs.map(s => ({
          id: `activity-${s.replace(/\s/g, '-')}-${Date.now()}`,
          name: s,
          budget: getBudgetVal(`activity-${s}`),
          executed: 0,
        }));
        directItems.push({
          id: 'activity', name: '활동비', type: 'fixed', budget: 0, executed: 0, subItems: subs,
        });
      } else {
        directItems.push({
          id: 'activity', name: '활동비', type: 'fixed',
          budget: getBudgetVal('activity'), executed: 0, subItems: [],
        });
      }

      if (includeMaterial) {
        directItems.push({
          id: 'material', name: '재료비', type: 'optional',
          budget: getBudgetVal('material'), executed: 0, subItems: [],
        });
      }
      if (includeStipend) {
        directItems.push({
          id: 'stipend', name: '연구수당', type: 'optional',
          budget: getBudgetVal('stipend'), executed: 0, subItems: [],
        });
      }

      detail.categories.push({ id: 'direct', name: '직접비', type: 'fixed', items: directItems });

      // 간접비
      if (includeIndirect) {
        detail.categories.push({
          id: 'indirect', name: '간접비', type: 'optional',
          items: [{
            id: 'indirect-cost', name: '간접비', type: 'fixed',
            budget: getBudgetVal('indirect-cost'), executed: 0, subItems: [],
          }],
        });
      }

      await updateBudgetDetail(projectId, year.yearNumber, detail, user?.email || '');
      onComplete();
      onClose();
    } catch (e: any) {
      alert('저장 실패: ' + e.message);
    }
    setSaving(false);
  };

  return (
    <div className="bw-overlay" onClick={onClose}>
      <div className="bw-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bw-header">
          <div>
            <h2>예산 상세 설정</h2>
            <span className="bw-subtitle">{projectName} · {year.yearNumber}차 ({year.start} ~ {year.end})</span>
          </div>
          <button className="bw-close" onClick={onClose}><X size={20} /></button>
        </div>

        {/* Step Indicator */}
        <div className="bw-steps">
          {[
            { n: 1, label: '항목 선택' },
            { n: 2, label: '활동비 세부' },
            { n: 3, label: '예산 입력' },
          ].map(s => (
            <div key={s.n} className={`bw-step-item ${step >= s.n ? 'active' : ''} ${step === s.n ? 'current' : ''}`}>
              <div className="bw-step-dot">{s.n}</div>
              <span className="bw-step-label">{s.label}</span>
            </div>
          ))}
        </div>

        <div className="bw-body">
          {/* Step 1 */}
          {step === 1 && (
            <div className="bw-step1">
              <p className="bw-instruction">이 과제에 해당하는 예산 항목을 선택하세요</p>
              <div className="bw-checklist">
                <label className="bw-check-item disabled">
                  <input type="checkbox" checked disabled /> 직접비 &gt; 인건비 <span className="bw-required">필수</span>
                </label>
                <label className="bw-check-item disabled">
                  <input type="checkbox" checked disabled /> 직접비 &gt; 활동비 <span className="bw-required">필수</span>
                </label>
                <label className="bw-check-item">
                  <input type="checkbox" checked={includeMaterial} onChange={e => setIncludeMaterial(e.target.checked)} />
                  직접비 &gt; 재료비
                </label>
                <label className="bw-check-item">
                  <input type="checkbox" checked={includeStipend} onChange={e => setIncludeStipend(e.target.checked)} />
                  직접비 &gt; 연구수당
                </label>
                <label className="bw-check-item">
                  <input type="checkbox" checked={includeIndirect} onChange={e => setIncludeIndirect(e.target.checked)} />
                  간접비
                </label>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="bw-step2">
              <p className="bw-instruction">활동비 세부 내역을 추가하세요</p>
              <div className="bw-sub-input-wrap">
                <div className="bw-autocomplete">
                  <input className="input bw-sub-input" placeholder="항목명 입력..."
                    value={subInput}
                    onChange={e => { setSubInput(e.target.value); setShowSuggestions(true); }}
                    onFocus={() => setShowSuggestions(true)}
                    onKeyDown={e => { if (e.key === 'Enter' && subInput.trim()) addActivitySub(subInput); }}
                  />
                  {showSuggestions && filteredSuggestions.length > 0 && (
                    <div className="bw-suggestions">
                      {filteredSuggestions.map(s => (
                        <div key={s} className="bw-suggestion" onMouseDown={() => addActivitySub(s)}>{s}</div>
                      ))}
                    </div>
                  )}
                </div>
                <button className="btn-primary bw-add-btn" onClick={() => subInput.trim() && addActivitySub(subInput)}>
                  <Plus size={14} /> 추가
                </button>
              </div>

              {activitySubs.length > 0 ? (
                <div className="bw-sub-list">
                  {activitySubs.map(s => (
                    <div key={s} className="bw-sub-tag">
                      {s}
                      <button onClick={() => removeActivitySub(s)}><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="bw-hint">세부항목 없이 활동비 총액으로 관리할 수도 있습니다.</p>
              )}
              <p className="bw-hint">나중에 추가할 수도 있습니다.</p>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="bw-step3">
              <p className="bw-instruction">각 항목의 예산 금액을 입력하세요</p>

              {hasExistingBudget && (
                <div className="bw-existing-toggle">
                  <label>
                    <input type="checkbox" checked={useExisting}
                      onChange={e => { setUseExisting(e.target.checked); if (e.target.checked) applyExisting(); }} />
                    기존 데이터를 참고하시겠습니까?
                  </label>
                  {useExisting && (
                    <span className="bw-existing-info">
                      현금 {formatWon(year.budget.privateCash)} · 현물 {formatWon(year.budget.privateInKind)}
                    </span>
                  )}
                </div>
              )}

              <table className="table bw-budget-table">
                <thead>
                  <tr>
                    <th>항목</th>
                    <th style={{ textAlign: 'right', width: 200 }}>예산</th>
                  </tr>
                </thead>
                <tbody>
                  {structure.map(s => (
                    <tr key={s.key} className={s.indent === 1 ? 'bw-row-sub' : 'bw-row-item'}>
                      <td style={{ paddingLeft: s.indent === 1 ? 36 : 14 }}>
                        {s.indent === 1 ? '- ' : ''}{s.name}
                      </td>
                      <td>
                        {s.editable ? (
                          <input className="input bw-money-input" placeholder="0"
                            value={getBudgetVal(s.key) || ''}
                            onChange={e => setBudgetVal(s.key, parseInt(e.target.value.replace(/,/g, ''), 10) || 0)}
                          />
                        ) : (
                          <span className="money bw-auto-sum">
                            {formatWon(
                              structure.filter(c => c.indent === 1 && c.key.startsWith(s.id))
                                .reduce((sum, c) => sum + getBudgetVal(c.key), 0)
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td><strong>합계</strong></td>
                    <td className="money"><strong>{formatWon(totalBudget)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="bw-actions">
          {step > 1 && (
            <button className="btn-secondary" onClick={() => setStep((step - 1) as WizardStep)}>이전</button>
          )}
          <div style={{ flex: 1 }} />
          {step < 3 ? (
            <button className="btn-primary" onClick={() => setStep((step + 1) as WizardStep)}>다음</button>
          ) : (
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? '저장 중...' : '저장'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BudgetWizardModal;
