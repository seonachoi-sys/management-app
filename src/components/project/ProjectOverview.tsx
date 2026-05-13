import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import * as XLSX from 'xlsx';
import { ChevronDown, ChevronUp, Search, Pencil, Check, X as XIcon, CheckCircle, XCircle, Plus } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { useProjects } from '../../hooks/useProjects';
import { useEmployees } from '../../hooks/useEmployees';
import { updateProject, deleteProject } from '../../services/projectService';
import { logAction } from '../../services/auditService';
import { subscribeYearlyParticipations } from '../../services/yearlyParticipationService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Project, ProjectYear, YearlyParticipation } from '../../types/project';
import { runValidation } from './ParticipationManager';
import BudgetTab from './BudgetTab';
import AddProjectModal from './AddProjectModal';
import { useToast } from '../common/Toast';
import './ProjectOverview.css';

// ═══ 유틸 ═══
/** 억 단위 (KPI 카드 전용) */
function formatBillion(num: number): string {
  return (num / 100000000).toFixed(1) + '억';
}

/** 원 단위 — 천단위 콤마 + "원" */
function formatWon(num: number): string {
  return num.toLocaleString() + '원';
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function getCurrentYear(project: Project): { year: ProjectYear; index: number } | null {
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < project.years.length; i++) {
    const y = project.years[i];
    if (today >= y.start && today <= y.end) return { year: y, index: i };
  }
  return null;
}

function getDaysRemaining(endDate: string): number {
  return daysBetween(new Date().toISOString().slice(0, 10), endDate);
}

function getProjectBudgets(p: Project) {
  // 1순위: totalBudget (종료 과제 + 신규 과제)
  const tb = (p as any).totalBudget;
  if (tb && (tb.government || tb.total)) {
    return {
      gov: tb.government || 0,
      cash: tb.privateCash || 0,
      inKind: tb.privateInKind || 0,
      total: tb.total || 0,
    };
  }
  // 2순위: years[].budget 합산 (진행 과제)
  const years = p.years || [];
  if (years.length > 0) {
    return {
      gov: years.reduce((s, y) => s + (y.budget?.government || 0), 0),
      cash: years.reduce((s, y) => s + (y.budget?.privateCash || 0), 0),
      inKind: years.reduce((s, y) => s + (y.budget?.privateInKind || 0), 0),
      total: years.reduce((s, y) => s + (y.budget?.total || 0), 0),
    };
  }
  // 3순위: 프로젝트 루트 budget 필드
  const b = (p as any).budget;
  if (b) {
    return {
      gov: b.government || 0,
      cash: b.privateCash || 0,
      inKind: b.privateInKind || 0,
      total: b.total || 0,
    };
  }
  return { gov: 0, cash: 0, inKind: 0, total: 0 };
}

// ═══ 상단 카드 (3개) ═══
function SummaryCards({ activeCount, totalGovBudget, rndGov, supportGov, violationCount, laborCost }: {
  activeCount: number; totalGovBudget: number; rndGov: number; supportGov: number; violationCount: number;
  laborCost: { total: number; cash: number; inKind: number; hasData: boolean };
}) {
  return (
    <div className="po-summary-cards four">
      <div className="po-summary-card card">
        <div className="po-summary-label">진행중 과제</div>
        <div className="po-summary-value" style={{ color: 'var(--accent)' }}>{activeCount}개</div>
      </div>
      <div className="po-summary-card card">
        <div className="po-summary-label">누적 수주금액</div>
        <div className="po-summary-value" style={{ color: 'var(--success)' }}>{formatBillion(totalGovBudget)}</div>
        <div className="po-summary-sub">R&D {formatBillion(rndGov)} · 지원사업 {formatBillion(supportGov)} <span className="po-summary-note">(기업부담금 제외)</span></div>
      </div>
      <div className="po-summary-card card">
        <div className="po-summary-label">이번 달 인건비</div>
        {laborCost.hasData ? (
          <>
            <div className="po-summary-value" style={{ color: 'var(--text-primary)' }}>{formatBillion(laborCost.total)}</div>
            <div className="po-summary-sub">현금 {formatWon(laborCost.cash)} · 현물 {formatWon(laborCost.inKind)}</div>
          </>
        ) : (
          <div className="po-summary-value" style={{ color: 'var(--text-hint)', fontSize: 16 }}>데이터 없음</div>
        )}
      </div>
      <div className="po-summary-card card">
        <div className="po-summary-label">참여율 위반</div>
        <div className="po-summary-value" style={{ color: violationCount > 0 ? 'var(--danger)' : 'var(--text-hint)' }}>
          {violationCount}건
        </div>
      </div>
    </div>
  );
}

