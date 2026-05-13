/**
 * 인앱 Firebase 시딩 컴포넌트
 * 로그인 후 /seed 경로에서 실행 (인증된 세션 사용)
 */
import React, { useState } from 'react';
import { collection, doc, setDoc, getDocs, deleteDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

// ═══ 직원 데이터 (parseCSV.js에서 추출) ═══
import employeesData from './employees_parsed.json';
import participationData from './participation_parsed.json';

// ═══ 진행중 과제 4개 ═══
const ACTIVE_PROJECTS = [
  {
    id: 'AI빅테크',
    status: '진행', category: 'R&D사업',
    programName: '연구개발특구육성(R&D)사업',
    projectName: '갑상선 질환 AI 의료기기의 글로벌 다인종 확대 적용을 위한 상대적 원스텝 접근 기술 활용',
    shortName: 'AI빅테크',
    agency: '과학기술정보통신부/(재)연구개발특구진흥재단',
    hostOrg: '타이로스코프', participationType: '주관',
    pi: '박재민', piRole: '책임',
    period: { totalStart: '2025-07-01', totalEnd: '2027-12-31' },
    years: [
      { yearNumber: 1, start: '2025-07-01', end: '2025-12-31', months: 6,
        budget: { government: 605000000, privateCash: 20166700, privateInKind: 181499967, total: 806666667 },
        budgetExecution: { executed: 0, planned: 0, unplanned: 806666667, remaining: 806666667 } },
      { yearNumber: 2, start: '2026-01-01', end: '2026-12-31', months: 12,
        budget: { government: 1980000000, privateCash: 66000000, privateInKind: 594000000, total: 2640000000 },
        budgetExecution: { executed: 0, planned: 0, unplanned: 2640000000, remaining: 2640000000 } },
      { yearNumber: 3, start: '2027-01-01', end: '2027-12-31', months: 12,
        budget: { government: 1980000000, privateCash: 66000000, privateInKind: 594000000, total: 2640000000 },
        budgetExecution: { executed: 0, planned: 0, unplanned: 2640000000, remaining: 2640000000 } },
    ],
    contact: { manager: '', phone: '', email: '' }, excludeReason: '',
  },
  {
    id: '인재성장',
    status: '진행', category: 'R&D사업',
    programName: '2024년 산업혁신인재성장지원(해외연계) 사업',
    projectName: '강건한 디지털 헬스케어 서비스를 위한 생체전기신호 잡음, 변동, 드리프트 해결 인공지능 기술 및 센서 시스템 개발',
    shortName: '인재성장',
    agency: '산업통상자원부', hostOrg: 'UNIST', participationType: '공동',
    pi: '신규보', piRole: '책임',
    period: { totalStart: '2024-05-01', totalEnd: '2027-04-30' },
    years: [
      { yearNumber: 1, start: '2024-05-01', end: '2025-04-30', months: 12,
        budget: { government: 90000000, privateCash: 2250000, privateInKind: 20250000, total: 112500000 },
        budgetExecution: { executed: 0, planned: 0, unplanned: 112500000, remaining: 112500000 } },
      { yearNumber: 2, start: '2025-05-01', end: '2026-02-28', months: 10,
        budget: { government: 90000000, privateCash: 2250000, privateInKind: 20250000, total: 112500000 },
        budgetExecution: { executed: 0, planned: 0, unplanned: 112500000, remaining: 112500000 } },
      { yearNumber: 3, start: '2026-03-01', end: '2027-04-30', months: 14,
        budget: { government: 90000000, privateCash: 2250000, privateInKind: 20250000, total: 112500000 },
        budgetExecution: { executed: 0, planned: 0, unplanned: 112500000, remaining: 112500000 } },
    ],
    contact: { manager: '', phone: '', email: '' }, excludeReason: '',
  },
  {
    id: '의료데이터',
    status: '진행', category: 'R&D사업',
    programName: 'SW컴퓨팅산업원천기술개발',
    projectName: '강건하고 일반화가능한 생체전기신호 파운데이션 모델 구축 및 이를 활용한 질환 진단 모델들의 임상적 유용성 연구',
    shortName: '의료데이터',
    agency: '정보통신기획평가원', hostOrg: 'UNIST', participationType: '공동',
    pi: '신규보', piRole: '책임',
    period: { totalStart: '2024-07-01', totalEnd: '2026-12-31' },
    years: [
      { yearNumber: 1, start: '2024-07-01', end: '2025-03-31', months: 9,
        budget: { government: 230000000, privateCash: 7667000, privateInKind: 69000000, total: 306667000 },
        budgetExecution: { executed: 0, planned: 0, unplanned: 306667000, remaining: 306667000 } },
      { yearNumber: 1.5, start: '2025-04-01', end: '2025-12-31', months: 9,
        budget: { government: 280000000, privateCash: 9334000, privateInKind: 84000000, total: 373334000 },
        budgetExecution: { executed: 0, planned: 0, unplanned: 373334000, remaining: 373334000 } },
      { yearNumber: 2, start: '2026-01-01', end: '2026-12-31', months: 12,
        budget: { government: 280000000, privateCash: 9334000, privateInKind: 84000000, total: 373334000 },
        budgetExecution: { executed: 0, planned: 0, unplanned: 373334000, remaining: 373334000 } },
    ],
    contact: { manager: '', phone: '', email: '' }, excludeReason: '',
  },
  {
    id: '바이오코어',
    status: '진행', category: '지원사업',
    programName: '바이오 Core Facility 구축사업',
    projectName: '피부전도도, 체온 기반의 갑상선기능항진증 및 갑상선기능저하증 모니터링 기술개발',
    shortName: '바이오코어',
    agency: '과학기술정보통신부', hostOrg: '분당서울대학교병원', participationType: '공동',
    pi: '박준현', piRole: '공동',
    period: { totalStart: '2025-01-17', totalEnd: '2027-12-31' },
    years: [
      { yearNumber: 1, start: '2025-01-17', end: '2025-12-31', months: 12,
        budget: { government: 150000000, privateCash: 5300000, privateInKind: 45000000, total: 200300000 },
        budgetExecution: { executed: 0, planned: 0, unplanned: 200300000, remaining: 200300000 } },
      { yearNumber: 2, start: '2026-01-01', end: '2026-12-31', months: 12,
        budget: { government: 150000000, privateCash: 5300000, privateInKind: 45000000, total: 200300000 },
        budgetExecution: { executed: 0, planned: 0, unplanned: 200300000, remaining: 200300000 } },
      { yearNumber: 3, start: '2027-01-01', end: '2027-12-31', months: 12,
        budget: { government: 150000000, privateCash: 5300000, privateInKind: 45000000, total: 200300000 },
        budgetExecution: { executed: 0, planned: 0, unplanned: 200300000, remaining: 200300000 } },
    ],
    contact: { manager: '', phone: '', email: '' }, excludeReason: '',
  },
];

// ═══ 종료 과제 (CSV에서 추출 — category는 CSV 원본 기준) ═══
// R&D사업: closed_3(울산기술혁신), closed_15(특구육성RD21), closed_16(범부처의료기기),
//          closed_22(규제자유특구실증), closed_32(팁스RD), closed_35(혁신형의료기기), closed_36(중기기술개발RD)
const CLOSED_PROJECTS = [
  { id: 'closed_1', category: '지원사업', shortName: 'U-STARTUP', programName: 'U-STARTUP 성장지원프로그램', projectName: '갑상선기능이상 스마트케어 시스템', agency: '울산광역시/울산 테크노파크', pi: '박재민', period: { totalStart: '2020-07-01', totalEnd: '2020-12-31' }, totalBudget: { government: 10000000, privateCash: 0, privateInKind: 0, total: 10000000 } },
  { id: 'closed_2', category: '지원사업', shortName: '초기창업패키지', programName: '초기창업패키지', projectName: '갑상선기능이상 스마트케어 시스템', agency: '창업진흥원', pi: '박재민', period: { totalStart: '2020-09-01', totalEnd: '2021-03-31' }, totalBudget: { government: 70000000, privateCash: 10000000, privateInKind: 20000000, total: 100000000 } },
  { id: 'closed_3', category: 'R&D사업', shortName: '울산기술혁신', programName: '울산 기술혁신형 중소기업 육성지원사업', projectName: 'AI 및 통계학습 기반 갑상선 기능이상 토탈케어 솔루션 개발', agency: '울산 테크노파크', pi: '박재민', period: { totalStart: '2020-09-01', totalEnd: '2021-06-30' }, totalBudget: { government: 50000000, privateCash: 8572000, privateInKind: 12857000, total: 71429000 } },
  { id: 'closed_4', category: '지원사업', shortName: 'IP투자연계', programName: 'IP투자연계 지식재산평가 지원사업', projectName: '웨어러블 장치를 이용한 갑상선기능항진증의 예측 시스템', agency: '충북창조경제혁신센터', pi: '박재민', period: { totalStart: '2021-02-12', totalEnd: '' }, totalBudget: { government: 12000000, privateCash: 0, privateInKind: 0, total: 12000000 } },
  { id: 'closed_5', category: '지원사업', shortName: '글로벌액셀', programName: '2021년 글로벌 액셀러레이팅 프로그램', projectName: '글랜디(Glandy) - 갑상선 스마트케어 시스템', agency: '창업진흥원', pi: '박재민', period: { totalStart: '2021-03-02', totalEnd: '2021-12-31' }, totalBudget: { government: 25000000, privateCash: 3600000, privateInKind: 7100000, total: 35700000 } },
  { id: 'closed_6', category: '지원사업', shortName: '지식기술창업센터', programName: '2021년 지식기술창업센터 지원기업', projectName: '갑상선기능이상 스마트케어 시스템', agency: '울산 테크노파크', pi: '박재민', period: { totalStart: '2021-04-01', totalEnd: '2021-05-30' }, totalBudget: { government: 4500000, privateCash: 500000, privateInKind: 0, total: 5000000 } },
  { id: 'closed_7', category: '지원사업', shortName: 'AI바우처', programName: '2021년도 AI바우처 지원사업', projectName: 'AI 솔루션 도입을 통한 갑상선기능이상 전주기 스마트 케어 시스템 구축', agency: '정보통신산업진흥원', pi: '신규보', period: { totalStart: '2021-04-01', totalEnd: '2021-10-31' }, totalBudget: { government: 266000000, privateCash: 6650000, privateInKind: 59850000, total: 332500000 } },
  { id: 'closed_8', category: '지원사업', shortName: '기업자율형창업', programName: '기업자율형 창업프로그램 집중스타트업', projectName: '글랜디(Glandy)', agency: '울산테크노파크', pi: '박재민', period: { totalStart: '2021-04-01', totalEnd: '2021-11-30' }, totalBudget: { government: 30000000, privateCash: 3000000, privateInKind: 0, total: 33000000 } },
  { id: 'closed_9', category: '지원사업', shortName: '규제자유특구', programName: '2021년 규제자유특구혁신사업육성 사업화지원사업', projectName: '지능형 오믹스 빅데이터 기반 질병 예측 및 진단 마커 개발 실증', agency: '울산정보산업진흥원', pi: '박재민', period: { totalStart: '2021-04-01', totalEnd: '2021-12-31' }, totalBudget: { government: 17650000, privateCash: 3434000, privateInKind: 0, total: 21084000 } },
  { id: 'closed_10', category: '지원사업', shortName: '해외진출바우처', programName: '2021년 스타트업 해외진출 바우처', projectName: '-', agency: '(사)한국무역협회', pi: '박재민', period: { totalStart: '2021-04-01', totalEnd: '2022-03-31' }, totalBudget: { government: 29400000, privateCash: 12600000, privateInKind: 0, total: 42000000 } },
  { id: 'closed_11', category: '지원사업', shortName: '강소특구산학', programName: '울산울주강소특구 특화성장지원사업 산학공동 R&D', projectName: '안질환 증상 유무 판단을 위한 이미지 분석 모델 개발', agency: '과학기술정보통신부/연구개발특구진흥재단', pi: '안준', period: { totalStart: '2021-08-01', totalEnd: '2021-12-31' }, totalBudget: { government: 61000000, privateCash: 0, privateInKind: 0, total: 61000000 } },
  { id: 'closed_12', category: '지원사업', shortName: '강소특구', programName: '21년 강소특구 특화성장 지원사업', projectName: '갑상선 질환 관리 소프트웨어 시험 평가', agency: '과학기술정보통신부/연구개발특구진흥재단', pi: '안준', period: { totalStart: '2021-08-01', totalEnd: '2021-12-31' }, totalBudget: { government: 15000000, privateCash: 0, privateInKind: 0, total: 15000000 } },
  { id: 'closed_13', category: '지원사업', shortName: 'IPRD전략21', programName: '2021년 하반기 기관연계형 IP R&D 전략지원사업', projectName: '갑상샘 눈병증 위험도 예측시스템', agency: '한국특허전략개발원', pi: '신규보', period: { totalStart: '2021-08-02', totalEnd: '2021-12-20' }, totalBudget: { government: 100000000, privateCash: 14000000, privateInKind: 6000000, total: 120000000 } },
  { id: 'closed_14', category: '지원사업', shortName: '이노폴리스', programName: '2021 울산 울주 강소연구개발특구 이노폴리스 캠퍼스 사업', projectName: '갑상선 질환 스마트케어 시스템', agency: 'UNIST', pi: '박재민', period: { totalStart: '2021-08-10', totalEnd: '2022-02-28' }, totalBudget: { government: 15000000, privateCash: 0, privateInKind: 0, total: 15000000 } },
  { id: 'closed_15', category: 'R&D사업', shortName: '특구육성RD21', programName: '기술이전화사업(2021년 연구개발 특구육성R&D)', projectName: '갑상샘 질환 및 합병증 통합 관리 시스템 연구 개발 및 사업화', agency: '과학기술정보통신부/연구개발특구진흥재단', pi: '신규보', period: { totalStart: '2021-07-01', totalEnd: '2022-06-30' }, totalBudget: { government: 190000000, privateCash: 3500000, privateInKind: 31500000, total: 225000000 } },
  { id: 'closed_16', category: 'R&D사업', shortName: '범부처의료기기', programName: '범부처전주기의료기기연구개발사업', projectName: '갑상선기능이상 스마트케어 시스템 개발', agency: '(재)범부처전주기의료기기연구개발사업단', pi: '박재민', period: { totalStart: '2020-09-01', totalEnd: '2022-12-31' }, totalBudget: { government: 705480000, privateCash: 2228000, privateInKind: 42292000, total: 750000000 } },
  { id: 'closed_17', category: '지원사업', shortName: 'AI노바투스', programName: 'AI 노바투스 아카데미아', projectName: '갑상선 질환 관리를 위한 개인 맞춤형 자가 관리 솔루션', agency: 'UNIST', pi: '김지수', period: { totalStart: '2021-08-01', totalEnd: '2022-12-31' }, totalBudget: { government: 80000000, privateCash: 0, privateInKind: 20000000, total: 100000000 } },
  { id: 'closed_18', category: '지원사업', shortName: 'IP바우처22', programName: '스타트업 지식재산바우처 사업', projectName: '-', agency: '한국특허전략개발원', pi: '박재민', period: { totalStart: '2022-04-29', totalEnd: '2022-10-20' }, totalBudget: { government: 7000000, privateCash: 3000000, privateInKind: 0, total: 10000000 } },
  { id: 'closed_19', category: '지원사업', shortName: '기업자율형22', programName: '2022년 기업자율형 창업프로그램', projectName: '-', agency: '울산테크노파크', pi: '황지현', period: { totalStart: '2022-05-02', totalEnd: '2022-11-30' }, totalBudget: { government: 9000000, privateCash: 1000000, privateInKind: 0, total: 10000000 } },
  { id: 'closed_20', category: '지원사업', shortName: '민간협업', programName: '민간협업 열림창업 활성화 사업', projectName: '-', agency: '울산광역시/울산창조경제혁신센터', pi: '박재민', period: { totalStart: '2022-05-04', totalEnd: '2022-10-31' }, totalBudget: { government: 30000000, privateCash: 0, privateInKind: 0, total: 30000000 } },
  { id: 'closed_21', category: '지원사업', shortName: 'IPRD전략22', programName: 'IP R&D 전략지원사업', projectName: '-', agency: '한국특허전략개발원', pi: '-', period: { totalStart: '2022-07-06', totalEnd: '2022-11-22' }, totalBudget: { government: 100000000, privateCash: 14000000, privateInKind: 6000000, total: 120000000 } },
  { id: 'closed_22', category: 'R&D사업', shortName: '규제자유특구실증', programName: '규제자유특구혁신사업육성 실증 및 기술 개발 사업', projectName: '지능형 오믹스 빅데이터 기반 질병 예측 및 진단 마커 개발 실증', agency: '중소벤처기업부/한국산업기술진흥원', pi: '박재민', period: { totalStart: '2021-01-01', totalEnd: '2022-11-30' }, totalBudget: { government: 308960000, privateCash: 6180000, privateInKind: 55616000, total: 370756000 } },
  { id: 'closed_23', category: '지원사업', shortName: '산학공동RD22', programName: '산학공동 R&D 기술사업화 지원', projectName: '-', agency: 'UNIST', pi: '박재민', period: { totalStart: '2022-10-01', totalEnd: '2023-01-31' }, totalBudget: { government: 60000000, privateCash: 0, privateInKind: 0, total: 60000000 } },
  { id: 'closed_24', category: '지원사업', shortName: '팁스창업사업화', programName: '민관공동 창업자 발굴육성사업 (팁스 창업사업화)', projectName: 'Glandy (갑상선 질환 디지털 헬스케어 솔루션)', agency: '창업진흥원', pi: '박재민', period: { totalStart: '2022-11-01', totalEnd: '2023-08-31' }, totalBudget: { government: 80000000, privateCash: 11440000, privateInKind: 22850000, total: 114290000 } },
  { id: 'closed_25', category: '지원사업', shortName: '팁스해외마케팅', programName: '민관공동 창업자 발굴육성사업 (팁스 해외마케팅)', projectName: 'Glandy (갑상선 질환 디지털 헬스케어 솔루션)', agency: '창업진흥원', pi: '박재민', period: { totalStart: '2022-11-01', totalEnd: '2023-08-31' }, totalBudget: { government: 100000000, privateCash: 14290000, privateInKind: 28570000, total: 142860000 } },
  { id: 'closed_26', category: '지원사업', shortName: '신기술창업', programName: '신기술 창업 활성화 민간지원사업', projectName: '국내 확증 임상을 통한 갑상선 호르몬 수치 예측 기술 고도화', agency: '울산광역시/울산경제진흥원', pi: '박재민', period: { totalStart: '2022-05-01', totalEnd: '2023-11-30' }, totalBudget: { government: 170000000, privateCash: 25500000, privateInKind: 17000000, total: 212500000 } },
  { id: 'closed_27', category: '지원사업', shortName: 'K바이오헬스', programName: '2023년도 K-바이오헬스 지역센터 지원사업', projectName: '갑상선 기능이상 및 안병증 디지털 모니터링 솔루션 Glandy', agency: 'K-바이오헬스 이노베이션 센터', pi: '박재민', period: { totalStart: '2023-04-01', totalEnd: '2023-11-30' }, totalBudget: { government: 25000000, privateCash: 0, privateInKind: 0, total: 25000000 } },
  { id: 'closed_28', category: '지원사업', shortName: 'IPRD전략23', programName: '2023년 상반기 IP R&D 전략지원 사업', projectName: '갑상선 안병증 중증도 관리 시스템의 특허 및 허가 전략 수립', agency: '한국특허전략개발원', pi: '신규보', period: { totalStart: '2023-05-08', totalEnd: '2023-10-23' }, totalBudget: { government: 120000000, privateCash: 7000000, privateInKind: 17000000, total: 144000000 } },
  { id: 'closed_29', category: '지원사업', shortName: '특허분쟁대응', programName: '특허/K-브랜드분쟁 대응전략 지원사업', projectName: '특허분쟁 대응전략 지원사업', agency: '한국지식재산보호원', pi: '박재민', period: { totalStart: '2023-05-22', totalEnd: '2023-07-21' }, totalBudget: { government: 14000000, privateCash: 2000000, privateInKind: 4000000, total: 20000000 } },
  { id: 'closed_30', category: '지원사업', shortName: 'OI사업화', programName: 'Open Innovation 사업화 지원', projectName: '갑상선 질환 디지털 모니터링 솔루션의 사업화', agency: '울산과학기술원', pi: '박재민', period: { totalStart: '2023-07-01', totalEnd: '2023-12-31' }, totalBudget: { government: 20000000, privateCash: 0, privateInKind: 0, total: 20000000 } },
  { id: 'closed_31', category: '지원사업', shortName: '울주군전시회', programName: '울주군 국내외 전시회 개별참가 지원사업', projectName: '-', agency: '울산경제일자리진흥원', pi: '박재민', period: { totalStart: '2023-07-01', totalEnd: '2023-12-31' }, totalBudget: { government: 8250000, privateCash: 0, privateInKind: 0, total: 8250000 } },
  { id: 'closed_32', category: 'R&D사업', shortName: '팁스RD', programName: '팁스(TIPS) R&D', projectName: '갑상선 호르몬 수치 예측 기술 고도화를 통한 환자별 적정 갑상선 약제 복용량 예측 솔루션 개발', agency: '중소벤처기업부', pi: '박재민', period: { totalStart: '2022-05-01', totalEnd: '2024-07-31' }, totalBudget: { government: 500000000, privateCash: 5557000, privateInKind: 50000000, total: 555557000 } },
  { id: 'closed_33', category: '지원사업', shortName: '바이오디지털23', programName: '2023 바이오 디지털 헬스케어 스타트업 글로벌 지원 프로그램', projectName: '-', agency: '울산과학기술원', pi: '박재민', period: { totalStart: '', totalEnd: '2023-12-31' }, totalBudget: { government: 75000000, privateCash: 0, privateInKind: 0, total: 75000000 } },
  { id: 'closed_34', category: '지원사업', shortName: '글로벌성장23', programName: '2023 글로벌 성장진출 창업지원 프로그램', projectName: '-', agency: '울산과학기술원', pi: '박재민', period: { totalStart: '', totalEnd: '2023-12-31' }, totalBudget: { government: 28000000, privateCash: 0, privateInKind: 0, total: 28000000 } },
  { id: 'closed_35', category: 'R&D사업', shortName: '혁신형의료기기', programName: '혁신형 의료기기 기업 기술상용화 지원사업', projectName: '감상선 기능이상 및 안병증 디지털헬스케어 솔루션 독일 국제협력연구', agency: '보건복지부', pi: '문재훈', period: { totalStart: '2022-04-01', totalEnd: '2025-12-31' }, totalBudget: { government: 1375000000, privateCash: 45834000, privateInKind: 412500000, total: 1833334000 } },
  { id: 'closed_36', category: 'R&D사업', shortName: '중기기술개발RD', programName: '중소기업 기술개발(R&D) 지원사업', projectName: '갑상선기능이상 및 안병증 디지털 모니터링 솔루션의 해외시장 진입 연구개발', agency: '중소벤처기업부', pi: '박재민', period: { totalStart: '2023-07-01', totalEnd: '2025-06-30' }, totalBudget: { government: 566000000, privateCash: 14150000, privateInKind: 127350000, total: 707500000 } },
  { id: 'closed_37', category: '지원사업', shortName: '지역SW사업화', programName: '지역SW서비스사업화지원사업', projectName: '건강할 샘 서비스 고도화를 통한 국내 사업화', agency: '울산정보산업진흥원', pi: '박재민', period: { totalStart: '2024-04-01', totalEnd: '2025-12-31' }, totalBudget: { government: 480000000, privateCash: 12000000, privateInKind: 108000000, total: 600000000 } },
  { id: 'closed_38', category: '지원사업', shortName: 'AI디지털전환', programName: '2024년도 AI기반 의료시스템 디지털 전환 지원사업', projectName: '갑상선 질환 디지털 시스템 기반 전국 6개 지역 8개 공공의료기관 디지털 전환 실증 및 확산', agency: '정보통신산업진흥원', pi: '박재민', period: { totalStart: '2024-05-01', totalEnd: '2025-12-31' }, totalBudget: { government: 1870000000, privateCash: 76000000, privateInKind: 685400000, total: 2631400000 } },
  { id: 'closed_39', category: '지원사업', shortName: 'IP스타기업', programName: '2025년 울산지식재산센터 글로벌 IP 스타기업', projectName: '2025년 울산지식재산센터 글로벌 IP 스타기업', agency: '울산상공회의소', pi: '-', period: { totalStart: '', totalEnd: '' }, totalBudget: { government: 70000000, privateCash: 0, privateInKind: 0, total: 70000000 } },
  { id: 'closed_40', category: '지원사업', shortName: '창업도약패키지', programName: '2025년 창업도약패키지(일반형)', projectName: '생체신호 및 디지털이미지 활용 AI기술 기반 갑상선 질환 디지털 모니터링 솔루션 Glandy', agency: '중소기업벤처부', pi: '-', period: { totalStart: '2025-05-01', totalEnd: '2026-02-28' }, totalBudget: { government: 200000000, privateCash: 20000000, privateInKind: 40000000, total: 260000000 } },
  { id: 'closed_41', category: '지원사업', shortName: '서울창업허브', programName: '서울창업허브 공덕 독일 글로벌 진출 프로그램', projectName: '-', agency: '서울경제진흥원', pi: '-', period: { totalStart: '2025-04-25', totalEnd: '2025-11-30' }, totalBudget: { government: 16000000, privateCash: 0, privateInKind: 0, total: 16000000 } },
];

const SeedRunner: React.FC = () => {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const addLog = (msg: string) => setLog(prev => [...prev, msg]);

  const seedEmployees = async () => {
    const now = Timestamp.now();
    addLog(`직원 ${(employeesData as any[]).length}명 시딩 시작...`);

    for (const emp of employeesData as any[]) {
      const docRef = doc(db, 'employees', emp.employeeNumber);
      await setDoc(docRef, {
        name: emp.name,
        position: emp.position,
        department: emp.department,
        employeeNumber: emp.employeeNumber,
        hireDate: emp.hireDate,
        salary: emp.salary,
        insurance: emp.insurance,
        netPay: emp.netPay,
        updatedAt: now,
      });
      addLog(`  ✅ ${emp.name} (${emp.employeeNumber})`);
    }
    addLog(`직원 ${(employeesData as any[]).length}명 완료!`);
  };

  const seedProjects = async () => {
    const now = Timestamp.now();
    const allProjects = [
      ...ACTIVE_PROJECTS.map(p => ({ ...p, status: '진행' as const })),
      ...CLOSED_PROJECTS.map(p => ({
        ...p, status: '종료' as const, category: '지원사업', hostOrg: '타이로스코프',
        participationType: '주관', piRole: '책임', years: [], contact: { manager: '', phone: '', email: '' }, excludeReason: '',
      })),
    ];

    addLog(`과제 ${allProjects.length}건 시딩 시작...`);

    for (const proj of allProjects) {
      const { id, ...data } = proj;
      const docRef = doc(db, 'projects', id);
      await setDoc(docRef, { ...data, createdAt: now, updatedAt: now });
      addLog(`  ✅ [${data.status}] ${(data as any).shortName}`);
    }
    addLog(`과제 ${allProjects.length}건 완료!`);
  };

  const verify = async () => {
    addLog('\n=== 검증 ===');
    const empSnap = await getDocs(collection(db, 'employees'));
    addLog(`employees: ${empSnap.size}건`);

    let totalCompanyBurden = 0;
    empSnap.forEach(d => {
      totalCompanyBurden += d.data().insurance?.totalCompanyBurden || 0;
    });
    addLog(`4대보험 회사부담금 총합: ${totalCompanyBurden.toLocaleString()}원`);

    const projSnap = await getDocs(collection(db, 'projects'));
    let activeCount = 0, closedCount = 0;
    projSnap.forEach(d => {
      if (d.data().status === '진행') activeCount++;
      else closedCount++;
    });
    addLog(`projects: ${projSnap.size}건 (진행 ${activeCount} / 종료 ${closedCount})`);
  };

  const fixClosedBudgets = async () => {
    setRunning(true);
    setLog([]);
    addLog(`종료과제 ${CLOSED_PROJECTS.length}건 추가/수정 시작...`);
    const now = Timestamp.now();
    try {
      for (const proj of CLOSED_PROJECTS) {
        const { id, ...rest } = proj;
        const docRef = doc(db, 'projects', id);
        await setDoc(docRef, {
          ...rest,
          status: '종료',
          category: rest.category || '지원사업',
          hostOrg: '타이로스코프',
          participationType: '주관',
          piRole: '책임',
          years: [],
          contact: { manager: '', phone: '', email: '' },
          excludeReason: '',
          createdAt: now,
          updatedAt: now,
        }, { merge: true });
        const cash = proj.totalBudget.privateCash || 0;
        const inKind = proj.totalBudget.privateInKind || 0;
        addLog(`  ✅ ${proj.shortName}: 정부=${proj.totalBudget.government.toLocaleString()} | 기업=${(cash + inKind).toLocaleString()} | 총=${proj.totalBudget.total.toLocaleString()}`);
      }

      // 검증
      const projSnap = await getDocs(collection(db, 'projects'));
      let activeCount = 0, closedCount = 0, totalGov = 0, totalAll = 0;
      projSnap.forEach(d => {
        const data = d.data();
        if (data.status === '진행') {
          activeCount++;
          (data.years || []).forEach((y: any) => { totalGov += y.budget?.government || 0; totalAll += y.budget?.total || 0; });
        } else {
          closedCount++;
          totalGov += data.totalBudget?.government || 0;
          totalAll += data.totalBudget?.total || 0;
        }
      });
      addLog(`\n=== 검증 ===`);
      addLog(`진행: ${activeCount}건 | 종료: ${closedCount}건 | 총: ${projSnap.size}건`);
      addLog(`누적 정부출연금: ${totalGov.toLocaleString()}원`);
      addLog(`누적 총사업비: ${totalAll.toLocaleString()}원`);
      addLog(`\n✅ 완료!`);
    } catch (err: any) {
      addLog(`❌ 오류: ${err.message}`);
    }
    setRunning(false);
  };

  const seedParticipations = async () => {
    setRunning(true);
    setLog([]);
    const now = Timestamp.now();
    const email = 'seed@system';

    // employees 목록 조회 (이름 → employeeNumber 매핑)
    const empSnap = await getDocs(collection(db, 'employees'));
    const empMap = new Map<string, string>();
    empSnap.forEach(d => { empMap.set(d.data().name, d.data().employeeNumber); });

    addLog(`참여율 ${(participationData as any[]).length}건 시딩 시작...`);
    addLog(`직원 매핑: ${empMap.size}명\n`);

    let seeded = 0;
    const skipped: string[] = [];

    for (const p of participationData as any[]) {
      const empId = empMap.get(p.employeeName);
      if (!empId) {
        if (!skipped.includes(p.employeeName)) skipped.push(p.employeeName);
        continue;
      }

      const docId = `${p.projectId}_${p.employeeName}_${p.year}`;
      const rates = p.monthlyRates as Record<string, number>;
      const vals = Object.values(rates).filter((v: number) => v > 0);
      const avg = vals.length > 0 ? Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length) : 0;

      await setDoc(doc(db, 'yearlyParticipations', docId), {
        id: docId,
        projectId: p.projectId,
        employeeId: empId,
        employeeName: p.employeeName,
        year: p.year,
        role: p.role,
        monthlyRates: rates,
        averageRate: avg,
        updatedAt: now,
        updatedBy: email,
      });
      seeded++;
    }

    addLog(`✅ 시딩 완료: ${seeded}건`);
    if (skipped.length > 0) {
      addLog(`⚠️ 미매칭 스킵 (${skipped.length}명): ${skipped.join(', ')}`);
    }

    // 검증
    const partSnap = await getDocs(collection(db, 'yearlyParticipations'));
    addLog(`\nFirebase yearlyParticipations: ${partSnap.size}건`);
    setRunning(false);
  };

  const runAll = async () => {
    setRunning(true);
    setLog([]);
    try {
      await seedEmployees();
      await seedProjects();
      await verify();
      addLog('\n✅ 전체 시딩 완료!');
    } catch (err: any) {
      addLog(`❌ 오류: ${err.message}`);
    }
    setRunning(false);
  };

  return (
    <div style={{ padding: 32, maxWidth: 800, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 16 }}>Firebase 데이터 시딩</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
        직원 {(employeesData as any[]).length}명 + 과제 {ACTIVE_PROJECTS.length + CLOSED_PROJECTS.length}건을
        Firebase에 입력합니다.
      </p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <button className="btn-primary" onClick={runAll} disabled={running}>
          {running ? '시딩 중...' : '전체 시딩 실행'}
        </button>
        <button className="btn-secondary" onClick={fixClosedBudgets} disabled={running}>
          종료과제 41건 추가/수정
        </button>
        <button className="btn-secondary" onClick={seedParticipations} disabled={running}>
          참여율 데이터 시딩 ({(participationData as any[]).length}건)
        </button>
        <button style={{ padding: '8px 16px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          onClick={async () => {
            if (!window.confirm('K-VIP(암젠)과 TEST 과제를 삭제하시겠습니까?')) return;
            setRunning(true);
            const targets = ['K-VIP(암젠)', 'TEST'];
            const snap = await getDocs(collection(db, 'projects'));
            let deleted = 0;
            for (const d of snap.docs) {
              const data = d.data();
              const name = data.shortName || data.projectName || '';
              if (targets.includes(name)) {
                await deleteDoc(doc(db, 'projects', d.id));
                setLog(prev => [...prev, `🗑️ 삭제: ${name} (ID: ${d.id})`]);
                deleted++;
              }
            }
            setLog(prev => [...prev, `✅ ${deleted}건 삭제 완료`]);
            setRunning(false);
          }}
          disabled={running}>
          🗑️ 중복/오류 과제 정리
        </button>
      </div>
      <pre style={{
        background: '#0F172A', color: '#E2E8F0', padding: 20, borderRadius: 8,
        fontSize: 12, lineHeight: 1.6, maxHeight: 500, overflow: 'auto',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {log.length === 0 ? '버튼을 클릭하면 시딩이 시작됩니다.' : log.join('\n')}
      </pre>
    </div>
  );
};

export default SeedRunner;
