import React, { useState, useCallback, useRef } from 'react';
import { Upload, X, AlertTriangle, CheckCircle } from 'lucide-react';
import { Project } from '../../types/project';
import { updateBudgetDetail } from '../../services/budgetService';
import { logAction } from '../../services/auditService';
import { useAuth } from '../../hooks/useAuth';
import { isActiveProject } from '../../hooks/useProjects';
import {
  parseRcmsFile, filterValidRows, aggregateAndMatch,
  getDateRange, extractProjectNumbers, detectYear,
  applyToBudgetDetail, RcmsRow, RcmsAggItem, RcmsParsed, ITEM_MATCH,
} from '../../services/rcmsService';
import './RcmsUploadModal.css';

type Step = 1 | 2 | 3 | 4;

function formatWon(n: number): string { return n.toLocaleString() + '원'; }

interface Props {
  projects: Project[];
  onClose: () => void;
  onComplete: () => void;
}

const RcmsUploadModal: React.FC<Props> = ({ projects, onClose, onComplete }) => {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [allRows, setAllRows] = useState<RcmsRow[]>([]);
  const [parsed, setParsed] = useState<RcmsParsed | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [mode, setMode] = useState<'overwrite' | 'add'>('overwrite');
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ changes: { path: string; old: number; new: number }[] } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Step 1: 파일 파싱
  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setError('');
    setLoading(true);
    try {
      const rows = await parseRcmsFile(f);
      setAllRows(rows);
      const valid = filterValidRows(rows);
      const nums = extractProjectNumbers(valid);
      const dr = getDateRange(valid);

      // 과제번호 자동 매칭
      let autoProject = '';
      if (nums.length > 0) {
        const match = projects.find(p => p.rcmsProjectNumber && nums.includes(p.rcmsProjectNumber));
        if (match) autoProject = match.projectId;
      }
      setSelectedProjectId(autoProject);

      setParsed({
        rows,
        validRows: valid,
        projectNumbers: nums,
        dateRange: dr,
        aggregated: [],
        totalCount: valid.length,
        totalAmount: valid.reduce((s, r) => s + r.amount, 0),
      });
      setStep(2);
    } catch (e: any) {
      setError('파일 파싱 실패: ' + e.message);
    }
    setLoading(false);
  }, [projects]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  // Step 2 → Step 3: 과제 선택 후 매칭
  const goToStep3 = () => {
    if (!selectedProjectId || !parsed) return;
    const proj = projects.find(p => p.projectId === selectedProjectId);
    if (!proj) return;

    const detectedYear = detectYear(proj, parsed.dateRange);
    const yearDetail = detectedYear ? proj.years[detectedYear.yearIndex].budgetDetail : null;
    const agg = aggregateAndMatch(parsed.validRows, yearDetail || null);

    setParsed({ ...parsed, aggregated: agg });
    setStep(3);
  };

  // Step 4: 적용
  const handleApply = async () => {
    if (!parsed || !selectedProjectId) return;
    const proj = projects.find(p => p.projectId === selectedProjectId);
    if (!proj) return;

    const detected = detectYear(proj, parsed.dateRange);
    if (!detected) { setError('해당 연차를 찾을 수 없습니다.'); return; }

    const detail = detected.year.budgetDetail;
    if (!detail) { setError('budgetDetail이 없습니다. 먼저 기본 구조를 생성하세요.'); return; }

    setApplying(true);
    try {
      const { newDetail, result: applyResult } = applyToBudgetDetail(detail, parsed.aggregated, mode);
      await updateBudgetDetail(proj.projectId, detected.year.yearNumber, newDetail, user?.email || '');
      await logAction(
        'rcms_upload', 'projects', proj.projectId,
        `years[${detected.yearIndex}].budgetDetail`,
        null,
        `이지바로 CSV 업로드 (${parsed.totalCount}건, ${formatWon(parsed.totalAmount)})`,
        user?.email || ''
      );
      setResult(applyResult);
      setStep(4);
    } catch (e: any) {
      setError('적용 실패: ' + e.message);
    }
    setApplying(false);
  };

  const selectedProject = projects.find(p => p.projectId === selectedProjectId);
  const detectedYear = selectedProject && parsed ? detectYear(selectedProject, parsed.dateRange) : null;

  // 매칭 가능한 항목 목록 (미분류 수동 매칭용)
  const matchOptions = Object.entries(ITEM_MATCH).map(([k, v]) => ({ label: k, ...v }));

  return (
    <div className="rcms-overlay" onClick={onClose}>
      <div className="rcms-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="rcms-header">
          <h2>이지바로 데이터 업로드</h2>
          <button className="rcms-close" onClick={onClose}><X size={20} /></button>
        </div>

        {/* Step Indicator */}
        <div className="rcms-steps">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`rcms-step ${step >= s ? 'active' : ''} ${step === s ? 'current' : ''}`}>
              {s}
            </div>
          ))}
        </div>

        {error && <div className="rcms-error"><AlertTriangle size={14} /> {error}</div>}

        <div className="rcms-body">
          {/* Step 1: 파일 선택 */}
          {step === 1 && (
            <div className="rcms-step1">
              <div className="rcms-dropzone"
                onDragOver={e => e.preventDefault()} onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}>
                <Upload size={32} className="rcms-upload-icon" />
                <p>이지바로 엑셀/CSV 파일을 여기에 놓거나 클릭하세요</p>
                <span>.xlsx, .csv 지원 (EUC-KR/UTF-8 자동 감지)</span>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden
                onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
              {loading && <div className="rcms-loading">파일 파싱 중...</div>}
            </div>
          )}

          {/* Step 2: 과제 선택 */}
          {step === 2 && parsed && (
            <div className="rcms-step2">
              <div className="rcms-info-box">
                <p>파일: <strong>{file?.name}</strong></p>
                <p>유효 건수: <strong>{parsed.totalCount}건</strong> ({allRows.length}건 중 집행완료+미취소)</p>
                <p>총 금액: <strong>{formatWon(parsed.totalAmount)}</strong></p>
                {parsed.projectNumbers.length > 0 && (
                  <p>과제번호: <strong>{parsed.projectNumbers.join(', ')}</strong></p>
                )}
              </div>

              <div className="rcms-select-group">
                <label>이 CSV의 과제를 선택해주세요:</label>
                <select className="input" value={selectedProjectId}
                  onChange={e => setSelectedProjectId(e.target.value)}>
                  <option value="">-- 과제 선택 --</option>
                  {projects.filter(isActiveProject).map(p => (
                    <option key={p.projectId} value={p.projectId}>
                      {p.shortName} {p.rcmsProjectNumber ? `(${p.rcmsProjectNumber})` : ''}
                    </option>
                  ))}
                </select>
                {selectedProjectId && detectedYear && (
                  <p className="rcms-detected">
                    → {selectedProject?.shortName} {detectedYear.year.yearNumber}차
                    ({detectedYear.year.start} ~ {detectedYear.year.end})에 해당
                  </p>
                )}
              </div>

              <div className="rcms-actions">
                <button className="btn-secondary" onClick={() => setStep(1)}>이전</button>
                <button className="btn-primary" onClick={goToStep3} disabled={!selectedProjectId}>
                  다음: 매칭 확인
                </button>
              </div>
            </div>
          )}

          {/* Step 3: 미리보기 + 매칭 */}
          {step === 3 && parsed && (
            <div className="rcms-step3">
              <div className="rcms-info-box">
                <p>집행일자 범위: <strong>{parsed.dateRange.min} ~ {parsed.dateRange.max}</strong></p>
                <p>총 {parsed.totalCount}건 · {formatWon(parsed.totalAmount)}</p>
              </div>

              <div className="rcms-match-table-wrap">
                <table className="table rcms-match-table">
                  <thead>
                    <tr>
                      <th>항목</th>
                      <th>사용용도</th>
                      <th style={{ textAlign: 'right' }}>건수</th>
                      <th style={{ textAlign: 'right' }}>금액</th>
                      <th>매칭 결과</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.aggregated.map((agg, i) => (
                      <tr key={i}>
                        <td>{agg.item || '?'}</td>
                        <td>{agg.usage || '?'}</td>
                        <td className="money">{agg.count}건</td>
                        <td className="money">{formatWon(agg.amount)}</td>
                        <td>
                          {agg.matchResult ? (
                            <span className="rcms-match-ok">
                              <CheckCircle size={14} /> {agg.matchResult.label}
                            </span>
                          ) : (
                            <span className="rcms-match-warn">
                              <AlertTriangle size={14} /> 미분류
                              <select className="rcms-match-select"
                                onChange={e => {
                                  const val = e.target.value;
                                  if (!val) return;
                                  const opt = matchOptions.find(o => o.label === val);
                                  if (opt) {
                                    const newAgg = [...parsed.aggregated];
                                    newAgg[i] = { ...agg, matchResult: { ...opt, label: `${val} (수동)` } };
                                    setParsed({ ...parsed, aggregated: newAgg });
                                  }
                                }}>
                                <option value="">매칭 선택</option>
                                {matchOptions.map(o => (
                                  <option key={o.label} value={o.label}>{o.label}</option>
                                ))}
                              </select>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rcms-mode-group">
                <label>기존 집행 데이터를 어떻게 처리할까요?</label>
                <div className="rcms-radios">
                  <label><input type="radio" checked={mode === 'overwrite'} onChange={() => setMode('overwrite')} /> 덮어쓰기 (CSV 데이터로 교체)</label>
                  <label><input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} /> 추가 (기존 + CSV 합산)</label>
                </div>
              </div>

              <div className="rcms-actions">
                <button className="btn-secondary" onClick={() => setStep(2)}>이전</button>
                <button className="btn-primary" onClick={handleApply} disabled={applying}>
                  {applying ? '적용 중...' : '적용'}
                </button>
              </div>
            </div>
          )}

          {/* Step 4: 완료 */}
          {step === 4 && result && (
            <div className="rcms-step4">
              <div className="rcms-success-icon"><CheckCircle size={40} /></div>
              <h3>적용 완료!</h3>
              <p>{parsed?.totalCount}건 · {formatWon(parsed?.totalAmount || 0)}</p>

              <div className="rcms-changes">
                {result.changes.map((c, i) => (
                  <div key={i} className="rcms-change-item">
                    <span>{c.path}:</span>
                    <span className="money">{formatWon(c.old)} → {formatWon(c.new)}</span>
                    <span className="rcms-change-diff">
                      ({c.new >= c.old ? '+' : ''}{formatWon(c.new - c.old)})
                    </span>
                  </div>
                ))}
              </div>

              <div className="rcms-actions">
                <button className="btn-primary" onClick={() => { onComplete(); onClose(); }}>확인</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RcmsUploadModal;
