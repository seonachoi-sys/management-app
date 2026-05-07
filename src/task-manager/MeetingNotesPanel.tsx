import React, { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { MeetingType } from '../types';
import {
  subscribeMeetingLogs,
  saveMeetingLog,
  updateMeetingLog,
  deleteMeetingLog,
  type MeetingLogRecord,
  type MeetingLogInput,
} from '../services/meetingLogService';
import { useAuth } from '../hooks/useAuth';

const MEETING_TYPES: MeetingType[] = ['주간', '격주', '월간'];

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function buildPeriodLabel(meetingType: MeetingType, meetingDate: string): string {
  const d = meetingDate ? new Date(meetingDate) : new Date();
  if (meetingType === '월간') return format(d, 'yyyy년 M월 회의');
  if (meetingType === '격주') return format(d, 'yyyy.MM.dd 격주 회의', { locale: ko });
  return format(d, 'yyyy.MM.dd 주간 회의', { locale: ko });
}

export default function MeetingNotesPanel() {
  const { user } = useAuth();

  // 입력 폼
  const [meetingType, setMeetingType] = useState<MeetingType>('주간');
  const [meetingDate, setMeetingDate] = useState<string>(todayStr());
  const [attendeesText, setAttendeesText] = useState('');
  const [notes, setNotes] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 저장된 회의록 목록
  const [logs, setLogs] = useState<MeetingLogRecord[]>([]);
  const [filter, setFilter] = useState<'all' | MeetingType>('all');
  const [viewingLog, setViewingLog] = useState<MeetingLogRecord | null>(null);

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
    setEditingId(null);
  };

  const loadIntoForm = (log: MeetingLogRecord) => {
    setMeetingType(log.meetingType);
    setMeetingDate(log.meetingDate || todayStr());
    setAttendeesText((log.attendees || []).join(', '));
    setNotes(log.notes || '');
    setEditingId(log.id);
    setViewingLog(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSave = async () => {
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!notes.trim()) {
      alert('회의 내용을 입력해주세요.');
      return;
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

      if (editingId) {
        await updateMeetingLog(editingId, input, user.uid, user.displayName || user.email || '');
        alert('회의록이 수정되었습니다.');
      } else {
        await saveMeetingLog(input);
        alert('회의록이 저장되었습니다.');
      }
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
                          ? format(new Date(log.meetingDate), 'yyyy.MM.dd (EEE)', { locale: ko })
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
                  ? format(new Date(viewingLog.meetingDate), 'yyyy.MM.dd (EEE)', { locale: ko })
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
