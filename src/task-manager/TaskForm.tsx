import React, { useState, useMemo, useCallback } from 'react';
import { Timestamp } from 'firebase/firestore';
import type { Task, TaskStatus, RecurrenceRule, Member, ActionItem } from '../types';
import { updateTask } from '../services/taskService';
import { useDebouncedCallback } from '../hooks/useDebounce';

function newActionItemId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function migrateDescriptionToActionItems(description: string): ActionItem[] {
  if (!description.trim()) return [];
  return description
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s\-•·*\d.)]+/, '').trim())
    .filter(Boolean)
    .map((text) => ({ id: newActionItemId(), text, done: false }));
}

function calcProgressFromItems(items: ActionItem[]): number {
  if (items.length === 0) return 0;
  const done = items.filter((i) => i.done).length;
  return Math.round((done / items.length) * 100);
}

interface Props {
  task: Task | null;
  tasks: Task[]; // 상위업무 선택용
  members: Member[];
  categories: string[];
  userName: string;
  onSave: (data: Partial<Task>, keepFormOpen?: boolean) => Promise<void> | void;
  onClose: () => void;
}

const STATUSES: TaskStatus[] = ['대기', '진행중', '완료', '지연', '보류'];

function tsToString(ts: Timestamp | null | undefined): string {
  if (!ts) return '';
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts as unknown as string);
  return d.toISOString().slice(0, 10);
}

