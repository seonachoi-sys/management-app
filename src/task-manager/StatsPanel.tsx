import React, { useState, useEffect, useMemo } from 'react';
import { Timestamp } from 'firebase/firestore';
import {
  format,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  endOfYear,
  startOfDay,
  endOfDay,
  parseISO,
} from 'date-fns';
import type { Task, TaskHistory } from '../types';
import { fetchAllTasks, fetchAllTaskHistory } from '../services/taskService';

type RangeKey = 'all' | 'this_month' | 'last_3_months' | 'this_year' | 'custom';

function tsToDate(ts: Timestamp | null | undefined): Date | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  if (typeof ts === 'object' && ts !== null && 'seconds' in (ts as any)) {
    return new Date((ts as any).seconds * 1000);
  }
  return null;
}

function rangeFor(key: RangeKey, customStart: string, customEnd: string): { start: Date | null; end: Date | null; label: string } {
  const today = new Date();
  switch (key) {
    case 'this_month':
      return { start: startOfMonth(today), end: endOfMonth(today), label: format(today, 'yyyy년 M월') };
    case 'last_3_months':
      return { start: startOfMonth(subMonths(today, 2)), end: endOfMonth(today), label: '최근 3개월' };
    case 'this_year':
      return { start: startOfYear(today), end: endOfYear(today), label: format(today, 'yyyy년') };
    case 'custom':
      return {
        start: customStart ? startOfDay(parseISO(customStart)) : null,
        end: customEnd ? endOfDay(parseISO(customEnd)) : null,
        label: `${customStart || '?'} ~ ${customEnd || '?'}`,
      };
    case 'all':
    default:
      return { start: null, end: null, label: '전체 기간' };
  }
}

