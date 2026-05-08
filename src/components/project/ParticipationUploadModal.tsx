import React, { useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Upload, X, CheckCircle, AlertTriangle } from 'lucide-react';
import { Project, Employee, YearlyParticipation } from '../../types/project';
import { saveParticipation } from '../../services/yearlyParticipationService';
import { useAuth } from '../../hooks/useAuth';
import './ParticipationUploadModal.css';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

interface ParsedRow {
  name: string;
  project: string;
  role: string;
  rates: Record<string, number>;  // { "1": 20, ... }
  matched: boolean;
  empId: string;
  projId: string;
}

interface Props {
  projects: Project[];
  employees: Employee[];
  existingData: YearlyParticipation[];
  year: number;
  onClose: () => void;
  onComplete: () => void;
}

type Step = 1 | 2 | 3;

const ParticipationUploadModal: React.FC<Props> = ({ projects, employees, existingData, year, onClose, onComplete }) => {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [mode, setMode] = useState<'overwrite' | 'merge'>('overwrite');
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ added: number; changed: number; skipped: string[] } | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError('');
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });

      // 상세 시트 우선, 없으면 첫 번째 시트
      const sheetName = wb.SheetNames.find(s => s.includes('상세')) || wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      // raw: false → "100%" 같은 표시형식 그대로 받기 (셀 서식이 % 일 때 안전)
      const rowsFormatted = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { raw: false });
      const rowsRaw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { raw: true });

      // 정규화: 괄호/공백/특수문자 제거 + 소문자 → 부분 일치용
      const normalize = (s: string) => String(s || '').replace(/[\s()[\]{}\-_,./()]/g, '').toLowerCase();

      // 과제 매칭: 정확 → 정규화 정확 → 정규화 부분 일치
      const findProject = (projectName: string) => {
        if (!projectName) return undefined;
        // 1) 정확 매칭
        let proj = projects.find(p => p.shortName === projectName || p.projectId === projectName);
        if (proj) return proj;
        // 2) 정규화 후 정확 매칭
        const normName = normalize(projectName);
        proj = projects.find(p => normalize(p.shortName) === normName || normalize(p.projectId) === normName);
        if (proj) return proj;
        // 3) 정규화 후 부분 일치 (양방향: 엑셀이 시스템에 포함되거나 시스템이 엑셀에 포함)
        proj = projects.find(p => {
          const ps = normalize(p.shortName);
          if (!ps || !normName) return false;
          return ps.includes(normName) || normName.includes(ps);
        });
        return proj;
      };

      // 직원 매칭: 정확 → 정규화 정확
      const findEmployee = (name: string) => {
        if (!name) return undefined;
        let emp = employees.find(e => e.name === name);
        if (emp) return emp;
        const normName = normalize(name);
        return employees.find(e => normalize(e.name) === normName);
      };

      const parsedRows: ParsedRow[] = [];

      for (let idx = 0; idx < rowsFormatted.length; idx++) {
        const row = rowsFormatted[idx];
        const rawRow = rowsRaw[idx] || {};
        const name = String(row['이름'] || row['연구원'] || '').trim();
        const projectName = String(row['과제'] || row['과제명'] || '').trim();
        const role = String(row['역할'] || '연구원').trim();
        if (!name || !projectName) continue;

        const emp = findEmployee(name);
        const proj = findProject(projectName);

        const rates: Record<string, number> = {};
        for (const m of MONTHS) {
          const key = `${m}월`;
          const formattedVal = row[key];
          const rawVal = rawRow[key];

          // 우선순위:
          // 1) formatted가 "20%", "100%" 같은 % 문자열 → % 떼고 정수
          // 2) raw가 0~1 범위의 숫자 → ×100 (퍼센트 셀 서식)
          // 3) 그 외 숫자는 그대로 (이미 정수 % 입력)
          let pct: number | null = null;

          if (typeof formattedVal === 'string' && formattedVal.includes('%')) {
            const cleaned = formattedVal.replace(/[%,\s]/g, '');
            const n = parseFloat(cleaned);
            if (!isNaN(n)) pct = n;
          } else if (typeof rawVal === 'number') {
            // 0~1 범위면 비율 (100% = 1, 20% = 0.2)
            // 1.0 (=100%) 도 포함하기 위해 <= 1
            if (rawVal > 0 && rawVal <= 1) pct = rawVal * 100;
            else pct = rawVal;
          } else if (typeof formattedVal === 'string' && formattedVal.trim() !== '') {
            const n = parseFloat(formattedVal.replace(/[,\s]/g, ''));
            if (!isNaN(n)) {
              if (n > 0 && n <= 1) pct = n * 100;
              else pct = n;
            }
          } else if (typeof formattedVal === 'number') {
            if (formattedVal > 0 && formattedVal <= 1) pct = formattedVal * 100;
            else pct = formattedVal;
          }

          if (pct !== null && !isNaN(pct) && pct > 0) {
            rates[String(m)] = Math.round(pct);
          }
        }

        parsedRows.push({
          name, project: projectName, role,
          rates, matched: !!(emp && proj),
          empId: emp?.employeeNumber || '',
          projId: proj?.projectId || '',
        });
      }

      setParsed(parsedRows);
      setStep(2);
    } catch (e: any) {
      setError('파일 파싱 실패: ' + e.message);
    }
  }, [employees, projects]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleApply = async () => {
    setApplying(true);
    const email = user?.email || '';
    let added = 0, changed = 0;
    const skipped: string[] = [];

    try {
      for (const row of parsed) {
        if (!row.matched) { skipped.push(row.name); continue; }

        const existing = existingData.find(d => d.employeeName === row.name && d.projectId === row.projId);
        const monthlyRates = mode === 'merge' && existing
          ? { ...existing.monthlyRates, ...row.rates }
          : { ...row.rates };

        await saveParticipation({
          id: `${row.projId}_${row.name}_${year}`,
          projectId: row.projId,
          employeeId: row.empId,
          employeeName: row.name,
          year,
          role: (row.role === '책임연구원' ? '책임연구원' : '연구원') as any,
          monthlyRates,
          averageRate: 0,
        }, email);

        if (existing) changed++; else added++;
      }

      setResult({ added, changed, skipped: Array.from(new Set(skipped)) });
      setStep(3);
    } catch (e: any) {
      setError('적용 실패: ' + e.message);
    }
    setApplying(false);
  };

  const matchedCount = parsed.filter(r => r.matched).length;
  const unmatchedCount = parsed.filter(r => !r.matched).length;

  // 변경 비교
  const changes = parsed.filter(r => r.matched).map(row => {
    const existing = existingData.find(d => d.employeeName === row.name && d.projectId === row.projId);
    let changedMonths = 0;
    for (const m of MONTHS) {
      const mKey = String(m);
      const oldVal = existing?.monthlyRates[mKey] || 0;
      const newVal = row.rates[mKey] || 0;
      if (oldVal !== newVal) changedMonths++;
    }
    return { ...row, isNew: !existing, changedMonths };
  });
  const newCount = changes.filter(c => c.isNew).length;
  const changedCount = changes.filter(c => !c.isNew && c.changedMonths > 0).length;

  return (
    <div className="pu-overlay" onClick={onClose}>
      <div className="pu-modal" onClick={e => e.stopPropagation()}>
        <div className="pu-header">
          <h2>참여율 엑셀 업로드</h2>
          <button className="pu-close" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="pu-steps">
          {[1, 2, 3].map(s => (
            <div key={s} className={`pu-step ${step >= s ? 'active' : ''} ${step === s ? 'current' : ''}`}>{s}</div>
          ))}
        </div>

        {error && <div className="pu-error"><AlertTriangle size={14} /> {error}</div>}

        <div className="pu-body">
          {step === 1 && (
            <div className="pu-step1">
              <div className="pu-dropzone" onDragOver={e => e.preventDefault()} onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}>
                <Upload size={32} className="pu-upload-icon" />
                <p>참여율 엑셀 파일을 여기에 놓거나 클릭하세요</p>
                <span>웹앱에서 다운로드한 형식 또는 커스텀 엑셀 지원</span>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden
                onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
              <div className="pu-format-info">
                <strong>지원 형식:</strong>
                <p>컬럼: 이름 | 과제 | 역할 | 1월 | 2월 | ... | 12월</p>
                <p>참여율: 20% 또는 0.2 (자동 변환)</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="pu-step2">
              <div className="pu-info-box">
                <p>파싱 결과: <strong>{parsed.length}건</strong> (매칭 {matchedCount} / 미매칭 {unmatchedCount})</p>
                <p>신규 {newCount}건, 변경 {changedCount}건</p>
              </div>

              {unmatchedCount > 0 && (
                <div className="pu-warn-box">
                  <AlertTriangle size={14} /> 미매칭 인원 (스킵됨): {Array.from(new Set(parsed.filter(r => !r.matched).map(r => r.name))).join(', ')}
                </div>
              )}

              <div className="pu-preview-wrap">
                <table className="table pu-preview-table">
                  <thead>
                    <tr>
                      <th>이름</th><th>과제</th><th>역할</th>
                      {MONTHS.map(m => <th key={m}>{m}월</th>)}
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.slice(0, 50).map((r, i) => (
                      <tr key={i} className={r.matched ? '' : 'pu-unmatched'}>
                        <td>{r.name}</td><td>{r.project}</td><td>{r.role}</td>
                        {MONTHS.map(m => {
                          const val = r.rates[String(m)];
                          return <td key={m} className="pu-rate">{val ? `${val}%` : ''}</td>;
                        })}
                        <td>{r.matched ? <CheckCircle size={14} className="pu-ok" /> : <AlertTriangle size={14} className="pu-skip" />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pu-mode-group">
                <label>적용 방식:</label>
                <div className="pu-radios">
                  <label><input type="radio" checked={mode === 'overwrite'} onChange={() => setMode('overwrite')} /> 덮어쓰기</label>
                  <label><input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} /> 병합 (기존 + 업로드)</label>
                </div>
              </div>

              <div className="pu-actions">
                <button className="btn-secondary" onClick={() => setStep(1)}>이전</button>
                <button className="btn-primary" onClick={handleApply} disabled={applying || matchedCount === 0}>
                  {applying ? '적용 중...' : `적용 (${matchedCount}건)`}
                </button>
              </div>
            </div>
          )}

          {step === 3 && result && (
            <div className="pu-step3">
              <div className="pu-success-icon"><CheckCircle size={40} /></div>
              <h3>업로드 완료!</h3>
              <p>신규 {result.added}건 · 변경 {result.changed}건</p>
              {result.skipped.length > 0 && (
                <p className="pu-skipped">미매칭 스킵: {result.skipped.join(', ')}</p>
              )}
              <div className="pu-actions">
                <button className="btn-primary" onClick={() => { onComplete(); onClose(); }}>확인</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ParticipationUploadModal;
