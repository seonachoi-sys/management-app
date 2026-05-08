import React, { useState, useEffect, useCallback } from 'react';
import { Upload, CheckCircle, AlertTriangle, ArrowUp, ArrowDown, Sparkles } from 'lucide-react';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Employee } from '../../types/project';
import { useAuth } from '../../hooks/useAuth';
import {
  parsePayrollCSV, parseHealthInsuranceCSV, parsePensionCSV,
  parseEmploymentInsuranceCSV, parseAccidentInsuranceCSV,
  detectChanges, PayrollEntry, ChangeItem,
} from '../../services/payrollParserService';

function formatWon(n: number): string { return n.toLocaleString() + '원'; }

const EXECUTIVES = ['박재민', '문재훈', '안준', '신규보'];

interface UploadSlot {
  id: string;
  label: string;
  desc: string;
  required: boolean;
  accept: string;
}

const UPLOAD_SLOTS: UploadSlot[] = [
  { id: 'payroll', label: '급여대장', desc: '전체 직원 급여대장 CSV/XLS/XLSX', required: true, accept: '.csv,.xls,.xlsx' },
  { id: 'health', label: '건강보험 고지서', desc: '건강보험공단 CSV 또는 엑셀', required: true, accept: '.csv,.xlsx,.xls' },
  { id: 'employment', label: '고용보험 고지서', desc: '근로복지공단 고용보험 CSV/엑셀', required: true, accept: '.csv,.xlsx,.xls' },
  { id: 'accident', label: '산재보험 고지서', desc: '근로복지공단 산재보험 CSV/엑셀', required: true, accept: '.csv,.xlsx,.xls' },
  { id: 'pension', label: '국민연금 고지서', desc: '국민연금공단 CSV/엑셀 (선택)', required: false, accept: '.csv,.xlsx,.xls' },
];

interface ParseResult {
  slotId: string;
  count: number;
  preview: any[];
  data: Record<string, any>;
  unmatchedNames: string[];
}

interface Props {
  yearMonth: string;
  employees: Employee[];
  onStatusChange: () => void;
}