export default function StatsPanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [history, setHistory] = useState<TaskHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rangeKey, setRangeKey] = useState<RangeKey>('last_3_months');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [t, h] = await Promise.all([fetchAllTasks(), fetchAllTaskHistory()]);
        if (cancelled) return;
        setTasks(t);
        setHistory(h);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '데이터 로딩 실패');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const range = useMemo(
    () => rangeFor(rangeKey, customStart, customEnd),
    [rangeKey, customStart, customEnd],
  );

  // 기간 필터링: task의 createdAt 또는 completedDate가 범위에 들어가면 포함 (하위업무만)
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (!t.parentTaskId) return false; // 상위업무 제외 (실제 작업은 하위)
      if (assigneeFilter && t.assigneeName !== assigneeFilter) return false;
      if (!range.start && !range.end) return true;

      const created = tsToDate(t.createdAt);
      const completed = tsToDate(t.completedDate);
      const due = tsToDate(t.dueDate);
      const refDate = completed || due || created;
      if (!refDate) return true;

      if (range.start && refDate < range.start) return false;
      if (range.end && refDate > range.end) return false;
      return true;
    });
  }, [tasks, range, assigneeFilter]);

  // 담당자 목록 (실제 데이터에서 추출)
  const assignees = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => {
      if (t.parentTaskId && t.assigneeName) set.add(t.assigneeName);
    });
    return Array.from(set).sort();
  }, [tasks]);

  // 카테고리 목록 (실제 데이터에서 추출)
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    filteredTasks.forEach((t) => set.add(t.category || '기타'));
    return Array.from(set).sort();
  }, [filteredTasks]);

  // ─── 지표 1: 담당자별 종합 ───
  const assigneeStats = useMemo(() => {
    const map: Record<string, {
      total: number;
      done: number;
      inProgress: number;
      delayed: number;
      onHold: number;
      avgLeadTime: number | null;
      onTimeRate: number; // 정시 또는 조기 완료율
    }> = {};
    const leadTimes: Record<string, number[]> = {};

    filteredTasks.forEach((t) => {
      const name = t.assigneeName || '미배정';
      if (!map[name]) {
        map[name] = { total: 0, done: 0, inProgress: 0, delayed: 0, onHold: 0, avgLeadTime: null, onTimeRate: 0 };
        leadTimes[name] = [];
      }
      map[name].total++;
      if (t.status === '완료') map[name].done++;
      else if (t.status === '진행중') map[name].inProgress++;
      else if (t.status === '지연') map[name].delayed++;
      else if (t.status === '보류') map[name].onHold++;

      if (typeof t.leadTimeDays === 'number') {
        leadTimes[name].push(t.leadTimeDays);
      }
    });

    Object.keys(map).forEach((name) => {
      const lts = leadTimes[name];
      if (lts.length > 0) {
        const sum = lts.reduce((a, b) => a + b, 0);
        map[name].avgLeadTime = Math.round((sum / lts.length) * 10) / 10;
        const onTime = lts.filter((v) => v >= 0).length;
        map[name].onTimeRate = Math.round((onTime / lts.length) * 100);
      }
    });

    return Object.entries(map)
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.total - a.total);
  }, [filteredTasks]);

  // ─── 지표 2: 담당자 × 카테고리 매트릭스 (완료율) ───
  const assigneeCategoryMatrix = useMemo(() => {
    const matrix: Record<string, Record<string, { total: number; done: number; delayed: number }>> = {};
    filteredTasks.forEach((t) => {
      const name = t.assigneeName || '미배정';
      const cat = t.category || '기타';
      if (!matrix[name]) matrix[name] = {};
      if (!matrix[name][cat]) matrix[name][cat] = { total: 0, done: 0, delayed: 0 };
      matrix[name][cat].total++;
      if (t.status === '완료') matrix[name][cat].done++;
      if (t.status === '지연') matrix[name][cat].delayed++;
    });
    return matrix;
  }, [filteredTasks]);

  // ─── 지표 3: 재오픈된 업무 (taskHistory의 status 변경 분석) ───
  const reopenedTasks = useMemo(() => {
    // historyId별로 task의 status 변화 추적 — 완료 → 다른 상태로 바뀐 횟수 카운트
    const reopenCount: Record<string, number> = {}; // taskId → count
    history.forEach((h) => {
      if (h.field === 'status' && h.oldValue === '완료' && h.newValue !== '완료') {
        reopenCount[h.taskId] = (reopenCount[h.taskId] || 0) + 1;
      }
    });

    return filteredTasks
      .filter((t) => reopenCount[t.taskId])
      .map((t) => ({
        task: t,
        count: reopenCount[t.taskId],
      }))
      .sort((a, b) => b.count - a.count);
  }, [history, filteredTasks]);

  // ─── 지표 4: 마감일 변경이 많은 업무 ───
  const dueDateChanges = useMemo(() => {
    const changeCount: Record<string, number> = {};
    history.forEach((h) => {
      if (h.field === 'dueDate' && h.oldValue && h.newValue) {
        changeCount[h.taskId] = (changeCount[h.taskId] || 0) + 1;
      }
    });

    return filteredTasks
      .filter((t) => (changeCount[t.taskId] || 0) >= 2)
      .map((t) => ({
        task: t,
        count: changeCount[t.taskId] || 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [history, filteredTasks]);

  // ─── 지표 5: 진행 중 업무 동시 부하 (현재 시점, 담당자별) ───
  const activeWorkload = useMemo(() => {
    const map: Record<string, { active: number; pending: number; delayed: number; total: number }> = {};
    tasks.forEach((t) => {
      if (!t.parentTaskId) return;
      if (assigneeFilter && t.assigneeName !== assigneeFilter) return;
      const name = t.assigneeName || '미배정';
      if (!map[name]) map[name] = { active: 0, pending: 0, delayed: 0, total: 0 };
      if (t.status === '진행중') { map[name].active++; map[name].total++; }
      else if (t.status === '대기') { map[name].pending++; map[name].total++; }
      else if (t.status === '지연') { map[name].delayed++; map[name].total++; }
    });
    return Object.entries(map)
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.total - a.total);
  }, [tasks, assigneeFilter]);

  // ─── 비효율 인사이트 (요약) ───
  const insights = useMemo(() => {
    const lines: string[] = [];

    // 1. 가장 많이 지연되는 담당자
    const worstDelayer = [...assigneeStats]
      .filter((a) => a.total >= 3)
      .sort((a, b) => (b.delayed / b.total) - (a.delayed / a.total))[0];
    if (worstDelayer && worstDelayer.delayed > 0) {
      const rate = Math.round((worstDelayer.delayed / worstDelayer.total) * 100);
      if (rate >= 20) lines.push(`📌 ${worstDelayer.name}: 지연 비율 ${rate}% (${worstDelayer.delayed}/${worstDelayer.total}건)`);
    }

    // 2. 평균 리드타임이 음수(지연 완료) 큰 담당자
    const worstLead = [...assigneeStats]
      .filter((a) => a.avgLeadTime !== null && a.avgLeadTime < -2)
      .sort((a, b) => (a.avgLeadTime ?? 0) - (b.avgLeadTime ?? 0))[0];
    if (worstLead) {
      lines.push(`📌 ${worstLead.name}: 평균 ${Math.abs(worstLead.avgLeadTime!)}일 지연 완료`);
    }

    // 3. 재오픈 많은 업무
    if (reopenedTasks.length > 0) {
      const top = reopenedTasks[0];
      lines.push(`📌 "${top.task.title}" 업무가 ${top.count}회 재오픈됨 (${top.task.assigneeName})`);
    }

    // 4. 마감 변경 많은 업무
    if (dueDateChanges.length > 0) {
      const top = dueDateChanges[0];
      lines.push(`📌 "${top.task.title}" 마감일 ${top.count}회 변경 (${top.task.assigneeName})`);
    }

    // 5. 과부하 담당자 (현재 진행+대기 5건 이상)
    const overloaded = activeWorkload.filter((a) => a.active + a.pending >= 5);
    overloaded.forEach((a) => {
      lines.push(`📌 ${a.name}: 진행/대기 ${a.active + a.pending}건 (과부하 의심)`);
    });

    return lines;
  }, [assigneeStats, reopenedTasks, dueDateChanges, activeWorkload]);

  if (loading) {
    return <div className="tm-stats-view"><div className="tm-loading">통계 데이터를 불러오는 중...</div></div>;
  }
  if (error) {
    return <div className="tm-stats-view"><div className="tm-error">{error}</div></div>;
  }

  return (
    <div className="tm-stats-view">
      {/* 필터바 */}
      <div className="tm-stats-filter">
        <div className="tm-stats-filter-group">
          <label>기간</label>
          <div className="tm-stats-range-buttons">
            {[
              { key: 'this_month', label: '이번 달' },
              { key: 'last_3_months', label: '최근 3개월' },
              { key: 'this_year', label: '올해' },
              { key: 'all', label: '전체' },
              { key: 'custom', label: '직접' },
            ].map((opt) => (
              <button
                key={opt.key}
                className={rangeKey === opt.key ? 'active' : ''}
                onClick={() => setRangeKey(opt.key as RangeKey)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {rangeKey === 'custom' && (
            <div className="tm-stats-custom-range">
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              <span>~</span>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            </div>
          )}
        </div>

        <div className="tm-stats-filter-group">
          <label>담당자</label>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
            <option value="">전체</option>
            {assignees.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        <div className="tm-stats-filter-meta">
          {range.label} · 분석 대상 {filteredTasks.length}건
          <button className="tm-stats-print-btn" onClick={() => window.print()}>🖨 인쇄</button>
        </div>
      </div>

      {/* 인사이트 요약 */}
      {insights.length > 0 && (
        <section className="tm-stats-section tm-stats-insights">
          <h3>⚠️ 비효율 발생 지점</h3>
          <ul>
            {insights.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </section>
      )}

      {/* 1. 담당자별 종합 */}
      <section className="tm-stats-section">
        <h3>1. 담당자별 종합</h3>
        {assigneeStats.length === 0 ? (
          <div className="rpt-empty">데이터 없음</div>
        ) : (
          <table className="tm-stats-table">
            <thead>
              <tr>
                <th>담당자</th>
                <th>전체</th>
                <th>완료</th>
                <th>진행중</th>
                <th>지연</th>
                <th>보류</th>
                <th>완료율</th>
                <th>평균 리드타임</th>
                <th>정시율</th>
              </tr>
            </thead>
            <tbody>
              {assigneeStats.map((a) => {
                const completionRate = a.total > 0 ? Math.round((a.done / a.total) * 100) : 0;
                return (
                  <tr key={a.name}>
                    <td className="tm-stats-name">{a.name}</td>
                    <td>{a.total}</td>
                    <td className="tm-stats-num-good">{a.done}</td>
                    <td>{a.inProgress}</td>
                    <td className={a.delayed > 0 ? 'tm-stats-num-warn' : ''}>{a.delayed}</td>
                    <td>{a.onHold}</td>
                    <td>
                      <div className="tm-stats-bar-wrap">
                        <div className="tm-stats-bar">
                          <div className="tm-stats-bar-fill" style={{ width: `${completionRate}%` }} />
                        </div>
                        <span>{completionRate}%</span>
                      </div>
                    </td>
                    <td>
                      {a.avgLeadTime === null ? '-'
                        : a.avgLeadTime > 0 ? <span className="tm-stats-num-good">+{a.avgLeadTime}일</span>
                        : a.avgLeadTime < 0 ? <span className="tm-stats-num-warn">{a.avgLeadTime}일</span>
                        : '0일'
                      }
                    </td>
                    <td>{a.onTimeRate > 0 ? `${a.onTimeRate}%` : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="tm-stats-note">
          💡 평균 리드타임 = 마감일 - 완료일 (양수=조기 완료, 음수=지연 완료) · 정시율 = 마감일 이내 완료한 비율
        </p>
      </section>

      {/* 2. 담당자 × 카테고리 매트릭스 */}
      <section className="tm-stats-section">
        <h3>2. 담당자 × 카테고리 (완료율)</h3>
        {Object.keys(assigneeCategoryMatrix).length === 0 ? (
          <div className="rpt-empty">데이터 없음</div>
        ) : (
          <table className="tm-stats-table">
            <thead>
              <tr>
                <th>담당자</th>
                {allCategories.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {Object.entries(assigneeCategoryMatrix).map(([name, cats]) => (
                <tr key={name}>
                  <td className="tm-stats-name">{name}</td>
                  {allCategories.map((c) => {
                    const cell = cats[c];
                    if (!cell) return <td key={c} className="tm-stats-cell-empty">-</td>;
                    const rate = Math.round((cell.done / cell.total) * 100);
                    const tone = cell.delayed > 0 ? 'warn' : rate >= 80 ? 'good' : rate >= 50 ? 'mid' : 'low';
                    return (
                      <td key={c} className={`tm-stats-matrix-cell tm-stats-matrix-${tone}`}>
                        <div className="tm-stats-matrix-rate">{rate}%</div>
                        <div className="tm-stats-matrix-detail">{cell.done}/{cell.total}{cell.delayed > 0 ? ` ⚠${cell.delayed}` : ''}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 3. 현재 진행 중 부하 */}
      <section className="tm-stats-section">
        <h3>3. 현재 부하 (진행중 + 대기 + 지연)</h3>
        {activeWorkload.length === 0 ? (
          <div className="rpt-empty">진행 중인 업무 없음</div>
        ) : (
          <table className="tm-stats-table">
            <thead>
              <tr>
                <th>담당자</th>
                <th>진행중</th>
                <th>대기</th>
                <th>지연</th>
                <th>합계</th>
                <th>부하</th>
              </tr>
            </thead>
            <tbody>
              {activeWorkload.map((a) => {
                const overloaded = a.total >= 5;
                return (
                  <tr key={a.name}>
                    <td className="tm-stats-name">{a.name}</td>
                    <td>{a.active}</td>
                    <td>{a.pending}</td>
                    <td className={a.delayed > 0 ? 'tm-stats-num-warn' : ''}>{a.delayed}</td>
                    <td><strong>{a.total}</strong></td>
                    <td>
                      <div className="tm-stats-bar-wrap">
                        <div className="tm-stats-bar">
                          <div
                            className={`tm-stats-bar-fill ${overloaded ? 'tm-stats-bar-warn' : ''}`}
                            style={{ width: `${Math.min(a.total * 10, 100)}%` }}
                          />
                        </div>
                        {overloaded && <span className="tm-stats-tag-warn">과부하</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="tm-stats-note">💡 합계 5건 이상이면 과부하로 간주</p>
      </section>

      {/* 4. 재오픈 업무 */}
      <section className="tm-stats-section">
        <h3>4. 재오픈된 업무 (완료 → 다시 진행)</h3>
        {reopenedTasks.length === 0 ? (
          <div className="rpt-empty">재오픈된 업무 없음</div>
        ) : (
          <table className="tm-stats-table">
            <thead>
              <tr>
                <th>업무명</th>
                <th>담당자</th>
                <th>카테고리</th>
                <th>현재 상태</th>
                <th>재오픈 횟수</th>
              </tr>
            </thead>
            <tbody>
              {reopenedTasks.slice(0, 20).map(({ task, count }) => (
                <tr key={task.taskId}>
                  <td>{task.title}</td>
                  <td className="tm-stats-name">{task.assigneeName}</td>
                  <td>{task.category}</td>
                  <td>{task.status}</td>
                  <td><span className="tm-stats-tag-warn">{count}회</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="tm-stats-note">💡 자주 재오픈되는 업무는 요건이 불명확하거나 검토 누락 가능성이 있습니다</p>
      </section>

      {/* 5. 마감 변경이 많은 업무 */}
      <section className="tm-stats-section">
        <h3>5. 마감일 변경이 많은 업무 (2회 이상)</h3>
        {dueDateChanges.length === 0 ? (
          <div className="rpt-empty">마감일이 자주 변경된 업무 없음</div>
        ) : (
          <table className="tm-stats-table">
            <thead>
              <tr>
                <th>업무명</th>
                <th>담당자</th>
                <th>카테고리</th>
                <th>현재 마감</th>
                <th>변경 횟수</th>
              </tr>
            </thead>
            <tbody>
              {dueDateChanges.slice(0, 20).map(({ task, count }) => {
                const due = tsToDate(task.dueDate);
                return (
                  <tr key={task.taskId}>
                    <td>{task.title}</td>
                    <td className="tm-stats-name">{task.assigneeName}</td>
                    <td>{task.category}</td>
                    <td>{due ? format(due, 'yyyy.MM.dd') : '-'}</td>
                    <td><span className="tm-stats-tag-warn">{count}회</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="tm-stats-note">💡 마감이 반복적으로 미뤄지는 업무는 일정 산정 정확도 점검 필요</p>
      </section>
    </div>
  );
}
