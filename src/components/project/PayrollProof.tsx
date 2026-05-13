import React, { useState, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, Upload, Download,
  CheckCircle, XCircle, Info, Calculator, Printer,
} from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import DataUploadTabComponent from './DataUploadTab';
import LaborCostTabComponent from './LaborCostTab';
import PrintTabComponent from './PrintTab';
import MonthlyStatusManager, { MonthlyStatus } from './MonthlyStatusManager';
import './DataUploadTab.css';
import './LaborCostTab.css';
import './PrintTab.css';
import './MonthlyStatusManager.css';
import { useProjects } from '../../hooks/useProjects';
import { useEmployees } from '../../hooks/useEmployees';
import { useAuth } from '../../hooks/useAuth';
import { subscribeYearlyParticipations } from '../../services/yearlyParticipationService';
import { Employee, Project, YearlyParticipation } from '../../types/project';
import './PayrollProof.css';

function formatWon(n: number): string { return n.toLocaleString() + '원'; }

type TabId = 'upload' | 'calculate' | 'print';

// ═══ 업로드 상태 타입 ═══
interface MonthlyUploadStatus {
  payroll: { uploaded: boolean; date?: string };
  healthInsurance: { uploaded: boolean; date?: string };
  employmentInsurance: { uploaded: boolean; date?: string };
  industrialAccident: { uploaded: boolean; date?: string };
  nationalPension: { uploaded: boolean; fromPayroll: boolean };
}

// ═══ 업로드 체크리스트 ═══
function UploadChecklist({ status }: { status: MonthlyUploadStatus }) {
  const items = [
    { key: 'payroll', label: '급여대장', ...status.payroll, icon: status.payroll.uploaded ? CheckCircle : XCircle },
    { key: 'health', label: '건강보험 고지서', ...status.healthInsurance, icon: status.healthInsurance.uploaded ? CheckCircle : XCircle },
    { key: 'employ', label: '고용보험 고지서', ...status.employmentInsurance, icon: status.employmentInsurance.uploaded ? CheckCircle : XCircle },
    { key: 'accident', label: '산재보험 고지서', ...status.industrialAccident, icon: status.industrialAccident.uploaded ? CheckCircle : XCircle },
  ];

  return (
    <div className="pp-checklist">
      {items.map(item => {
        const Icon = item.icon;
        return (
          <div key={item.key} className={`pp-check-item ${item.uploaded ? 'done' : 'pending'}`}>
            <Icon size={16} />
            <span>{item.label}</span>
            {item.uploaded && item.date && <span className="pp-check-date">{item.date}</span>}
          </div>
        );
      })}
      <div className="pp-check-item info">
        <Info size={16} />
        <span>국민연금 — {status.nationalPension.fromPayroll ? '급여명세서에서 확인됨' : '미확인'}</span>
      </div>
    </div>
  );
}

// ═══ 탭 1: 데이터 업로드 ═══
// DataUploadTab은 별도 컴포넌트로 분리됨 (DataUploadTab.tsx)

// LaborCostTab → 별도 컴포넌트 (LaborCostTab.tsx)

// PrintTab → 별도 컴포넌트 (PrintTab.tsx)

// ═══ 메인 ═══
const PayrollProof: React.FC = () => {
  const { user } = useAuth();
  const { activeProjects } = useProjects();
  const { employees } = useEmployees();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [activeTab, setActiveTab] = useState<TabId>('upload');
  const [participations, setParticipations] = useState<YearlyParticipation[]>([]);
  const [monthlyStatus, setMonthlyStatus] = useState<MonthlyStatus>('작업중');
  const [uploadStatus, setUploadStatus] = useState<MonthlyUploadStatus>({
    payroll: { uploaded: false },
    healthInsurance: { uploaded: false },
    employmentInsurance: { uploaded: false },
    industrialAccident: { uploaded: false },
    nationalPension: { uploaded: false, fromPayroll: false },
  });

  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

  const prevMonth = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };

  // 참여율 구독
  useEffect(() => {
    const unsub = subscribeYearlyParticipations(year, setParticipations, () => {});
    return unsub;
  }, [year]);

  // 업로드 상태 조회
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'monthlyData', yearMonth), snap => {
      if (snap.exists()) {
        const d = snap.data();
        setMonthlyStatus((d.status as MonthlyStatus) || '작업중');
        setUploadStatus({
          payroll: { uploaded: !!d.payrollUploadDate, date: d.payrollUploadDate },
          healthInsurance: { uploaded: !!d.healthInsuranceUploadDate, date: d.healthInsuranceUploadDate },
          employmentInsurance: { uploaded: !!d.employmentInsuranceUploadDate, date: d.employmentInsuranceUploadDate },
          industrialAccident: { uploaded: !!d.industrialAccidentUploadDate, date: d.industrialAccidentUploadDate },
          nationalPension: { uploaded: !!d.payrollUploadDate, fromPayroll: !!d.payrollUploadDate },
        });
      } else {
        setMonthlyStatus('작업중');
        setUploadStatus({
          payroll: { uploaded: false }, healthInsurance: { uploaded: false },
          employmentInsurance: { uploaded: false }, industrialAccident: { uploaded: false },
          nationalPension: { uploaded: false, fromPayroll: false },
        });
      }
    });
    return unsub;
  }, [yearMonth]);

  // onStatusChange는 onSnapshot이 자동 감지하므로 noop

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'upload', label: '데이터 업로드', icon: <Upload size={15} /> },
    { id: 'calculate', label: '인건비 산출', icon: <Calculator size={15} /> },
    { id: 'print', label: '서류 출력', icon: <Printer size={15} /> },
  ];

  return (
    <div className="pp-container">
      {/* 헤더 */}
      <div className="pp-header">
        <div className="pp-month-nav">
          <button className="pp-nav-btn" onClick={prevMonth}><ChevronLeft size={18} /></button>
          <span className="pp-month-label">
            {year}년 {month}월
            {monthlyStatus === '확정' && <span className="pp-status-badge confirmed">✅</span>}
            {monthlyStatus === '잠금' && <span className="pp-status-badge locked">🔒</span>}
          </span>
          <button className="pp-nav-btn" onClick={nextMonth}><ChevronRight size={18} /></button>
        </div>
        <button className="btn-secondary pp-zip-btn">
          <Download size={15} /> 전체 서류 다운로드
        </button>
      </div>

      {/* 업로드 체크리스트 */}
      <UploadChecklist status={uploadStatus} />

      <MonthlyStatusManager
        yearMonth={yearMonth}
        status={monthlyStatus}
        uploadFlags={{
          payroll: uploadStatus.payroll.uploaded,
          health: uploadStatus.healthInsurance.uploaded,
          employment: uploadStatus.employmentInsurance.uploaded,
          accident: uploadStatus.industrialAccident.uploaded,
        }}
        onStatusChange={setMonthlyStatus}
      />

      {/* 탭 */}
      <div className="pp-tabs">
        {tabs.map(t => (
          <button key={t.id} className={`pp-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* 탭 내용 */}
      {activeTab === 'upload' && (
        <DataUploadTabComponent yearMonth={yearMonth} employees={employees} onStatusChange={() => {}} />
      )}
      {activeTab === 'calculate' && (
        <LaborCostTabComponent yearMonth={yearMonth} employees={employees}
          activeProjects={activeProjects} participations={participations} />
      )}
      {activeTab === 'print' && (
        <PrintTabComponent yearMonth={yearMonth} activeProjects={activeProjects}
          employees={employees} participations={participations} />
      )}
    </div>
  );
};

export default PayrollProof;