export default function TaskForm({ task, tasks, members, categories, userName, onSave, onClose }: Props) {
  const defaultAssigneeName = task?.assigneeName || userName || '';

  // 기존 description만 있는 업무는 진입 시 자동으로 actionItems로 변환
  const initialActionItems: ActionItem[] = (() => {
    if (task?.actionItems && task.actionItems.length > 0) return task.actionItems;
    if (task?.description) return migrateDescriptionToActionItems(task.description);
    return [];
  })();

  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    actionItems: initialActionItems,
    assigneeName: defaultAssigneeName,
    category: task?.category || (categories[0] || '일반업무'),
    status: task?.status || '대기' as TaskStatus,
    parentTaskId: task?.parentTaskId || '',
    startDate: tsToString(task?.startDate),
    dueDate: tsToString(task?.dueDate),
    progressRate: task?.progressRate || 0,
    reportNote: task?.reportNote || '',
    // 신규 등록은 'team' 디폴트, 수정 시 기존 값(마이그레이션된 168건은 null) 그대로
    reportTo: (task?.reportTo ?? (task ? null : 'team')) as 'ceo' | 'team' | 'both' | null,
    isRecurring: task?.isRecurring || false,
    recurrenceRule: task?.recurrenceRule || null as RecurrenceRule,
    importance: task?.importance || 'normal',
  });

  const hasActionItems = form.actionItems.length > 0;
  const autoProgress = calcProgressFromItems(form.actionItems);
  const effectiveProgress = hasActionItems ? autoProgress : Number(form.progressRate) || 0;

  const addActionItem = () => {
    setForm((f) => ({
      ...f,
      actionItems: [...f.actionItems, { id: newActionItemId(), text: '', done: false }],
    }));
  };

  const updateActionItem = (id: string, patch: Partial<ActionItem>) => {
    setForm((f) => ({
      ...f,
      actionItems: f.actionItems.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    }));
  };

  const removeActionItem = (id: string) => {
    setForm((f) => ({
      ...f,
      actionItems: f.actionItems.filter((it) => it.id !== id),
    }));
  };

  const handleActionItemKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, id: string, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const newItem: ActionItem = { id: newActionItemId(), text: '', done: false };
      setForm((f) => {
        const items = [...f.actionItems];
        items.splice(index + 1, 0, newItem);
        return { ...f, actionItems: items };
      });
      // 새 항목 input으로 포커스 (다음 렌더 후)
      setTimeout(() => {
        const el = document.querySelector<HTMLInputElement>(`input[data-action-id="${newItem.id}"]`);
        el?.focus();
      }, 0);
    } else if (e.key === 'Backspace') {
      const item = form.actionItems.find((it) => it.id === id);
      if (item && item.text === '' && form.actionItems.length > 0) {
        e.preventDefault();
        removeActionItem(id);
        // 이전 항목으로 포커스
        const prevItem = form.actionItems[index - 1];
        if (prevItem) {
          setTimeout(() => {
            const el = document.querySelector<HTMLInputElement>(`input[data-action-id="${prevItem.id}"]`);
            el?.focus();
            el?.setSelectionRange(prevItem.text.length, prevItem.text.length);
          }, 0);
        }
      }
    }
  };

  const isParentTask = !form.parentTaskId;

  // 선택한 카테고리에 해당하는 상위업무만 표시
  const parentCandidates = useMemo(() => {
    return tasks.filter((t) => {
      if (task && t.taskId === task.taskId) return false;
      if (task && t.parentTaskId === task.taskId) return false;
      if (t.parentTaskId) return false; // 상위업무만
      if (t.category !== form.category) return false; // 같은 카테고리만
      return true;
    });
  }, [tasks, task, form.category]);

  // 카테고리 변경 시 상위업무 선택 초기화
  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setForm((f) => ({ ...f, category: e.target.value, parentTaskId: '' }));
  };

  const assigneeNames = (() => {
    if (members.length > 0) return members.map((m) => m.name);
    const names = new Set<string>();
    if (userName) names.add(userName);
    tasks.forEach((t) => { if (t.assigneeName) names.add(t.assigneeName); });
    return Array.from(names);
  })();

  // 회의록 메모 디바운스 자동저장
  const [reportNoteSaveStatus, setReportNoteSaveStatus] = useState<'' | '저장 중...' | '저장됨'>('');
  const debouncedReportNoteSave = useDebouncedCallback(
    async (value: string) => {
      if (!task) return; // 신규 업무는 폼 저장 시 함께 저장
      setReportNoteSaveStatus('저장 중...');
      try {
        await updateTask(task.taskId, {
          reportNote: value,
        } as Partial<Task>, userName, userName);
        setReportNoteSaveStatus('저장됨');
        setTimeout(() => setReportNoteSaveStatus(''), 2000);
      } catch {
        setReportNoteSaveStatus('');
      }
    },
    1000,
  );

  const handleReportNoteChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setForm((f) => ({ ...f, reportNote: value }));
      debouncedReportNoteSave(value);
    },
    [debouncedReportNoteSave],
  );

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const target = e.target;
    const name = target.name;
    const value = target.type === 'checkbox' ? (target as HTMLInputElement).checked : target.value;
    setForm((f) => {
      const next = { ...f, [name]: value };
      if (name === 'status' && value === '완료') next.progressRate = 100;
      return next;
    });
  };

  const [savedCount, setSavedCount] = useState(0);

  const buildData = (): Partial<Task> | null => {
    if (!form.title.trim()) {
      alert('업무명을 입력하세요.');
      return null;
    }

    const reportNoteTrim = form.reportNote.trim();

    // 빈 항목 제거 + 텍스트 trim
    const cleanedActionItems: ActionItem[] = form.actionItems
      .map((it) => ({ ...it, text: it.text.trim() }))
      .filter((it) => it.text);

    const itemsExist = cleanedActionItems.length > 0;
    const allDone = itemsExist && cleanedActionItems.every((it) => it.done);
    const finalProgress = itemsExist
      ? calcProgressFromItems(cleanedActionItems)
      : (Number(form.progressRate) || 0);

    // 액션아이템 전체 완료 → 자동으로 '완료' 상태
    let finalStatus: TaskStatus = form.status;
    if (itemsExist && allDone && finalStatus !== '완료') {
      finalStatus = '완료';
    } else if (itemsExist && !allDone && finalStatus === '완료') {
      // 미완료 항목이 있는데 상태가 완료면 진행중으로 되돌림
      finalStatus = '진행중';
    }

    const data: Partial<Task> = {
      title: form.title.trim(),
      description: isParentTask ? '' : form.description.trim(),
      actionItems: isParentTask ? [] : cleanedActionItems,
      assignee: isParentTask ? '' : form.assigneeName,
      assigneeName: isParentTask ? '' : form.assigneeName,
      category: form.category,
      status: isParentTask ? '대기' : finalStatus,
      parentTaskId: form.parentTaskId || null,
      startDate: isParentTask ? null : (form.startDate ? Timestamp.fromDate(new Date(form.startDate + 'T00:00:00')) : null),
      dueDate: isParentTask ? null : (form.dueDate ? Timestamp.fromDate(new Date(form.dueDate + 'T00:00:00')) : null),
      completedDate: (!isParentTask && finalStatus === '완료')
        ? (task?.status === '완료' && task?.completedDate ? task.completedDate : Timestamp.now())
        : null,
      progressRate: isParentTask ? 0 : finalProgress,
      kpiLinked: null,
      reportNote: isParentTask ? '' : reportNoteTrim,
      reportTo: isParentTask ? null : form.reportTo,
      isRecurring: isParentTask ? false : form.isRecurring,
      recurrenceRule: (!isParentTask && form.isRecurring) ? form.recurrenceRule : null,
      importance: isParentTask ? 'normal' : form.importance,
    };

    if (task) data.taskId = task.taskId;
    return data;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = buildData();
    if (!data) return;
    onSave(data);
  };

  // 저장 후 계속 추가: 카테고리/상위업무/담당자 유지, 나머지 초기화
  const handleSaveAndContinue = async () => {
    const data = buildData();
    if (!data) return;
    await onSave(data, true);
    setSavedCount((c) => c + 1);
    setForm((f) => ({
      ...f,
      title: '',
      description: '',
      actionItems: [],
      reportNote: '',
      reportTo: 'team',
      status: '대기' as TaskStatus,
      startDate: '',
      dueDate: '',
      progressRate: 0,
      isRecurring: false,
      recurrenceRule: null,
      importance: 'normal',
    }));
  };

  return (
    <div className="tm-modal-overlay" onClick={onClose}>
      <div className="tm-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{task ? '업무 수정' : '새 업무'}</h2>
        <form onSubmit={handleSubmit}>

          {/* Step 1: 카테고리 선택 */}
          <label>
            ① 카테고리
            <select name="category" value={form.category} onChange={handleCategoryChange}>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          {/* Step 2: 상위업무 선택 */}
          <label>
            ② 상위 업무
            <select name="parentTaskId" value={form.parentTaskId} onChange={handleChange}>
              <option value="">없음 (새 상위 업무로 등록)</option>
              {parentCandidates.map((t) => (
                <option key={t.taskId} value={t.taskId}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>

          {isParentTask && (
            <div style={{ fontSize: 11, color: 'var(--c-text-3)', margin: '-6px 0 10px', padding: '0 2px' }}>
              상위 업무는 그룹명과 카테고리만 입력합니다. 세부 내용은 하위 업무에서 관리하세요.
            </div>
          )}

          {/* Step 3: 업무명 */}
          <label>
            ③ 업무명 *
            <input
              name="title"
              value={form.title}
              onChange={handleChange}
              placeholder={isParentTask ? '상위 업무 그룹명 (예: 세무일정, 인증서 갱신)' : '하위 업무 제목'}
              autoFocus
            />
          </label>

          {/* 하위업무일 때만 세부 필드 표시 */}
          {!isParentTask && (
            <>
              {/* 체크리스트 (액션아이템) */}
              <label>
                체크리스트
                <div className="tm-checklist">
                  {form.actionItems.length === 0 && (
                    <div className="tm-checklist-empty">
                      세부 항목을 추가하면 체크에 따라 진행률이 자동 계산됩니다.
                    </div>
                  )}
                  {form.actionItems.map((item, idx) => (
                    <div key={item.id} className="tm-checklist-row">
                      <input
                        type="checkbox"
                        className="tm-checklist-check"
                        checked={item.done}
                        onChange={(e) => updateActionItem(item.id, { done: e.target.checked })}
                      />
                      <input
                        type="text"
                        className={`tm-checklist-text ${item.done ? 'tm-checklist-text-done' : ''}`}
                        data-action-id={item.id}
                        value={item.text}
                        onChange={(e) => updateActionItem(item.id, { text: e.target.value })}
                        onKeyDown={(e) => handleActionItemKeyDown(e, item.id, idx)}
                        placeholder="할 일 항목"
                      />
                      <button
                        type="button"
                        className="tm-checklist-remove"
                        onClick={() => removeActionItem(item.id)}
                        title="항목 삭제"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button type="button" className="tm-checklist-add" onClick={addActionItem}>
                    + 항목 추가
                  </button>
                </div>
              </label>

              <div className="tm-form-row-3">
                <label>
                  담당자
                  <select name="assigneeName" value={form.assigneeName} onChange={handleChange}>
                    <option value="">선택</option>
                    {assigneeNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  상태
                  <select name="status" value={form.status} onChange={handleChange}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  진행률 {hasActionItems && <span className="tm-progress-auto-tag">자동</span>}
                  <div className="tm-slider-wrap">
                    <input
                      name="progressRate"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={effectiveProgress}
                      onChange={handleChange}
                      disabled={hasActionItems}
                      title={hasActionItems ? '체크리스트가 있으면 자동 계산됩니다' : ''}
                    />
                    <span className="tm-slider-value">{effectiveProgress}%</span>
                  </div>
                </label>
              </div>

              {/* 중요도 토글 */}
              <label>
                중요도
                <div className="tm-importance-toggle">
                  <button type="button" className={`tm-importance-btn ${form.importance === 'high' ? 'active-high' : ''}`}
                    onClick={() => setForm((f) => ({ ...f, importance: 'high' as const }))}>중요</button>
                  <button type="button" className={`tm-importance-btn ${form.importance === 'normal' ? 'active-normal' : ''}`}
                    onClick={() => setForm((f) => ({ ...f, importance: 'normal' as const }))}>보통</button>
                </div>
              </label>

              <div className="tm-form-row">
                <label>
                  착수일
                  <input name="startDate" type="date" value={form.startDate} onChange={handleChange} />
                </label>
                <label>
                  마감일
                  <input name="dueDate" type="date" value={form.dueDate} onChange={handleChange} />
                </label>
              </div>

              <div className="tm-form-row">
                <label className="tm-checkbox">
                  <input
                    name="isRecurring"
                    type="checkbox"
                    checked={form.isRecurring}
                    onChange={handleChange}
                  />
                  반복 업무
                </label>
                {form.isRecurring && (
                  <label>
                    반복 주기
                    <select
                      name="recurrenceRule"
                      value={form.recurrenceRule || ''}
                      onChange={handleChange}
                    >
                      <option value="">선택</option>
                      <option value="weekly">주간</option>
                      <option value="monthly">월간</option>
                    </select>
                  </label>
                )}
              </div>

              {/* ─── 회의록 노출 영역 ─── */}
              <div style={{
                marginTop: 14,
                padding: 12,
                border: '0.5px solid #e5e5e5',
                borderRadius: 10,
                background: '#fafafa',
              }}>
                <div style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--c-text-2)',
                  marginBottom: 10,
                  paddingBottom: 8,
                  borderBottom: '0.5px solid #e5e5e5',
                }}>
                  📋 회의록 노출 영역
                </div>

                <label>
                  어느 회의에 보고?
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    {[
                      { value: '', label: '보고 안 함', hint: '노출 안 됨' },
                      { value: 'team', label: '팀 월간', hint: '매월 팀 회의 (디폴트)' },
                      { value: 'ceo', label: 'CEO 격주', hint: '대표이사 격주 보고' },
                      { value: 'both', label: '둘 다', hint: '팀 + CEO 모두' },
                    ].map((opt) => {
                      const checked = (form.reportTo ?? '') === opt.value;
                      return (
                        <label key={opt.value} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 8px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: checked ? '#E6F1FB' : 'transparent',
                          fontSize: 13,
                        }}>
                          <input
                            type="radio"
                            name="reportTo"
                            checked={checked}
                            onChange={() => setForm((f) => ({
                              ...f,
                              reportTo: (opt.value === '' ? null : opt.value) as 'ceo' | 'team' | 'both' | null,
                            }))}
                          />
                          <strong>{opt.label}</strong>
                          <span style={{ color: 'var(--c-text-4)', fontSize: 12 }}>— {opt.hint}</span>
                        </label>
                      );
                    })}
                  </div>
                </label>

                <label style={{ marginTop: 10, display: 'block' }}>
                  회의록 메모
                  <div style={{ position: 'relative' }}>
                    <textarea
                      name="reportNote"
                      value={form.reportNote}
                      onChange={handleReportNoteChange}
                      placeholder="진행상황 / 이슈 / 결정 필요 / CEO 보고 사유"
                      rows={3}
                    />
                    {reportNoteSaveStatus && (
                      <span style={{
                        position: 'absolute', right: 8, bottom: 8,
                        fontSize: 11, color: reportNoteSaveStatus === '저장됨' ? 'var(--c-green)' : 'var(--c-text-3)',
                      }}>
                        {reportNoteSaveStatus}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--c-text-4)', marginTop: 2, display: 'block' }}>
                    💡 여기 작성한 내용이 회의록에 노출됩니다
                  </span>
                </label>
              </div>

            </>
          )}

          {savedCount > 0 && (
            <div style={{ fontSize: 11, color: 'var(--c-green)', fontWeight: 600, textAlign: 'center', margin: '8px 0 0' }}>
              {savedCount}건 저장 완료
            </div>
          )}

          <div className="tm-form-actions">
            <button type="button" className="tm-btn-cancel" onClick={onClose}>닫기</button>
            {!task && !isParentTask && (
              <button
                type="button"
                className="tm-btn-continue"
                onClick={handleSaveAndContinue}
              >
                저장 후 계속 추가
              </button>
            )}
            <button type="submit" className="tm-btn-save">{task ? '수정' : '추가'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
