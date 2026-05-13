/**
 * Firebase 시딩 스크립트 — 직원 + 과제 데이터
 * Usage: node src/scripts/seedData.js [employees|projects|all]
 */
require('dotenv').config();
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, doc, setDoc, getDocs, Timestamp } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ═══ 직원 시딩 ═══
async function seedEmployees() {
  const dataPath = path.join(__dirname, '../../data/employees_parsed.json');
  const employees = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const now = Timestamp.now();

  console.log(`\n직원 ${employees.length}명 시딩 시작...`);

  for (const emp of employees) {
    const docRef = doc(db, 'employees', emp.employeeNumber);
    await setDoc(docRef, {
      name: emp.name,
      position: emp.position,
      department: emp.department,
      employeeNumber: emp.employeeNumber,
      hireDate: emp.hireDate,
      salary: {
        basePay: emp.salary.basePay,
        mealAllowance: emp.salary.mealAllowance,
        vehicleAllowance: emp.salary.vehicleAllowance,
        researchAllowance: emp.salary.researchAllowance,
        childcareAllowance: emp.salary.childcareAllowance,
        totalPay: emp.salary.totalPay,
      },
      insurance: emp.insurance,
      netPay: emp.netPay,
      updatedAt: now,
    });
    console.log(`  ✅ ${emp.name} (${emp.employeeNumber})`);
  }
  console.log(`\n직원 ${employees.length}명 시딩 완료!`);
}

