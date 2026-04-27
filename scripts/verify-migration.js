/**
 * 마이그레이션 적용 후 검증 (일회성)
 *   1) 지정된 5개 taskId를 Firestore에서 직접 read
 *   2) 전체 카운트 (reportNote/reportTo/기존 4필드)
 */
require('dotenv').config();
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, collection, getDocs } = require('firebase/firestore');

// 사용자 지정 3건 + 검증용 임의 2건 (apply 후 reportTo='ceo' 다른 2건)
const REQUIRED_IDS = [
  'CTxPPRXITDdV4c9Hsy26', // ceoFlagReason 결합
  'eef8Ah80Mfeb7CNmHrx0', // memo + notes 2개 결합
  'AoZ42NM2Qjp5HysGt6lp', // memo 단독
  'FM8E1k62VQxrs5wh3i5t', // ceoFlag=true 추가 표본
  '0QguqsZrQQqfFJVCk4ov', // notes 단독 추가 표본
];

const app = initializeApp({
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);

async function main() {
  console.log('═════════ 1. 샘플 5건 직접 read ═════════\n');

  for (const id of REQUIRED_IDS) {
    const snap = await getDoc(doc(db, 'tasks', id));
    if (!snap.exists()) {
      console.log(`❌ [${id}] 문서 없음`);
      continue;
    }
    const d = snap.data();
    console.log(`📄 [${id}]  "${d.title || ''}"`);
    console.log(`   ── 신규 필드 ──`);
    console.log(`   reportNote     = ${JSON.stringify(d.reportNote)}`);
    console.log(`   reportTo       = ${JSON.stringify(d.reportTo)}`);
    console.log(`   ── 기존 필드 (보존 확인) ──`);
    console.log(`   memo           = ${JSON.stringify(d.memo || '')}`);
    console.log(`   notes          = ${JSON.stringify(d.notes || '')}`);
    console.log(`   ceoFlag        = ${d.ceoFlag}`);
    console.log(`   ceoFlagReason  = ${JSON.stringify(d.ceoFlagReason || '')}`);
    console.log(`   ── 감사 필드 ──`);
    console.log(`   lastModifiedBy = ${JSON.stringify(d.lastModifiedBy)}`);
    console.log(`   lastModifiedAt = ${d.lastModifiedAt?.toDate?.().toISOString?.() || '-'}`);
    console.log('');
  }

  console.log('═════════ 2. 전체 카운트 ═════════\n');
  const allSnap = await getDocs(collection(db, 'tasks'));
  const tasks = allSnap.docs.map((d) => d.data());

  const has = (s) => typeof s === 'string' && s.trim().length > 0;

  const counts = {
    total: tasks.length,
    reportNote: tasks.filter((t) => has(t.reportNote)).length,
    reportNoteFieldExists: tasks.filter((t) => 'reportNote' in t).length,
    reportToCeo: tasks.filter((t) => t.reportTo === 'ceo').length,
    reportToTeam: tasks.filter((t) => t.reportTo === 'team').length,
    reportToBoth: tasks.filter((t) => t.reportTo === 'both').length,
    reportToNull: tasks.filter((t) => t.reportTo === null).length,
    reportToFieldExists: tasks.filter((t) => 'reportTo' in t).length,
    legacy: {
      memo: tasks.filter((t) => has(t.memo)).length,
      notes: tasks.filter((t) => has(t.notes)).length,
      ceoFlagTrue: tasks.filter((t) => t.ceoFlag === true).length,
      ceoFlagReason: tasks.filter((t) => has(t.ceoFlagReason)).length,
    },
  };

  console.log(`  총 task 건수                          : ${counts.total}`);
  console.log('');
  console.log(`  [신규 필드]`);
  console.log(`    reportNote 필드 존재 (전수)         : ${counts.reportNoteFieldExists}  (예상: 171)`);
  console.log(`    reportNote 보유 (비어있지 않음)     : ${counts.reportNote}  (예상: 23)`);
  console.log(`    reportTo 필드 존재 (전수)           : ${counts.reportToFieldExists}  (예상: 171)`);
  console.log(`    reportTo='ceo'                      : ${counts.reportToCeo}  (예상: 3)`);
  console.log(`    reportTo='team'                     : ${counts.reportToTeam}`);
  console.log(`    reportTo='both'                     : ${counts.reportToBoth}`);
  console.log(`    reportTo=null                       : ${counts.reportToNull}  (예상: 168)`);
  console.log('');
  console.log(`  [기존 필드 보존 확인]`);
  console.log(`    memo 보유                           : ${counts.legacy.memo}  (예상: 9)`);
  console.log(`    notes 보유                          : ${counts.legacy.notes}  (예상: 12)`);
  console.log(`    ceoFlag=true                        : ${counts.legacy.ceoFlagTrue}  (예상: 3)`);
  console.log(`    ceoFlagReason 보유                  : ${counts.legacy.ceoFlagReason}  (예상: 3)`);
  console.log('');

  // 자동 판정
  const ok =
    counts.total === 171 &&
    counts.reportNoteFieldExists === 171 &&
    counts.reportNote === 23 &&
    counts.reportToFieldExists === 171 &&
    counts.reportToCeo === 3 &&
    counts.reportToNull === 168 &&
    counts.legacy.memo === 9 &&
    counts.legacy.notes === 12 &&
    counts.legacy.ceoFlagTrue === 3 &&
    counts.legacy.ceoFlagReason === 3;

  console.log(`  ─── 종합 판정: ${ok ? '✅ 모든 카운트 일치' : '❌ 불일치 발견'} ───`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('❌ 오류:', e);
  process.exit(1);
});
