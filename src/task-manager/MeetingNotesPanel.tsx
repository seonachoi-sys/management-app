import React, { useState, useEffect, useMemo } from 'react';
import { Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { MeetingType, Task } from '../types';
import {
  subscribeMeetingLogs,
  saveMeetingLog,
  updateMeetingLog,
  deleteMeetingLog,
  type MeetingLogRecord,
  type MeetingLogInput,
} from '../services/meetingLogService';
import { createTask } from '../services/taskService';
import { useAuth } from '../hooks/useAuth';
import { useMembers } from '../hooks/useMembers';
import { useSettings } from '../hooks/useSettings';

interface DraftActionItem {
  rowId: string; // 클라이언트 임시 ID
  title: string;
  assigneeName: string;
  category: string;
  dueDate: string; // yyyy-MM-dd
}

function newRowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const MEETING_TYPES: MeetingType[] = ['주간', '격주', '월간'];

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function buildPeriodLabel(meetingType: MeetingType, meetingDate: string): string {
  const d = meetingDate ? new Date(meetingDate + 'T00:00:00') : new Date();
  if (meetingType === '월간') return format(d, 'yyyy년 M월 회의');
  if (meetingType === '격주') return format(d, 'yyyy.MM.dd 격주 회의', { locale: ko });
  return format(d, 'yyyy.MM.dd 주간 회의', { locale: ko });
}

export default function MeetingNotesPanel() {
  const { user } = useAuth();
  const { members } = useMembers();
  const { categories } = useSettings();

  // 입력 폼
  const [meetingType, setMeetingType] = useState<MeetingType>('주간');
  const [meetingDate, setMeetingDate] = useState<string>(todayStr());
  const [attendeesText, setAttendeesText] = useState('');
  const [notes, setNotes] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 액션아이템 (저장 시 Task로 자동 등록)
  const [actionItems, setActionItems] = useState<DraftActionItem[]>([]);

  // 저장된 회의록 목록
  const [logs, setLogs] = useState<MeetingLogRecord[]>([]);
  const [filter, setFilter] = useState<'all' | MeetingType>('all');
  const [viewingLog, setViewingLog] = useState<MeetingLogRecord | null>(null);

  const defaultCategory = categories[0] || '일반업무';

  const addActionItem = () => {
    setActionItems((arr) => [
      ...arr,
      {
        rowId: newRowId(),
        title: '',
        assigneeName: '',
        category: defaultCategory,
        dueDate: '',
      },
    ]);
  };

  const updateActionItem = (rowId: string, patch: Partial<DraftActionItem>) => {
    setActionItems((arr) => arr.map((it) => (it.rowId === rowId ? { ...it, ...patch } : it)));
  };

  const removeActionItem = (rowId: string) => {
    setActionItems((arr) => arr.filter((it) => it.rowId !== rowId));
  };

  useEffect(() => {
    const unsub = subscribeMeetingLogs(
      (records) => setLogs(records),
      (err) => console.error('회의록 구독 실패:', err),
    );
    return () => unsub();
  }, []);

  const filteredLogs = useMemo(() => {
    if (filter === 'all') return logs;
    return logs.filter((l) => l.meetingType === filter);
  }, [logs, filter]);

  const resetForm = () => {
    setMeetingType('주간');
    setMeetingDate(todayStr());
    setAttendeesText('');
    setNotes('');
    setActionItems([]);
    setEditingId(null);
  };

  const loadIntoForm = (log: MeetingLogRecord) => {
    setMeetingType(log.meetingType);
    setMeetingDate(log.meetingDate || todayStr());
    setAttendeesText((log.attendees || []).join(', '));
    setNotes(log.notes || '');
    // 수정 모드에서는 액션아이템 신규 등록만 허용 (기존 등록된 업무는 손대지 않음)
    setActionItems([]);
    setEditingId(log.id);
    setViewingLog(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSave = async () => {
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!notes.trim() && actionItems.filter((it) => it.title.trim()).length === 0) {
      alert('회의 내용 또는 액션아이템을 입력해주세요.');
      return;
    }

    // 유효한 액션아이템만 (제목이 있는 것만)
    const validItems = actionItems
      .map((it) => ({ ...it, title: it.title.trim() }))
      .filter((it) => it.title);

    // 담당자 미지정 항목 검증
    const missingAssignee = validItems.filter((it) => !it.assigneeName);
    if (missingAssignee.length > 0) {
      const ok = window.confirm(
        `담당자가 지정되지 않은 액션아이템 ${missingAssignee.length}건이 있습니다. 그래도 저장하시겠습니까?\n(미지정 항목은 본인 명의로 등록됩니다)`,
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const periodLabel = buildPeriodLabel(meetingType, meetingDate);
      const input: MeetingLogInput = {
        meetingType,
        periodLabel,
        periodStart: meetingDate,
        periodEnd: meetingDate,
        meetingDate,
        stats: { total: 0, completed: 0, incomplete: 0, delayed: 0 },
        completedTasks: [],
        inProgressTasks: [],
        upcomingTasks: [],
        delayedTasks: [],
        ceoItems: [],
        attendees: attendeesText.split(',').map((s) => s.trim()).filter(Boolean),
        notes,
        decisions: [],
        nextActions: [],
        extraAgenda: [],
        kpiNotes: {},
        hiddenTaskIds: [],
        hiddenKpiIds: [],
        createdBy: user.uid,
        createdByName: user.displayName || user.email || '',
      };

      // 1. 회의록 저장 (수정/신규)
      let logId = editingId;
      if (editingId) {
        await updateMeetingLog(editingId, input, user.uid, user.displayName || user.email || '');
      } else {
        logId = await saveMeetingLog(input);
      }

      // 2. 액션아이템을 Task로 자동 등록
      const userName = user.displayName || user.email || '';
      let createdCount = 0;
      let failedCount = 0;
      for (const item of validItems) {
        try {
          const dueTs = item.dueDate
            ? Timestamp.fromDate(new Date(item.dueDate + 'T00:00:00'))
            : null;
          const taskData: Partial<Task> = {
            title: item.title,
            description: '',
            actionItems: [],
            assignee: item.assigneeName || userName,
            assigneeName: item.assigneeName || userName,
            category: item.category || defaultCategory,
            status: '대기',
            parentTaskId: null,
            startDate: Timestamp.fromDate(new Date(meetingDate + 'T00:00:00')),
            dueDate: dueTs,
            completedDate: null,
            progressRate: 0,
            kpiLinked: null,
            reportNote: '',
            reportTo: 'team',
            isRecurring: false,
            recurrenceRule: null,
            importance: 'normal',
            meetingLogId: logId,
          };
          await createTask(taskData, user.uid);
          createdCount++;
        } catch (err) {
          console.error('업무 등록 실패:', item.title, err);
          failedCount++;
        }
      }

      // 알림 메시지
      const parts: string[] = [];
      parts.push(editingId ? '회의록이 수정되었습니다.' : '회의록이 저장되었습니다.');
      if (createdCount > 0) parts.push(`업무 ${createdCount}건이 등록되었습니다.`);
      if (failedCount > 0) parts.push(`업무 ${failedCount}건 등록 실패 (콘솔 확인)`);
      alert(parts.join('\n'));

      resetForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (log: MeetingLogRecord) => {
    if (!window.confirm(`"${log.periodLabel}" 회의록을 삭제하시겠습니까?`)) return;
    try {
      await deleteMeetingLog(log.id);
      if (editingId === log.id) resetForm();
      if (viewingLog?.id === log.id) setViewingLog(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : '삭제 실패');
    }
  };

  const handleCopy = (log: MeetingLogRecord) => {
    navigator.clipboard.writeText(log.notes || '').then(
      () => alert('클립보드에 복사되었습니다.'),
      () => alert('복사 실패'),
    );
  };

  return (
    <div className="tm-meeting-notes-view">
      {/* ─── 회의록 작성 폼 ─── */}
      <div className="rpt-log-form" style={{ marginTop: 0 }}>
        <div className="rpt-log-form-header">
          <h3>📝 회의록 {editingId ? '수정' : '작성'}</h3>
          {editingId && (
            <button className="rpt-log-form-new" onClick={resetForm} type="button">
              새 회의록 작성
            </button>
          )}
        </div>

        <div className="rpt-log-row">
          <label className="rpt-log-label">회의 유형</label>
          <select
            className="rpt-log-input"
            value={meetingType}
            onChange={(e) => setMeetingType(e.target.value as MeetingType)}
            style={{ maxWidth: 160 }}
          >
            {MEETING_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="rpt-log-row">
          <label className="rpt-log-label">회의일</label>
          <input
            type="date"
            className="rpt-log-input"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
          />
        </div>

        <div className="rpt-log-row">
          <label className="rpt-log-label">참석자</label>
          <input
            type="text"
            className="rpt-log-input"
            placeholder="쉼표로 구분 (선택)"
            value={attendeesText}
            onChange={(e) => setAttendeesText(e.target.value)}
          />
        </div>

        <div className="rpt-log-row rpt-log-row-col">
          <label className="rpt-log-label">회의 내용</label>
          <textarea
            className="rpt-log-textarea tm-meeting-paste-area"
            placeholder="회의 종료 후 정리한 내용을 여기에 붙여넣고 저장하세요. (안건, 논의, 결정사항, 액션아이템 등)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={20}
          />
        </div>

        {/* 액션아이템 → 업무 자동 등록 */}
        <div className="rpt-log-row rpt-log-row-col">
          <label className="rpt-log-label">
            액션아이템
            <span className="tm-action-items-hint">저장 시 업무관리에 자동 등록됩니다</span>
          </label>

          {actionItems.length === 0 && (
            <div className="tm-action-items-empty">
              회의에서 정해진 새 업무를 여기에 추가하세요. 저장 버튼을 누르면 업무관리에 등록됩니다.
            </div>
          )}

          {actionItems.length > 0 && (
            <div className="tm-action-items-table">
              <div className="tm-action-items-header">
                <div>업무 제목</div>
                <div>담당자</div>
                <div>카테고리</div>
                <div>마감일</div>
                <div></div>
              </div>
              {actionItems.map((item) => (
                <div key={item.rowId} className="tm-action-items-row">
                  <input
                    type="text"
                    placeholder="업무 제목"
                    value={item.title}
                    onChange={(e) => updateActionItem(item.rowId, { title: e.target.value })}
                  />
                  <select
                    value={item.assigneeName}
                    onChange={(e) => updateActionItem(item.rowId, { assigneeName: e.target.value })}
                  >
                    <option value="">담당자 선택</option>
                    {members.map((m) => (
                      <option key={m.memberId} value={m.name}>{m.name}</option>
                    ))}
                  </select>
                  <select
                    value={item.category}
                    onChange={(e) => updateActionItem(item.rowId, { category: e.target.value })}
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={item.dueDate}
                    onChange={(e) => updateActionItem(item.rowId, { dueDate: e.target.value })}
                  />
                  <button
                    type="button"
                    className="tm-action-items-remove"
                    onClick={() => removeActionItem(item.rowId)}
                    title="삭제"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <button type="button" className="tm-action-items-add" onClick={addActionItem}>
            + 액션아이템 추가
          </button>
        </div>

        <div className="rpt-log-actions">
          <button
            type="button"
            className="rpt-log-save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '저장 중...' : editingId ? '회의록 수정' : '회의록 저장'}
          </button>
          {editingId && (
            <button
              type="button"
              className="tm-btn-cancel"
              onClick={resetForm}
            >
              취소
            </button>
          )}
        </div>
      </div>

      {/* ─── 저장된 회의록 목록 ─── */}
      <div className="tm-meeting-logs-section">
        <div className="tm-meeting-logs-header">
          <h3>📂 저장된 회의록 ({filteredLogs.length})</h3>
          <div className="tm-meeting-logs-filter">
            <button
              className={filter === 'all' ? 'active' : ''}
              onClick={() => setFilter('all')}
            >
              전체
            </button>
            {MEETING_TYPES.map((t) => (
              <button
                key={t}
                className={filter === t ? 'active' : ''}
                onClick={() => setFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="rpt-empty">저장된 회의록이 없습니다.</div>
        ) : (
          <ul className="tm-meeting-logs-list">
            {filteredLogs.map((log) => {
              const preview = (log.notes || '').slice(0, 120);
              return (
                <li key={log.id} className="tm-meeting-log-item">
                  <div className="tm-meeting-log-main">
                    <div className="tm-meeting-log-title">
                      <span className={`rpt-log-view-badge rpt-log-view-badge-${log.meetingType}`}>
                        {log.meetingType}
                      </span>
                      <span className="tm-meeting-log-date">
                        {log.meetingDate
                          ? format(new Date(log.meetingDate + 'T00:00:00'), 'yyyy.MM.dd (EEE)', { locale: ko })
                          : log.periodLabel}
                      </span>
                      {log.attendees && log.attendees.length > 0 && (
                        <span className="tm-meeting-log-attendees">
                          참석 {log.attendees.length}명
                        </span>
                      )}
                    </div>
                    {preview && (
                      <div className="tm-meeting-log-preview">
                        {preview}
                        {(log.notes || '').length > 120 ? '…' : ''}
                      </div>
                    )}
                  </div>
                  <div className="tm-meeting-log-actions">
                    <button onClick={() => setViewingLog(log)}>보기</button>
                    <button onClick={() => loadIntoForm(log)}>수정</button>
                    <button onClick={() => handleCopy(log)}>복사</button>
                    <button className="btn-delete" onClick={() => handleDelete(log)}>삭제</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ─── 상세 보기 모달 ─── */}
      {viewingLog && (
        <div className="tm-modal-overlay" onClick={() => setViewingLog(null)}>
          <div className="tm-modal tm-meeting-view-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tm-meeting-view-header">
              <h2>
                <span className={`rpt-log-view-badge rpt-log-view-badge-${viewingLog.meetingType}`}>
                  {viewingLog.meetingType}
                </span>
                {viewingLog.meetingDate
                  ? format(new Date(viewingLog.meetingDate + 'T00:00:00'), 'yyyy.MM.dd (EEE)', { locale: ko })
                  : viewingLog.periodLabel}
              </h2>
              <button className="tm-modal-close" onClick={() => setViewingLog(null)}>×</button>
            </div>
            {viewingLog.attendees && viewingLog.attendees.length > 0 && (
              <div className="tm-meeting-view-meta">
                참석자: {viewingLog.attendees.join(', ')}
              </div>
            )}
            <pre className="tm-meeting-view-body">{viewingLog.notes || '(내용 없음)'}</pre>
            <div className="tm-modal-actions">
              <button onClick={() => loadIntoForm(viewingLog)}>수정</button>
              <button onClick={() => handleCopy(viewingLog)}>복사</button>
              <button className="btn-delete" onClick={() => handleDelete(viewingLog)}>삭제</button>
              <button className="tm-btn-cancel" onClick={() => setViewingLog(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