// ═══ 인건비증빙 업로드 상태 바 ═══
function PayrollStatusBar({ uploadFlags }: { uploadFlags: { payroll: boolean; health: boolean; employment: boolean; accident: boolean } }) {
  const navigate = useNavigate();
  const now = new Date();
  const label = `${now.getFullYear()}년 ${now.getMonth() + 1}월 인건비증빙`;
  const items = [
    { key: 'payroll', label: '급여대장', done: uploadFlags.payroll },
    { key: 'health', label: '건강보험', done: uploadFlags.health },
    { key: 'employment', label: '고용보험', done: uploadFlags.employment },
    { key: 'accident', label: '산재보험', done: uploadFlags.accident },
  ];
  return (
    <div className="po-payroll-bar" onClick={() => navigate('/project/payroll')} title="인건비증빙으로 이동">
      <span className="po-payroll-label">{label}</span>
      <div className="po-payroll-items">
        {items.map(i => (
          <span key={i.key} className={`po-payroll-item ${i.done ? 'done' : 'pending'}`}>
            {i.done ? <CheckCircle size={13} /> : <XCircle size={13} />} {i.label}
          </span>
        ))}
      </div>
      <span className="po-payroll-go">→</span>
    </div>
  );
}

// ═══ 유틸: 연차가 정기(1/1~12/31)인지 판단 ═══
function isIrregularYear(y: ProjectYear): boolean {
  if (!y.start || !y.end) return false;
  const startMonth = y.start.slice(5, 7); // "01"~"12"
  const endMonth = y.end.slice(5, 7);
  return !(startMonth === '01' && endMonth === '12');
}