const DataUploadTab: React.FC<Props> = ({ yearMonth, employees, onStatusChange }) => {
  const { user } = useAuth();
  const [results, setResults] = useState<Record<string, ParseResult>>({});
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [changes, setChanges] = useState<ChangeItem[]>([]);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const empNames = new Set(employees.map(e => e.name));

  // 전월 yearMonth 계산
  const prevYM = (() => {
    const y = parseInt(yearMonth.slice(0, 4), 10);
    const m = parseInt(yearMonth.slice(5), 10);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  })();

  // 파일 처리
  const handleFile = useCallback(async (slotId: string, file: File) => {
    setProcessing(slotId);
    try {
      let parsed: any[] = [];
      let dataMap: Record<string, any> = {};
      const unmatched: string[] = [];

      if (slotId === 'payroll') {
        const entries = await parsePayrollCSV(file);
        parsed = entries;
        for (const e of entries) {
          dataMap[e.name] = e;
          if (!empNames.has(e.name)) unmatched.push(e.name);
        }
        // 전월 비교
        const prevDoc = await getDoc(doc(db, 'monthlyData', prevYM));
        const prevPayroll = prevDoc.exists() ? prevDoc.data()?.payroll?.data : null;
        const ch = detectChanges(prevPayroll, dataMap);
        setChanges(ch);
      } else if (slotId === 'health') {
        const entries = await parseHealthInsuranceCSV(file);
        parsed = entries;
        for (const e of entries) { dataMap[e.name] = e; if (!empNames.has(e.name)) unmatched.push(e.name); }
      } else if (slotId === 'pension') {
        const entries = await parsePensionCSV(file);
        parsed = entries;
        for (const e of entries) { dataMap[e.name] = e; if (!empNames.has(e.name)) unmatched.push(e.name); }
      } else if (slotId === 'employment') {
        const entries = await parseEmploymentInsuranceCSV(file);
        parsed = entries;
        for (const e of entries) { dataMap[e.name] = e; if (!empNames.has(e.name)) unmatched.push(e.name); }
      } else if (slotId === 'accident') {
        const entries = await parseAccidentInsuranceCSV(file);
        parsed = entries;
        for (const e of entries) { dataMap[e.name] = e; if (!empNames.has(e.name)) unmatched.push(e.name); }
      }

      setResults(prev => ({
        ...prev,
        [slotId]: {
          slotId,
          count: parsed.length,
          preview: parsed.slice(0, 5),
          data: dataMap,
          unmatchedNames: unmatched,
        },
      }));
    } catch (err: any) {
      alert(`파싱 실패: ${err.message}`);
    }
    setProcessing(null);
  }, [empNames, prevYM]);

  // Firebase 적용
  const applySlot = useCallback(async (slotId: string) => {
    const result = results[slotId];
    if (!result) return;

    const now = new Date().toISOString().slice(0, 10);
    const docRef = doc(db, 'monthlyData', yearMonth);

    if (slotId === 'payroll') {
      await setDoc(docRef, {
        yearMonth,
        payroll: { uploadDate: now, data: result.data },
        payrollUploadDate: now,
      }, { merge: true });
    } else {
      // 보험 데이터 병합
      const existing = await getDoc(docRef);
      const prevIns = existing.exists() ? (existing.data()?.insurance?.data || {}) : {};

      // 보험 유형별 매핑
      for (const [name, entry] of Object.entries(result.data)) {
        if (!prevIns[name]) prevIns[name] = {};
        Object.assign(prevIns[name], entry);

        // 회사부담금 합계 재계산
        const ins = prevIns[name];
        ins.totalCompanyBurden =
          (ins.nationalPensionCompany || 0) +
          (ins.healthInsuranceCompany || 0) +
          (ins.longTermCareCompany || 0) +
          (ins.employmentInsCompany || 0) +
          (ins.industrialAccident || 0);
      }

      const uploadKey = {
        health: 'healthInsuranceUploadDate',
        employment: 'employmentInsuranceUploadDate',
        accident: 'industrialAccidentUploadDate',
        pension: 'pensionUploadDate',
      }[slotId] || '';

      await setDoc(docRef, {
        yearMonth,
        insurance: { data: prevIns, [`${slotId}UploadDate`]: now },
        [uploadKey]: now,
      }, { merge: true });
    }

    setApplied(prev => new Set(prev).add(slotId));
    onStatusChange();
  }, [results, yearMonth, onStatusChange]);

  const handleDrop = (slotId: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(slotId, f);
  };

  return (
    <div className="dut-container">
      <h3 className="pp-tab-title">월별 데이터 업로드</h3>
      <p className="pp-tab-desc">매월 급여대장과 4대보험 고지서를 업로드하면 인건비가 자동 산출됩니다.</p>

      {/* 업로드 슬롯 그리드 */}
      <div className="dut-grid">
        {UPLOAD_SLOTS.map(slot => {
          const result = results[slot.id];
          const isApplied = applied.has(slot.id);
          const isProcessing = processing === slot.id;

          return (
            <div key={slot.id}
              className={`dut-slot card ${dragOver === slot.id ? 'drag-over' : ''} ${isApplied ? 'applied' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(slot.id); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => handleDrop(slot.id, e)}
            >
              <div className="dut-slot-header">
                <span className="dut-slot-label">{slot.label}</span>
                {!slot.required && <span className="dut-optional">선택</span>}
                {isApplied && <CheckCircle size={16} className="dut-applied-icon" />}
              </div>
              <p className="dut-slot-desc">{slot.desc}</p>

              {isProcessing ? (
                <div className="dut-processing">파싱 중...</div>
              ) : result ? (
                <div className="dut-result">
                  <div className="dut-result-summary">
                    <CheckCircle size={14} className="dut-ok" /> {result.count}명 파싱 완료
                  </div>
                  {result.unmatchedNames.length > 0 && (
                    <div className="dut-unmatched">
                      <AlertTriangle size={12} /> 미매칭: {result.unmatchedNames.join(', ')}
                    </div>
                  )}
                  {/* 미리보기 */}
                  <div className="dut-preview">
                    {result.preview.map((p: any, i: number) => (
                      <div key={i} className="dut-preview-row">
                        <span>{p.name || p.employeeName || '?'}</span>
                        <span className="money">
                          {p.totalPay ? formatWon(p.totalPay)
                            : p.healthInsurance ? formatWon(p.healthInsurance)
                            : p.nationalPension ? formatWon(p.nationalPension)
                            : p.employmentInsurance ? formatWon(p.employmentInsurance)
                            : p.industrialAccident ? formatWon(p.industrialAccident) : '-'}
                        </span>
                      </div>
                    ))}
                    {result.count > 5 && <div className="dut-preview-more">...외 {result.count - 5}명</div>}
                  </div>
                  <div className="dut-result-actions">
                    {!isApplied && (
                      <button className="btn-primary dut-apply-btn" onClick={() => applySlot(slot.id)}>
                        적용 ({result.count}명)
                      </button>
                    )}
                    <label className="btn-secondary dut-replace-btn" title="다른 파일로 교체">
                      🔄 다시 업로드
                      <input type="file" accept={slot.accept} hidden
                        onChange={e => {
                          if (e.target.files?.[0]) {
                            // 적용된 상태면 컨펌 후 진행
                            if (isApplied && !window.confirm(`이미 적용된 ${slot.label}을(를) 새 파일로 교체합니다. 계속하시겠습니까?\n(적용 버튼을 다시 눌러야 Firebase에 반영됩니다)`)) {
                              e.target.value = '';
                              return;
                            }
                            // 기존 결과/적용 상태 초기화
                            setApplied(prev => { const s = new Set(prev); s.delete(slot.id); return s; });
                            handleFile(slot.id, e.target.files[0]);
                            e.target.value = '';
                          }
                        }} />
                    </label>
                  </div>
                </div>
              ) : (
                <>
                  <Upload size={24} className="dut-upload-icon" />
                  <label className="btn-secondary dut-file-btn">
                    파일 선택
                    <input type="file" accept={slot.accept} hidden
                      onChange={e => { if (e.target.files?.[0]) handleFile(slot.id, e.target.files[0]); }} />
                  </label>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* 전월 대비 변동 */}
      <div className="dut-changes">
        <h4>전월 대비 변동사항</h4>
        {changes.length === 0 ? (
          <p className="dut-no-changes">
            {results['payroll'] ? '✅ 전월 대비 변동사항 없습니다' : '급여대장 업로드 후 자동 표시됩니다'}
          </p>
        ) : (
          <div className="dut-changes-table-wrap">
            <table className="table dut-changes-table">
              <thead>
                <tr><th>연구원</th><th>항목</th><th style={{ textAlign: 'right' }}>전월</th><th style={{ textAlign: 'right' }}>이번 달</th><th>변동</th></tr>
              </thead>
              <tbody>
                {changes.map((c, i) => (
                  <tr key={i}>
                    <td className="dut-emp">{c.name}</td>
                    <td>{c.fieldLabel}</td>
                    <td className="money">{c.type === 'new' ? '-' : formatWon(c.oldValue)}</td>
                    <td className="money">{formatWon(c.newValue)}</td>
                    <td className={`dut-diff ${c.type}`}>
                      {c.type === 'increase' && <><ArrowUp size={12} /> +{formatWon(c.diff)}</>}
                      {c.type === 'decrease' && <><ArrowDown size={12} /> {formatWon(c.diff)}</>}
                      {c.type === 'new' && <><Sparkles size={12} /> 신규</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default DataUploadTab;
