import React, { useState, useRef } from 'react';
import type { Member } from '../types';
import { useMembers } from '../hooks/useMembers';
import { createMember, updateMember } from '../services/memberService';
import { importCsvToFirestore } from '../utils/csvImport';

interface Props {
  taskCategories: string[];
  kpiCategories: string[];
  ceoMeetingDates: string[];
  onSaveTaskCategories: (cats: string[]) => Promise<void>;
  onSaveKpiCategories: (cats: string[]) => Promise<void>;
  onSaveCeoMeetingDates: (dates: string[]) => Promise<void>;
  onClose: () => void;
  userId?: string;
}

function CategoryEditor({
  label,
  items,
  onSave,
}: {
  label: string;
  items: string[];
  onSave: (items: string[]) => Promise<void>;
}) {
  const [list, setList] = useState([...items]);
  const [newItem, setNewItem] = useState('');
  const [saving, setSaving] = useState(false);

  const add = () => {
    const val = newItem.trim();
    if (!val || list.includes(val)) return;
    const next = [...list, val];
    setList(next);
    setNewItem('');
    setSaving(true);
    onSave(next).finally(() => setSaving(false));
  };

  const remove = (idx: number) => {
    const next = list.filter((_, i) => i !== idx);
    setList(next);
    onSave(next);
  };

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = [...list];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setList(next);
    onSave(next);
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-ink-secondary)', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="새 항목 입력"
          style={{
            flex: 1, padding: '7px 12px',
            border: '1px solid var(--tm-border-default)',
            borderRadius: 'var(--tm-radius-sm)',
            fontSize: 13, fontFamily: 'var(--tm-font)',
            background: 'var(--tm-surface-inset)',
          }}
        />
        <button className="tm-btn-add" onClick={add} disabled={saving} style={{ padding: '7px 14px' }}>
          추가
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {list.map((item, idx) => (
          <div key={idx} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px', background: 'var(--tm-surface-inset)',
            borderRadius: 'var(--tm-radius-sm)', fontSize: 13,
          }}>
            <span style={{ flex: 1, fontWeight: 500 }}>{item}</span>
            <button onClick={() => moveUp(idx)} disabled={idx === 0}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tm-ink-tertiary)', fontSize: 11, opacity: idx === 0 ? 0.3 : 1 }}>▲</button>
            <button onClick={() => remove(idx)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tm-urgent)', fontSize: 11 }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPanel({
  taskCategories, kpiCategories, ceoMeetingDates,
  onSaveTaskCategories, onSaveKpiCategories, onSaveCeoMeetingDates,
  onClose,
  userId,
}: Props) {
  const [newMeetingDate, setNewMeetingDate] = useState('');
  const { members } = useMembers();
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [editMember, setEditMember] = useState<Member | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importResult, setImportResult] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    setImporting(true);
    setImportResult('');
    setImportProgress('가져오기 준비 중...');

    try {
      const result = await importCsvToFirestore(
        file,
        userId,
        (current, total, title) => {
          setImportProgress(`(${current}/${total}) ${title}`);
        },
      );

      const msg = `완료! 생성: ${result.created}건, 건너뜀(중복): ${result.skipped}건` +
        (result.errors.length > 0 ? `\n오류: ${result.errors.join('\n')}` : '');
      setImportResult(msg);
      setImportProgress('');
    } catch (err) {
      setImportResult(`가져오기 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="tm-modal-overlay" onClick={onClose}>
      <div className="tm-modal" onClick={(e) => e.stopPropagation()} style={{ width: 520, maxHeight: '85vh' }}>
        <h2>설정</h2>

        {/* CSV 가져오기 */}
        <div style={{ marginBottom: 24, padding: 16, background: 'var(--tm-surface-inset)', borderRadius: 'var(--tm-radius-sm)', border: '1px dashed var(--tm-border-default)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-ink-secondary)', marginBottom: 8 }}>
            CSV 업무 가져오기
          </div>
          <div style={{ fontSize: 11, color: 'var(--tm-ink-tertiary)', marginBottom: 10 }}>
            업무관리 CSV 파일을 선택하면 상위/하위 업무가 자동으로 등록됩니다. 이미 등록된 업무(같은 제목)는 건너뜁니다.
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleCsvImport}
            disabled={importing || !userId}
            style={{ fontSize: 12, fontFamily: 'var(--tm-font)' }}
          />
          {importing && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--tm-brand)' }}>
              {importProgress}
            </div>
          )}
          {importResult && (
            <div style={{
              marginTop: 8, fontSize: 12, padding: '8px 10px',
              background: importResult.startsWith('완료') ? '#e8f5e9' : '#fce4ec',
              borderRadius: 4, whiteSpace: 'pre-wrap',
            }}>
              {importResult}
            </div>
          )}
        </div>

        <CategoryEditor label="업무 분류 관리" items={taskCategories} onSave={onSaveTaskCategories} />
        <CategoryEditor label="KPI 분류 관리" items={kpiCategories} onSave={onSaveKpiCategories} />

        {/* 대표이사 미팅 일정 */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-ink-secondary)', marginBottom: 8 }}>
            대표이사 미팅 일정
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              type="date"
              value={newMeetingDate}
              onChange={(e) => setNewMeetingDate(e.target.value)}
              style={{
                flex: 1, padding: '7px 12px',
                border: '1px solid var(--tm-border-default)',
                borderRadius: 'var(--tm-radius-sm)',
                fontSize: 13, fontFamily: 'var(--tm-font)',
                background: 'var(--tm-surface-inset)',
              }}
            />
            <button className="tm-btn-add" style={{ padding: '7px 14px' }} onClick={() => {
              if (!newMeetingDate || ceoMeetingDates.includes(newMeetingDate)) return;
              onSaveCeoMeetingDates([...ceoMeetingDates, newMeetingDate].sort());
              setNewMeetingDate('');
            }}>추가</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {ceoMeetingDates.map((date) => (
              <div key={date} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', background: 'var(--tm-surface-inset)',
                borderRadius: 'var(--tm-radius-sm)', fontSize: 13,
              }}>
                <span style={{ flex: 1, fontWeight: 500 }}>{date}</span>
                <button onClick={() => onSaveCeoMeetingDates(ceoMeetingDates.filter(d => d !== date))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tm-urgent)', fontSize: 11 }}>✕</button>
              </div>
            ))}
            {ceoMeetingDates.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--tm-ink-tertiary)', padding: 8 }}>등록된 미팅 일정이 없습니다</div>
            )}
          </div>
        </div>

        {/* 팀원 관리 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-ink-secondary)' }}>팀원 관리</div>
            <button className="tm-btn-add" style={{ padding: '5px 12px', fontSize: 11 }}
              onClick={() => { setEditMember(null); setShowMemberForm(true); }}>
              + 팀원
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {members.map((m) => (
              <div key={m.memberId} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', background: 'var(--tm-surface-inset)',
                borderRadius: 'var(--tm-radius-sm)', fontSize: 13,
              }}>
                <span style={{ flex: 1, fontWeight: 500 }}>{m.name}</span>
                <span style={{ fontSize: 11, color: 'var(--tm-ink-tertiary)' }}>{m.role} · {m.department}</span>
                <button onClick={() => { setEditMember(m); setShowMemberForm(true); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tm-brand)', fontSize: 11 }}>수정</button>
                <button onClick={async () => { await updateMember(m.memberId, { isActive: false }); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tm-urgent)', fontSize: 11 }}>비활성</button>
              </div>
            ))}
            {members.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--tm-ink-tertiary)', padding: 8 }}>등록된 팀원이 없습니다</div>
            )}
          </div>
        </div>

        <div className="tm-form-actions">
          <button className="tm-btn-save" onClick={onClose}>닫기</button>
        </div>

        {showMemberForm && (
          <MemberForm
            member={editMember}
            onSave={async (data) => {
              if (editMember) {
                await updateMember(editMember.memberId, data);
              } else {
                await createMember({ ...data, isActive: true } as any);
              }
              setShowMemberForm(false);
              setEditMember(null);
            }}
            onClose={() => { setShowMemberForm(false); setEditMember(null); }}
          />
        )}
      </div>
    </div>
  );
}

function MemberForm({ member, onSave, onClose }: {
  member: Member | null;
  onSave: (data: Partial<Member>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: member?.name || '',
    email: member?.email || '',
    role: member?.role || '팀원' as '팀장' | '팀원',
    department: member?.department || '',
  });

  return (
    <div className="tm-modal-overlay" style={{ zIndex: 1100 }} onClick={onClose}>
      <div className="tm-modal" onClick={(e) => e.stopPropagation()} style={{ width: 380 }}>
        <h2>{member ? '팀원 수정' : '팀원 추가'}</h2>
        <form onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
          <label>이름 *<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>이메일<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <div className="tm-form-row">
            <label>역할
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as any })}>
                <option value="팀장">팀장</option>
                <option value="팀원">팀원</option>
              </select>
            </label>
            <label>부서<input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></label>
          </div>
          <div className="tm-form-actions">
            <button type="button" className="tm-btn-cancel" onClick={onClose}>취소</button>
            <button type="submit" className="tm-btn-save">{member ? '수정' : '추가'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
