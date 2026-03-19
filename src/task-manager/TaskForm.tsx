import React, { useState, useMemo } from 'react';
import { Timestamp } from 'firebase/firestore';
import type { Task, TaskStatus, RecurrenceRule, Member } from '../types';

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

  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    assigneeName: defaultAssigneeName,
    category: task?.category || (categories[0] || '일반업무'),
    status: task?.status || '대기' as TaskStatus,
    parentTaskId: task?.parentTaskId || '',
    startDate: tsToString(task?.startDate),
    dueDate: tsToString(task?.dueDate),
    progressRate: task?.progressRate || 0,
    notes: task?.notes || '',
    isRecurring: task?.isRecurring || false,
    recurrenceRule: task?.recurrenceRule || null as RecurrenceRule,
    ceoFlag: task?.ceoFlag || false,
    ceoFlagReason: task?.ceoFlagReason || '',
  });

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

    const data: Partial<Task> = {
      title: form.title.trim(),
      description: isParentTask ? '' : form.description.trim(),
      assignee: isParentTask ? '' : form.assigneeName,
      assigneeName: isParentTask ? '' : form.assigneeName,
      category: form.category,
      status: isParentTask ? '대기' : form.status,
      parentTaskId: form.parentTaskId || null,
      startDate: isParentTask ? null : (form.startDate ? Timestamp.fromDate(new Date(form.startDate)) : null),
      dueDate: isParentTask ? null : (form.dueDate ? Timestamp.fromDate(new Date(form.dueDate)) : null),
      completedDate: (!isParentTask && form.status === '완료') ? Timestamp.now() : null,
      progressRate: isParentTask ? 0 : (Number(form.progressRate) || 0),
      kpiLinked: null,
      notes: isParentTask ? '' : form.notes.trim(),
      isRecurring: isParentTask ? false : form.isRecurring,
      recurrenceRule: (!isParentTask && form.isRecurring) ? form.recurrenceRule : null,
      ceoFlag: isParentTask ? false : form.ceoFlag,
      ceoFlagReason: (!isParentTask && form.ceoFlag) ? form.ceoFlagReason : '',
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
      status: '대기' as TaskStatus,
      startDate: '',
      dueDate: '',
      progressRate: 0,
      notes: '',
      isRecurring: false,
      recurrenceRule: null,
      ceoFlag: false,
      ceoFlagReason: '',
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
              <label>
                상세 내용
                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="업무 상세 내용"
                  rows={2}
                />
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
                  진행률
                  <div className="tm-slider-wrap">
                    <input
                      name="progressRate"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={form.progressRate}
                      onChange={handleChange}
                    />
                    <span className="tm-slider-value">{form.progressRate}%</span>
                  </div>
                </label>
              </div>

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

              <label>
                메모
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={handleChange}
                  placeholder="참고 사항, 비고"
                  rows={2}
                />
              </label>

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

              <label className="tm-checkbox">
                <input
                  name="ceoFlag"
                  type="checkbox"
                  checked={form.ceoFlag}
                  onChange={handleChange}
                />
                CEO 보고/결재 필요
              </label>

              {form.ceoFlag && (
                <label>
                  CEO 플래그 사유
                  <input
                    name="ceoFlagReason"
                    value={form.ceoFlagReason}
                    onChange={handleChange}
                    placeholder="보고/결재가 필요한 이유"
                  />
                </label>
              )}
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