// ═══ 타임라인 바 ═══
function TimelineBar({ project }: { project: Project }) {
  const totalStart = project.period.totalStart;
  const totalEnd = project.period.totalEnd;
  const totalDays = daysBetween(totalStart, totalEnd);
  if (totalDays <= 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const todayOffset = Math.max(0, Math.min(100, (daysBetween(totalStart, today) / totalDays) * 100));
  const colors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B'];

  return (
    <div className="po-timeline">
      <div className="po-timeline-bar">
        {project.years.map((y, i) => {
          const left = (daysBetween(totalStart, y.start) / totalDays) * 100;
          const width = (daysBetween(y.start, y.end) / totalDays) * 100;
          const irregular = isIrregularYear(y);
          return (
            <div
              key={i}
              className={`po-timeline-segment ${irregular ? 'irregular' : ''}`}
              style={{ left: `${left}%`, width: `${width}%`, background: colors[i % colors.length] }}
              title={`${y.yearNumber}차: ${y.start} ~ ${y.end}${irregular ? ' (비정기)' : ''}`}
            >
              <span className="po-timeline-segment-label">
                {irregular ? '⚠ ' : ''}{y.yearNumber}차
              </span>
            </div>
          );
        })}
        <div className="po-timeline-today" style={{ left: `${todayOffset}%` }} title="오늘" />
      </div>
      <div className="po-timeline-dates">
        <span>{totalStart.slice(2)}</span>
        <span>{totalEnd.slice(2)}</span>
      </div>
    </div>
  );
}

// ═══ 과제 상세 패널 (아코디언) ═══
// ═══ 이지바로 과제번호 인라인 편집 ═══
function RcmsNumberField({ project }: { project: Project }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const val = project.rcmsProjectNumber || '';

  const startEdit = () => { setInput(val); setEditing(true); };
  const cancel = () => setEditing(false);
  const save = async () => {
    if (input.trim() !== val) {
      await updateProject(project.projectId, { rcmsProjectNumber: input.trim() } as any);
    }
    setEditing(false);
  };

  return (
    <div className="po-detail-item">
      <span className="po-detail-label">이지바로 과제번호</span>
      {editing ? (
        <span className="po-detail-value" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
            autoFocus style={{ width: 180, height: 28, padding: '0 8px', border: '1px solid var(--accent)',
              borderRadius: 4, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
          <button onClick={save} style={{ background: 'var(--success)', color: '#fff', border: 'none',
            borderRadius: 4, width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Check size={14} /></button>
          <button onClick={cancel} style={{ background: 'var(--bg-main)', color: 'var(--text-hint)', border: 'none',
            borderRadius: 4, width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <XIcon size={14} /></button>
        </span>
      ) : (
        <span className="po-detail-value po-rcms-field" onClick={startEdit} style={{ cursor: 'pointer' }}>
          {val || <span style={{ color: 'var(--text-hint)' }}>클릭하여 입력</span>}
          <Pencil size={11} style={{ color: 'var(--text-hint)', marginLeft: 6 }} />
        </span>
      )}
    </div>
  );
}

// ═══ 현금/현물 배분 헬퍼 (연차별 예산 비율 기반) ═══
function getCashInKindSplit(project: Project, total: number) {
  const cur = getCurrentYear(project);
  if (!cur) return { cash: 0, inKind: total };
  const budget = cur.year.budget;
  const cashBudget = budget.privateCash || 0;
  const inkindBudget = budget.privateInKind || 0;
  const budgetTotal = cashBudget + inkindBudget;
  if (budgetTotal === 0) return { cash: 0, inKind: total };
  const cash = Math.round(total * cashBudget / budgetTotal);
  return { cash, inKind: total - cash };
}

function ProjectDetail({ project, onEdit, onDelete }: { project: Project; onEdit?: () => void; onDelete?: () => void }) {
  const b = getProjectBudgets(project);

  return (
    <div className="po-detail">
      <div className="po-detail-grid">
        <div className="po-detail-item">
          <span className="po-detail-label">사업명</span>
          <span className="po-detail-value">{project.programName}</span>
        </div>
        <div className="po-detail-item full">
          <span className="po-detail-label">과제명</span>
          <span className="po-detail-value">{project.projectName}</span>
        </div>
        <div className="po-detail-item">
          <span className="po-detail-label">전문기관/부처</span>
          <span className="po-detail-value">{project.agency}</span>
        </div>
        <div className="po-detail-item">
          <span className="po-detail-label">주관기관</span>
          <span className="po-detail-value">{project.hostOrg}</span>
        </div>
        <div className="po-detail-item">
          <span className="po-detail-label">과제번호</span>
          <span className="po-detail-value">{(project as any).projectNumber || '-'}</span>
        </div>
        <RcmsNumberField project={project} />
        <div className="po-detail-item">
          <span className="po-detail-label">연구책임자</span>
          <span className="po-detail-value">{project.pi} ({project.piRole})</span>
        </div>
        <div className="po-detail-item">
          <span className="po-detail-label">참여형태</span>
          <span className="po-detail-value">{project.participationType}</span>
        </div>
        <div className="po-detail-item">
          <span className="po-detail-label">전체 사업기간</span>
          <span className="po-detail-value">{project.period.totalStart} ~ {project.period.totalEnd}</span>
        </div>
        <div className="po-detail-item">
          <span className="po-detail-label">담당자</span>
          <span className="po-detail-value">{project.contact?.manager || '-'}</span>
        </div>
        <div className="po-detail-item">
          <span className="po-detail-label">연락처</span>
          <span className="po-detail-value">{project.contact?.phone || '-'}</span>
        </div>
        {project.contact?.email && (
          <div className="po-detail-item">
            <span className="po-detail-label">이메일</span>
            <span className="po-detail-value">{project.contact.email}</span>
          </div>
        )}
      </div>

      {/* 연차별 예산 테이블 */}
      <div className="po-detail-table-wrap">
        <table className="table po-detail-table">
          <thead>
            <tr>
              <th>연차</th>
              <th>사업기간</th>
              <th style={{ textAlign: 'right' }}>정부출연금</th>
              <th style={{ textAlign: 'right' }}>기업부담금(현금)</th>
              <th style={{ textAlign: 'right' }}>기업부담금(현물)</th>
              <th style={{ textAlign: 'right' }}>총사업비</th>
            </tr>
          </thead>
          <tbody>
            {project.years.map((y, i) => (
              <tr key={i}>
                <td>{y.yearNumber}차</td>
                <td className="po-nowrap">{y.start} ~ {y.end}</td>
                <td className="money">{formatWon(y.budget.government)}</td>
                <td className="money">{formatWon(y.budget.privateCash)}</td>
                <td className="money">{formatWon(y.budget.privateInKind)}</td>
                <td className="money">{formatWon(y.budget.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}><strong>합계</strong></td>
              <td className="money"><strong>{formatWon(b.gov)}</strong></td>
              <td className="money"><strong>{formatWon(b.cash)}</strong></td>
              <td className="money"><strong>{formatWon(b.inKind)}</strong></td>
              <td className="money"><strong>{formatWon(b.total)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 수정 / 삭제 버튼 */}
      {(onEdit || onDelete) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, padding: '0 4px' }}>
          {onEdit && (
            <button type="button" onClick={onEdit} style={{
              padding: '6px 14px', background: '#F3F4F6', color: '#374151',
              border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
            }}>과제 정보 수정</button>
          )}
          {onDelete && (
            <button type="button" onClick={onDelete} style={{
              padding: '6px 14px', background: '#FEF2F2', color: '#DC2626',
              border: '1px solid #FECACA', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
            }}>과제 삭제</button>
          )}
        </div>
      )}
    </div>
  );
}

// ═══ 진행중 과제 카드 (아코디언) ═══
function ActiveProjectCard({ project, expanded, onToggle, onEdit, onDelete }: {
  project: Project;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const b = getProjectBudgets(project);

  return (
    <div className={`po-project-card card ${expanded ? 'expanded' : ''}`}>
      <div className="po-project-header" onClick={onToggle}>
        <div className="po-project-left">
          <div className="po-project-shortname">{project.shortName}</div>
          <div className="po-project-meta">
            <span>{project.pi}</span>
            <span className={`po-project-type ${project.participationType === '주관' ? 'primary' : 'secondary'}`}>
              {project.participationType}
            </span>
          </div>
        </div>
        <div className="po-project-center">
          <TimelineBar project={project} />
          <div className="po-project-budgets">
            <div className="po-project-budget">
              <span className="po-budget-label">정부출연금</span>
              <span className="po-budget-value money">{formatWon(b.gov)}</span>
            </div>
            <div className="po-project-budget">
              <span className="po-budget-label">총사업비</span>
              <span className="po-budget-value money">{formatWon(b.total)}</span>
            </div>
          </div>
        </div>
        <div className="po-expand-icon">
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </div>
      {expanded && <ProjectDetail project={project} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  );
}

// ═══ 이 달의 연차 ═══
function CurrentYearCard({ activeProjects }: { activeProjects: Project[] }) {
  return (
    <div className="po-current-year card">
      <h3 className="po-section-title">이 달의 연차</h3>
      <div className="po-year-grid">
        {activeProjects.map((p) => {
          const cur = getCurrentYear(p);
          const daysLeft = cur ? getDaysRemaining(cur.year.end) : -1;
          const irregular = cur ? isIrregularYear(cur.year) : false;
          return (
            <div key={p.projectId} className="po-year-item">
              <div className="po-year-name">{p.shortName}</div>
              {cur ? (
                <>
                  <div className="po-year-number">
                    {cur.year.yearNumber}차년도
                    {irregular && <span className="po-year-irregular" title="비정기 연차"> ⚠</span>}
                  </div>
                  <div className="po-year-period">{cur.year.start.slice(5)} ~ {cur.year.end.slice(5)}</div>
                  {daysLeft <= 30 && daysLeft >= 0 && <span className="badge badge-warning">D-{daysLeft}</span>}
                  {daysLeft < 0 && <span className="badge badge-danger">연차 종료됨</span>}
                  {daysLeft > 30 && <span className="po-year-remaining">잔여 {daysLeft}일</span>}
                </>
              ) : (
                <div className="po-year-number" style={{ color: 'var(--text-hint)' }}>해당 연차 없음</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══ 종료 과제 테이블 ═══
function ClosedProjectsTable({ projects }: { projects: Project[] }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    debounceRef.current = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(p =>
      (p.shortName || '').toLowerCase().includes(q) ||
      (p.projectName || '').toLowerCase().includes(q) ||
      (p.programName || '').toLowerCase().includes(q) ||
      (p.pi || '').toLowerCase().includes(q)
    );
  }, [projects, search]);

  const totals = useMemo(() => {
    return filtered.reduce((acc, p) => {
      const b = getProjectBudgets(p);
      return {
        gov: acc.gov + b.gov,
        private: acc.private + b.cash + b.inKind,
        total: acc.total + b.total,
      };
    }, { gov: 0, private: 0, total: 0 });
  }, [filtered]);

  const downloadExcel = useCallback(() => {
    const rows = filtered.map((p, i) => {
      const b = getProjectBudgets(p);
      return {
        'No': i + 1,
        '사업명': p.programName || p.shortName || '',
        '과제명': p.projectName || '-',
        '부처/전문기관': p.agency || '-',
        '연구책임자': p.pi || '-',
        '사업기간(시작)': p.period.totalStart || '',
        '사업기간(종료)': p.period.totalEnd || '',
        '정부출연금': b.gov,
        '기업부담금': b.cash + b.inKind,
        '총사업비': b.total,
      };
    });

    // 합계 행
    rows.push({
      'No': 0,
      '사업명': `합계 (${filtered.length}건)`,
      '과제명': '',
      '부처/전문기관': '',
      '연구책임자': '',
      '사업기간(시작)': '',
      '사업기간(종료)': '',
      '정부출연금': totals.gov,
      '기업부담금': totals.private,
      '총사업비': totals.total,
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    // 금액 컬럼 너비 설정
    ws['!cols'] = [
      { wch: 4 }, { wch: 30 }, { wch: 40 }, { wch: 25 }, { wch: 10 },
      { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 18 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '종료과제');
    XLSX.writeFile(wb, `종료과제현황_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [filtered, totals]);

  return (
    <div className="po-closed">
      <div className="po-closed-toolbar">
        <div className="po-search-wrap">
          <Search size={15} className="po-search-icon" />
          <input
            className="input po-closed-search"
            placeholder="과제명, 사업명, 책임자 검색..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <span className="po-closed-count">{filtered.length}건</span>
        <button className="btn-secondary po-excel-btn" onClick={downloadExcel}>
          엑셀 다운로드
        </button>
      </div>
      <div className="po-closed-scroll">
        <table className="table po-closed-table">
          <thead>
            <tr>
              <th className="po-sticky-col">No</th>
              <th className="po-sticky-col2">사업명</th>
              <th>과제명</th>
              <th>부처/전문기관</th>
              <th>연구책임자</th>
              <th>사업기간</th>
              <th style={{ textAlign: 'right' }}>정부출연금</th>
              <th style={{ textAlign: 'right' }}>기업부담금</th>
              <th style={{ textAlign: 'right' }}>총사업비</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => {
              const b = getProjectBudgets(p);
              const privateBurden = b.cash + b.inKind;
              return (
                <tr key={p.projectId}>
                  <td className="po-sticky-col">{i + 1}</td>
                  <td className="po-sticky-col2" title={p.programName}>{p.shortName || p.programName?.slice(0, 20)}</td>
                  <td className="po-closed-projname" title={p.projectName}>{p.projectName?.slice(0, 40) || '-'}</td>
                  <td className="po-nowrap">{p.agency?.slice(0, 20) || '-'}</td>
                  <td className="po-nowrap">{p.pi || '-'}</td>
                  <td className="po-nowrap">
                    {p.period.totalStart ? p.period.totalStart.slice(0, 7) : '?'} ~ {p.period.totalEnd ? p.period.totalEnd.slice(0, 7) : '?'}
                  </td>
                  <td className="money">{formatWon(b.gov)}</td>
                  <td className="money">{formatWon(privateBurden)}</td>
                  <td className="money">{formatWon(b.total)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="po-sticky-col" />
              <td className="po-sticky-col2"><strong>합계 ({filtered.length}건)</strong></td>
              <td colSpan={4} />
              <td className="money"><strong>{formatWon(totals.gov)}</strong></td>
              <td className="money"><strong>{formatWon(totals.private)}</strong></td>
              <td className="money"><strong>{formatWon(totals.total)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ═══ 스켈레톤 ═══
function Skeleton() {
  return (
    <div className="po-skeleton">
      <div className="po-summary-cards three">
        {[1, 2, 3].map(i => <div key={i} className="po-skeleton-card shimmer" />)}
      </div>
      <div className="po-skeleton-block shimmer" />
      <div className="po-skeleton-block shimmer" />
    </div>
  );
}

// ═══ 메인 ═══
type TabId = 'active' | 'closed' | 'budget';

const ProjectOverview: React.FC = () => {
  const navigate = useNavigate();
  const { projects, activeProjects, closedProjects, loading, error } = useProjects();
  const { employees } = useEmployees();
  const [activeTab, setActiveTab] = useState<TabId>('active');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [partData, setPartData] = useState<YearlyParticipation[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { addToast } = useToast();

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteProject(deleteTarget.projectId);
      await logAction('delete', 'projects', deleteTarget.projectId, 'project', deleteTarget.projectName, null, 'admin');
      addToast('과제가 삭제되었습니다', 'success');
      setDeleteTarget(null);
      setExpandedId(null);
    } catch (err: any) {
      console.error('과제 삭제 실패:', err);
      addToast('과제 삭제에 실패했습니다', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // 참여율 구독 (현재 연도, 현재 월 기준 검증)
  useEffect(() => {
    const year = new Date().getFullYear();
    const unsub = subscribeYearlyParticipations(year, setPartData, () => {});
    return unsub;
  }, []);

  const violationCount = useMemo(() => {
    if (partData.length === 0) return 0;
    const month = new Date().getMonth() + 1;
    return runValidation(partData, activeProjects, employees, month).totalViolations;
  }, [partData, activeProjects, employees]);

  // 이번 달 인건비 계산
  const [laborCost, setLaborCost] = useState({ total: 0, cash: 0, inKind: 0, hasData: false });
  const [uploadFlags, setUploadFlags] = useState({ payroll: false, health: false, employment: false, accident: false });
  useEffect(() => {
    const calcLabor = async () => {
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const month = now.getMonth() + 1;

      if (partData.length === 0 || employees.length === 0) return;

      let totalCash = 0, totalInKind = 0;
      for (const proj of activeProjects) {
        const projParts = partData.filter(p => p.projectId === proj.projectId);
        for (const part of projParts) {
          const rate = part.monthlyRates[String(month)] || 0;
          if (rate === 0) continue;
          const emp = employees.find(e => e.name === part.employeeName);
          if (!emp) continue;
          const salary = (emp.salary?.basePay || 0) + (emp.salary?.mealAllowance || 0)
            + (emp.salary?.vehicleAllowance || 0) + (emp.salary?.researchAllowance || 0)
            + (emp.salary?.childcareAllowance || 0);
          const ins = emp.insurance?.totalCompanyBurden || 0;
          const ret = 0; // 퇴직금 추계 미반영
          const cost = salary + ret + ins;
          const total = Math.round(cost * rate / 100);
          const split = getCashInKindSplit(proj, total);
          totalCash += split.cash;
          totalInKind += split.inKind;
        }
      }
      setLaborCost({ total: totalCash + totalInKind, cash: totalCash, inKind: totalInKind, hasData: totalCash + totalInKind > 0 });
    };
    calcLabor();
  }, [partData, activeProjects, employees]);

  // 업로드 상태 조회
  useEffect(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    getDoc(doc(db, 'monthlyData', ym)).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        setUploadFlags({
          payroll: !!d.payrollUploadDate,
          health: !!d.healthInsuranceUploadDate,
          employment: !!d.employmentInsuranceUploadDate,
          accident: !!d.industrialAccidentUploadDate,
        });
      }
    });
  }, []);

  const { totalGovBudget, rndGov, supportGov } = useMemo(() => {
    let total = 0, rnd = 0, support = 0;
    for (const p of projects) {
      const budgets = getProjectBudgets(p);
      const gov = budgets.gov;
      const hasTotalBudget = !!(p as any).totalBudget;
      const hasYears = (p.years || []).length > 0;
      console.log(`[KPI-상세] ${p.shortName || p.projectName}: gov=${(gov/1e8).toFixed(2)}억, cat="${p.category || (p as any).programName || ''}", totalBudget=${hasTotalBudget}, years=${hasYears}(${(p.years||[]).length}개)`);
      total += gov;
      // 카테고리 판별: category가 있으면 category 사용, 없으면 programName 폴백
      const catSrc = (p.category || (p as any).programName || '').toLowerCase();
      if (catSrc.includes('r&d')) rnd += gov;
      else support += gov;
    }
    console.log(`[KPI] 과제 ${projects.length}개, 총 수주: ${(total/1e8).toFixed(1)}억 (R&D ${(rnd/1e8).toFixed(1)}억 / 지원 ${(support/1e8).toFixed(1)}억)`);
    return { totalGovBudget: total, rndGov: rnd, supportGov: support };
  }, [projects]);

  if (loading) return <Skeleton />;
  if (error) return <div className="po-error">데이터를 불러오지 못했습니다: {error}</div>;

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'active', label: '진행중', count: activeProjects.length },
    { id: 'closed', label: '종료', count: closedProjects.length },
    { id: 'budget', label: '예산관리' },
  ];

  return (
    <div className="po-container">
      <SummaryCards activeCount={activeProjects.length} totalGovBudget={totalGovBudget} rndGov={rndGov} supportGov={supportGov} violationCount={violationCount} laborCost={laborCost} />

      <PayrollStatusBar uploadFlags={uploadFlags} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button
          type="button"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', background: '#3B82F6', color: '#fff',
            border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
            cursor: 'pointer',
          }}
          onClick={() => setShowAddModal(true)}
        >
          <Plus size={16} /> 신규 과제 추가
        </button>
      </div>

      <div className="po-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`po-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
            {t.count !== undefined && <span className="po-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {activeTab === 'active' && (
        <div className="po-active-content">
          <div className="po-project-list">
            {activeProjects.map((p) => (
              <ActiveProjectCard
                key={p.projectId}
                project={p}
                expanded={expandedId === p.projectId}
                onToggle={() => setExpandedId(expandedId === p.projectId ? null : p.projectId)}
                onEdit={() => setEditingProject(p)}
                onDelete={() => setDeleteTarget(p)}
              />
            ))}
          </div>
          <CurrentYearCard activeProjects={activeProjects} />
        </div>
      )}

      {activeTab === 'closed' && <ClosedProjectsTable projects={closedProjects} />}

      {activeTab === 'budget' && (
        <BudgetTab activeProjects={activeProjects} />
      )}

      <AddProjectModal open={showAddModal} onClose={() => setShowAddModal(false)} />

      <AddProjectModal
        open={!!editingProject}
        onClose={() => setEditingProject(null)}
        editProject={editingProject}
      />

      {/* 삭제 확인 모달 */}
      {deleteTarget && ReactDOM.createPortal(
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
        }} onClick={() => !deleting && setDeleteTarget(null)}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: 28, maxWidth: 420, width: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: '#111827' }}>과제 삭제</h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: '#4B5563', lineHeight: 1.6 }}>
              '{deleteTarget.projectName}'을 정말 삭제하시겠습니까?<br />
              이 작업은 되돌릴 수 없습니다.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)} style={{
                padding: '8px 18px', background: '#F3F4F6', color: '#374151',
                border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>취소</button>
              <button type="button" disabled={deleting} onClick={handleDeleteConfirm} style={{
                padding: '8px 18px', background: deleting ? '#FCA5A5' : '#DC2626', color: '#fff',
                border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>{deleting ? '삭제 중...' : '삭제'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ProjectOverview;
