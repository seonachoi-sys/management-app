import React, { useState, useCallback, useMemo } from 'react';
import { Timestamp } from 'firebase/firestore';
import { format, startOfMonth, endOfMonth, differenceInDays } from 'date-fns';
import type { Task, MeetingType } from '../types';
import { fetchAllTasks } from '../services/taskService';
import { saveReportToObsidian, formatReportMarkdown } from '../services/obsidianService';

/* ─── 아코디언 블록 ─── */
function Block({
  title,
  count,
  dotColor,
  danger,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  dotColor?: string;
  danger?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rpt-block ${danger ? 'rpt-block-danger' : ''}`}>
      <button className="rpt-block-header" onClick={() => setOpen(!open)} type="button">
        {dotColor && <span className={`rpt-dot rpt-dot-${dotColor}`} />}
        <span style={{ flex: 1, textAlign: 'left' }}>{title}</span>
        {count !== undefined && <span className="rpt-count">{count}</span>}
        <span className={`rpt-toggle ${open ? 'open' : ''}`}>▶</span>
      </button>
      {open && <div className="rpt-block-body">{children}</div>}
    </div>
  );
}

/* ─── 유틸 ─── */
function tsToDate(ts: Timestamp | null | undefined): Date | null {
  if (!ts) return null;
  return ts instanceof Timestamp ? ts.toDate() : new Date(ts as unknown as string);
}

function isParentHeader(task: Task, allTasks: Task[]): boolean {
  if (task.parentTaskId) return false;
  return allTasks.some((t) => t.parentTaskId === task.taskId);
}

interface CategoryGroup {
  category: string;
  tasks: Task[];
}

function groupByCategory(tasks: Task[]): CategoryGroup[] {
  const map: Record<string, Task[]> = {};
  for (const t of tasks) {
    const cat = t.category || '기타';
    if (!map[cat]) map[cat] = [];
    map[cat].push(t);
  }
  return Object.entries(map).map(([category, tasks]) => ({ category, tasks }));
}

/* ─── 메인 컴포넌트 ─── */
export default function MeetingReportPanel() {
  const [reportType, setReportType] = useState<MeetingType>('주간');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [generated, setGenerated] = useState(false);

  const now = new Date();
  const [startDate, setStartDate] = useState(format(startOfMonth(now), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(now), 'yyyy-MM-dd'));

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tasks = await fetchAllTasks();
      setAllTasks(tasks);
      setGenerated(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '리포트 생성에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  // 상위업무(그룹 헤더) 제외한 실제 업무
  const reportTasks = useMemo(() => {
    return allTasks.filter((t) => !isParentHeader(t, allTasks));
  }, [allTasks]);

  // 기간 내 업무 분류
  const { completedTasks, incompleteTasks, delayedTasks, periodLabel, stats } = useMemo(() => {
    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);
    rangeEnd.setHours(23, 59, 59, 999);
    const today = new Date();

    // 기간 내 완료된 업무
    const completed = reportTasks.filter((t) => {
      if (t.status !== '완료') return false;
      const cd = tsToDate(t.completedDate);
      if (cd && cd >= rangeStart && cd <= rangeEnd) return true;
      // completedDate 없으면 dueDate 기준
      const dd = tsToDate(t.dueDate);
      if (!cd && dd && dd >= rangeStart && dd <= rangeEnd) return true;
      return false;
    });

    // 기간 내 미완료 업무 (진행중/대기/지연/보류 중 해당 기간에 걸치는 업무)
    const incomplete = reportTasks.filter((t) => {
      if (t.status === '완료') return false;
      const sd = tsToDate(t.startDate);
      const dd = tsToDate(t.dueDate);
      // 시작일 또는 마감일이 기간 내에 있는 업무
      if (sd && sd >= rangeStart && sd <= rangeEnd) return true;
      if (dd && dd >= rangeStart && dd <= rangeEnd) return true;
      // 기간을 걸치는 업무 (시작 < rangeEnd && 마감 > rangeStart)
      if (sd && dd && sd <= rangeEnd && dd >= rangeStart) return true;
      return false;
    });

    // 지연 업무 (마감일 초과)
    const delayed = incomplete.filter((t) => {
      const dd = tsToDate(t.dueDate);
      return dd && dd < today;
    });

    const periodLabel = `${format(rangeStart, 'yyyy.MM.dd')} ~ ${format(rangeEnd, 'yyyy.MM.dd')}`;

    return {
      completedTasks: completed,
      incompleteTasks: incomplete,
      delayedTasks: delayed,
      periodLabel,
      stats: {
        total: completed.length + incomplete.length,
        completed: completed.length,
        incomplete: incomplete.length,
        delayed: delayed.length,
      },
    };
  }, [reportTasks, startDate, endDate]);

  const completedByCategory = useMemo(() => groupByCategory(completedTasks), [completedTasks]);
  const incompleteByCategory = useMemo(() => groupByCategory(incompleteTasks), [incompleteTasks]);

  // CEO 결재 필요 업무
  const ceoItems = useMemo(() => {
    return incompleteTasks.filter((t) => t.ceoFlag);
  }, [incompleteTasks]);

  // 클립보드 복사
  const copyToClipboard = () => {
    let text = `${periodLabel}\n${'='.repeat(40)}\n\n`;
    text += `전체 ${stats.total}건 | 미완료 ${stats.incomplete}건 | 완료 ${stats.completed}건 | 지연 ${stats.delayed}건\n\n`;

    if (incompleteByCategory.length > 0) {
      text += '■ 미완료 업무\n';
      incompleteByCategory.forEach((g) => {
        text += `\n  [${g.category}]\n`;
        g.tasks.forEach((t) => {
          const dd = tsToDate(t.dueDate);
          const dday = dd ? differenceInDays(dd, new Date()) : null;
          const ddayStr = dday !== null ? (dday < 0 ? `D+${Math.abs(dday)}` : `D-${dday}`) : '';
          text += `    - ${t.title} (${t.assigneeName || '미배정'}, ${t.progressRate}% ${ddayStr})\n`;
        });
      });
      text += '\n';
    }

    if (completedByCategory.length > 0) {
      text += '■ 완료 업무\n';
      completedByCategory.forEach((g) => {
        text += `\n  [${g.category}]\n`;
        g.tasks.forEach((t) => {
          const cd = tsToDate(t.completedDate);
          text += `    - ${t.title} (${t.assigneeName || ''}, ${cd ? format(cd, 'MM.dd') : ''})\n`;
        });
      });
    }

    if (ceoItems.length > 0) {
      text += '\n■ CEO 결재/검토 필요\n';
      ceoItems.forEach((t) => {
        text += `  - ${t.title} (${t.assigneeName || ''}) - ${t.ceoFlagReason}\n`;
      });
    }

    navigator.clipboard.writeText(text);
    alert('클립보드에 복사되었습니다.');
  };

  // Obsidian 저장
  const [savingObsidian, setSavingObsidian] = useState(false);

  const handleSaveToObsidian = async () => {
    setSavingObsidian(true);
    try {
      const typeLabel = reportType === '주간' ? '주간회의' : reportType === '격주' ? '격주보고' : '월간보고';

      // 카테고리별 데이터를 마크다운용으로 변환
      const incompleteForMd = incompleteByCategory.map((g) => ({
        category: g.category,
        tasks: g.tasks.map((t) => {
          const dd = tsToDate(t.dueDate);
          const daysLeft = dd ? differenceInDays(dd, new Date()) : null;
          return {
            title: t.title,
            assigneeName: t.assigneeName || '',
            progressRate: t.progressRate || 0,
            daysLeft,
            notes: t.notes || '',
          };
        }),
      }));

      const completedForMd = completedByCategory.map((g) => ({
        category: g.category,
        tasks: g.tasks.map((t) => {
          const cd = tsToDate(t.completedDate);
          return {
            title: t.title,
            assigneeName: t.assigneeName || '',
            completedDate: cd ? format(cd, 'MM.dd') : '',
          };
        }),
      }));

      const ceoForMd = ceoItems.map((t) => ({
        title: t.title,
        assigneeName: t.assigneeName || '',
        ceoFlagReason: t.ceoFlagReason || '',
        notes: t.notes || '',
      }));

      const markdown = formatReportMarkdown(
        typeLabel,
        periodLabel,
        stats,
        incompleteForMd,
        completedForMd,
        ceoForMd,
      );

      const savedPath = await saveReportToObsidian(markdown, typeLabel, periodLabel);
      alert(`Obsidian에 저장 완료!\n📁 ${savedPath}`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Obsidian 저장 실패');
    } finally {
      setSavingObsidian(false);
    }
  };

  return (
    <div className="tm-report-view">
      {/* 탭 */}
      <div className="tm-report-tabs">
        {(['주간', '격주', '월간'] as MeetingType[]).map((type) => (
          <button
            key={type}
            className={`tm-report-tab ${reportType === type ? 'active' : ''}`}
            onClick={() => { setReportType(type); setGenerated(false); }}
          >
            {type === '주간' ? '주간 (팀)' : type === '격주' ? '격주 (CEO)' : '월간 (전체)'}
          </button>
        ))}
      </div>

      {/* 날짜 선택 + 생성 */}
      <div className="rpt-date-bar">
        <label className="rpt-date-label">
          시작일
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <span className="rpt-date-sep">~</span>
        <label className="rpt-date-label">
          종료일
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <button className="tm-btn-generate" onClick={handleGenerate} disabled={loading}>
          {loading ? '생성 중...' : '리포트 생성'}
        </button>
        {generated && (
          <>
            <button className="tm-btn-copy" onClick={copyToClipboard}>복사</button>
            <button
              className="tm-btn-obsidian"
              onClick={handleSaveToObsidian}
              disabled={savingObsidian}
            >
              {savingObsidian ? '저장 중...' : 'Obsidian 저장'}
            </button>
          </>
        )}
      </div>

      {error && <div className="tm-error">{error}</div>}

      {generated && (
        <div className="tm-report-content">
          <h2 className="tm-report-title">{periodLabel}</h2>

          {/* 요약 카드 */}
          <div className="tm-perf-grid">
            <div className="tm-perf-item">
              <div className="tm-perf-value">{stats.total}</div>
              <div className="tm-perf-label">전체</div>
            </div>
            <div className="tm-perf-item">
              <div className="tm-perf-value" style={{ color: 'var(--c-accent)' }}>{stats.incomplete}</div>
              <div className="tm-perf-label">미완료</div>
            </div>
            <div className="tm-perf-item">
              <div className="tm-perf-value" style={{ color: 'var(--c-green)' }}>{stats.completed}</div>
              <div className="tm-perf-label">완료</div>
            </div>
            <div className="tm-perf-item">
              <div className="tm-perf-value" style={{ color: 'var(--c-red)' }}>{stats.delayed}</div>
              <div className="tm-perf-label">지연</div>
            </div>
          </div>

          {/* ─── 미완료 업무 (카테고리별) ─── */}
          <Block
            title="미완료 업무"
            count={stats.incomplete}
            dotColor="blue"
            defaultOpen
          >
            {incompleteByCategory.length === 0 ? (
              <div className="rpt-empty">미완료 업무 없음</div>
            ) : (
              incompleteByCategory.map((group) => (
                <div key={group.category} className="rpt-cat-group">
                  <div className="rpt-cat-label">{group.category} <span className="rpt-cat-cnt">{group.tasks.length}</span></div>
                  <div className="rpt-list">
                    {group.tasks.map((t) => {
                      const dd = tsToDate(t.dueDate);
                      const daysLeft = dd ? differenceInDays(dd, new Date()) : null;
                      const isDelayed = daysLeft !== null && daysLeft < 0;
                      return (
                        <div key={t.taskId} className={`rpt-item ${isDelayed ? 'rpt-item-delayed' : ''}`}>
                          <span className="rpt-item-title">{t.title}</span>
                          <span className="rpt-item-assignee">{t.assigneeName}</span>
                          <div className="rpt-progress">
                            <div className="rpt-progress-bar">
                              <div className="rpt-progress-fill" style={{ width: `${t.progressRate}%` }} />
                            </div>
                            <span className="rpt-progress-text">{t.progressRate}%</span>
                          </div>
                          {daysLeft !== null && (
                            <span className={`rpt-item-tag ${isDelayed ? 'rpt-tag-red' : daysLeft <= 3 ? 'rpt-tag-orange' : 'rpt-tag-gray'}`}>
                              {isDelayed ? `D+${Math.abs(daysLeft)}` : `D-${daysLeft}`}
                            </span>
                          )}
                          {t.notes && <span className="rpt-item-note" title={t.notes}>📋</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </Block>

          {/* ─── CEO 결재 필요 ─── */}
          {ceoItems.length > 0 && (
            <Block title="CEO 결재/검토 필요" count={ceoItems.length} dotColor="yellow" defaultOpen>
              <div className="rpt-list">
                {ceoItems.map((t) => (
                  <div key={t.taskId} className="rpt-item">
                    <span className="rpt-item-title">{t.title}</span>
                    <span className="rpt-item-assignee">{t.assigneeName}</span>
                    <span className="rpt-item-reason">{t.ceoFlagReason || t.notes}</span>
                  </div>
                ))}
              </div>
            </Block>
          )}

          {/* ─── 완료 업무 (카테고리별, 기본 접힘) ─── */}
          <Block
            title="완료 업무"
            count={stats.completed}
            dotColor="green"
            defaultOpen={false}
          >
            {completedByCategory.length === 0 ? (
              <div className="rpt-empty">완료 업무 없음</div>
            ) : (
              completedByCategory.map((group) => (
                <div key={group.category} className="rpt-cat-group">
                  <div className="rpt-cat-label">{group.category} <span className="rpt-cat-cnt">{group.tasks.length}</span></div>
                  <div className="rpt-list">
                    {group.tasks.map((t) => {
                      const cd = tsToDate(t.completedDate);
                      return (
                        <div key={t.taskId} className="rpt-item">
                          <span className="rpt-item-title">{t.title}</span>
                          <span className="rpt-item-assignee">{t.assigneeName}</span>
                          <span className="rpt-item-date">{cd ? format(cd, 'MM.dd 완료') : ''}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </Block>
        </div>
      )}

      {!generated && !loading && (
        <div className="tm-loading" style={{ height: 300 }}>
          기간을 설정하고 "리포트 생성" 버튼을 눌러주세요.
        </div>
      )}
    </div>
  );
}