// ═══ 과제 시딩 ═══
async function seedProjects() {
  const now = Timestamp.now();

  // 진행중 4개 과제
  const activeProjects = [
    {
      id: 'AI빅테크',
      status: '진행',
      category: 'R&D사업',
      programName: '연구개발특구육성(R&D)사업',
      projectName: '갑상선 질환 AI 의료기기의 글로벌 다인종 확대 적용을 위한 상대적 원스텝 접근 기술 활용',
      shortName: 'AI빅테크',
      agency: '과학기술정보통신부/(재)연구개발특구진흥재단',
      hostOrg: '타이로스코프',
      participationType: '주관',
      pi: '박재민',
      piRole: '책임',
      period: { totalStart: '2025-07-01', totalEnd: '2027-12-31' },
      years: [
        {
          yearNumber: 1, start: '2025-07-01', end: '2025-12-31', months: 6,
          budget: { government: 605000000, privateCash: 20166700, privateInKind: 181499967, total: 806666667 },
          budgetExecution: { executed: 0, planned: 0, unplanned: 806666667, remaining: 806666667 },
        },
        {
          yearNumber: 2, start: '2026-01-01', end: '2026-12-31', months: 12,
          budget: { government: 1980000000, privateCash: 66000000, privateInKind: 594000000, total: 2640000000 },
          budgetExecution: { executed: 0, planned: 0, unplanned: 2640000000, remaining: 2640000000 },
        },
        {
          yearNumber: 3, start: '2027-01-01', end: '2027-12-31', months: 12,
          budget: { government: 1980000000, privateCash: 66000000, privateInKind: 594000000, total: 2640000000 },
          budgetExecution: { executed: 0, planned: 0, unplanned: 2640000000, remaining: 2640000000 },
        },
      ],
      contact: { manager: '', phone: '', email: '' },
      excludeReason: '',
    },
    {
      id: '인재성장',
      status: '진행',
      category: 'R&D사업',
      programName: '2024년 산업혁신인재성장지원(해외연계) 사업',
      projectName: '강건한 디지털 헬스케어 서비스를 위한 생체전기신호 잡음, 변동, 드리프트 해결 인공지능 기술 및 센서 시스템 개발',
      shortName: '인재성장',
      agency: '산업통상자원부',
      hostOrg: 'UNIST',
      participationType: '공동',
      pi: '신규보',
      piRole: '책임',
      period: { totalStart: '2024-05-01', totalEnd: '2027-04-30' },
      years: [
        {
          yearNumber: 1, start: '2024-05-01', end: '2025-04-30', months: 12,
          budget: { government: 90000000, privateCash: 2250000, privateInKind: 20250000, total: 112500000 },
          budgetExecution: { executed: 0, planned: 0, unplanned: 112500000, remaining: 112500000 },
        },
        {
          yearNumber: 2, start: '2025-05-01', end: '2026-02-28', months: 10,
          budget: { government: 90000000, privateCash: 2250000, privateInKind: 20250000, total: 112500000 },
          budgetExecution: { executed: 0, planned: 0, unplanned: 112500000, remaining: 112500000 },
        },
        {
          yearNumber: 3, start: '2026-03-01', end: '2027-04-30', months: 14,
          budget: { government: 90000000, privateCash: 2250000, privateInKind: 20250000, total: 112500000 },
          budgetExecution: { executed: 0, planned: 0, unplanned: 112500000, remaining: 112500000 },
        },
      ],
      contact: { manager: '', phone: '', email: '' },
      excludeReason: '',
    },
    {
      id: '의료데이터',
      status: '진행',
      category: 'R&D사업',
      programName: 'SW컴퓨팅산업원천기술개발',
      projectName: '강건하고 일반화가능한 생체전기신호 파운데이션 모델 구축 및 이를 활용한 질환 진단 모델들의 임상적 유용성 연구',
      shortName: '의료데이터',
      agency: '정보통신기획평가원',
      hostOrg: 'UNIST',
      participationType: '공동',
      pi: '신규보',
      piRole: '책임',
      period: { totalStart: '2024-07-01', totalEnd: '2026-12-31' },
      years: [
        {
          yearNumber: 1, start: '2024-07-01', end: '2025-03-31', months: 9,
          budget: { government: 230000000, privateCash: 7667000, privateInKind: 69000000, total: 306667000 },
          budgetExecution: { executed: 0, planned: 0, unplanned: 306667000, remaining: 306667000 },
        },
        {
          yearNumber: 1.5, start: '2025-04-01', end: '2025-12-31', months: 9,
          budget: { government: 280000000, privateCash: 9334000, privateInKind: 84000000, total: 373334000 },
          budgetExecution: { executed: 0, planned: 0, unplanned: 373334000, remaining: 373334000 },
        },
        {
          yearNumber: 2, start: '2026-01-01', end: '2026-12-31', months: 12,
          budget: { government: 280000000, privateCash: 9334000, privateInKind: 84000000, total: 373334000 },
          budgetExecution: { executed: 0, planned: 0, unplanned: 373334000, remaining: 373334000 },
        },
      ],
      contact: { manager: '', phone: '', email: '' },
      excludeReason: '',
    },
    {
      id: '바이오코어',
      status: '진행',
      category: '지원사업',
      programName: '바이오 Core Facility 구축사업',
      projectName: '피부전도도, 체온 기반의 갑상선기능항진증 및 갑상선기능저하증 모니터링 기술개발',
      shortName: '바이오코어',
      agency: '과학기술정보통신부',
      hostOrg: '분당서울대학교병원',
      participationType: '공동',
      pi: '박준현',
      piRole: '공동',
      period: { totalStart: '2025-01-17', totalEnd: '2027-12-31' },
      years: [
        {
          yearNumber: 1, start: '2025-01-17', end: '2025-12-31', months: 12,
          budget: { government: 150000000, privateCash: 5300000, privateInKind: 45000000, total: 200300000 },
          budgetExecution: { executed: 0, planned: 0, unplanned: 200300000, remaining: 200300000 },
        },
        {
          yearNumber: 2, start: '2026-01-01', end: '2026-12-31', months: 12,
          budget: { government: 150000000, privateCash: 5300000, privateInKind: 45000000, total: 200300000 },
          budgetExecution: { executed: 0, planned: 0, unplanned: 200300000, remaining: 200300000 },
        },
        {
          yearNumber: 3, start: '2027-01-01', end: '2027-12-31', months: 12,
          budget: { government: 150000000, privateCash: 5300000, privateInKind: 45000000, total: 200300000 },
          budgetExecution: { executed: 0, planned: 0, unplanned: 200300000, remaining: 200300000 },
        },
      ],
      contact: { manager: '', phone: '', email: '' },
      excludeReason: '',
    },
  ];

  // 종료 과제 (국책과제누적관리_2.csv에서 파싱)
  const iconv = require('iconv-lite');
  const csvPath = path.join(__dirname, '../../data/국책과제누적관리_2.csv.csv');
  const csvBuf = fs.readFileSync(csvPath);
  let csvText = csvBuf.toString('utf-8');
  if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);
  const csvLines = csvText.split('\n');

  const closedProjects = [];
  let closedIdx = 0;
  for (const line of csvLines) {
    // Simple CSV parse (this file is UTF-8 and well-formed)
    const cols = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cols.push(cur.trim());

    if (cols[0] === '종료') {
      closedIdx++;
      closedProjects.push({
        id: `closed_${closedIdx}`,
        status: '종료',
        category: cols[1] || '',
        programName: cols[2] || '',
        projectName: cols[3] || '',
        shortName: (cols[3] || '').substring(0, 20),
        agency: cols[4] || '',
        hostOrg: '타이로스코프',
        participationType: '주관',
        pi: cols[11] || '',
        piRole: '책임',
        period: {
          totalStart: cols[5] || '',
          totalEnd: cols[6] || '',
        },
        years: [],
        contact: { manager: '', phone: '', email: '' },
        excludeReason: '',
        totalBudget: {
          government: parseInt((cols[7] || '0').replace(/,/g, ''), 10) || 0,
          privateCash: parseInt((cols[8] || '0').replace(/,/g, ''), 10) || 0,
          privateInKind: parseInt((cols[9] || '0').replace(/,/g, ''), 10) || 0,
          total: parseInt((cols[10] || '0').replace(/,/g, ''), 10) || 0,
        },
      });
    }
  }

  const allProjects = [...activeProjects, ...closedProjects];
  console.log(`\n과제 ${allProjects.length}건 시딩 시작 (진행 ${activeProjects.length} + 종료 ${closedProjects.length})...`);

  for (const proj of allProjects) {
    const { id, ...data } = proj;
    const docRef = doc(db, 'projects', id);
    await setDoc(docRef, {
      ...data,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`  ✅ [${data.status}] ${data.shortName || data.projectName.substring(0, 30)}`);
  }
  console.log(`\n과제 ${allProjects.length}건 시딩 완료!`);
}

// ═══ 메인 ═══
async function main() {
  const arg = process.argv[2] || 'all';
  console.log(`Firebase 시딩 시작 (모드: ${arg})`);
  console.log(`프로젝트: ${firebaseConfig.projectId}`);

  try {
    if (arg === 'employees' || arg === 'all') {
      await seedEmployees();
    }
    if (arg === 'projects' || arg === 'all') {
      await seedProjects();
    }

    // 검증
    console.log('\n=== 검증 ===');
    const empSnap = await getDocs(collection(db, 'employees'));
    console.log(`employees 컬렉션: ${empSnap.size}건`);

    const projSnap = await getDocs(collection(db, 'projects'));
    const active = [];
    const closed = [];
    projSnap.forEach(d => {
      if (d.data().status === '진행') active.push(d.data().shortName);
      else closed.push(d.id);
    });
    console.log(`projects 컬렉션: ${projSnap.size}건 (진행 ${active.length}: ${active.join(', ')} | 종료 ${closed.length}건)`);

    console.log('\n✅ 시딩 완료!');
    process.exit(0);
  } catch (err) {
    console.error('❌ 시딩 실패:', err.message);
    process.exit(1);
  }
}

main();
