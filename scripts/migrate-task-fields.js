/**
 * Task 필드 마이그레이션 스크립트 (Step 1)
 *
 * 매핑:
 *   memo            → reportNote (1차 베이스)
 *   notes           → reportNote (\n\n 결합)
 *   reportMemo      → reportNote (\n\n 결합)        ※ 실제로는 없을 것 — 발견 시 보고
 *   ceoFlagReason   → reportNote (\n\n + "CEO 보고 사유: " 라벨로 결합)
 *   ceoFlag === true     → reportTo: 'ceo'
 *   ceoFlag === false    → reportTo: null
 *   priority === 'CEO'   → reportTo: 'ceo'           ※ 실제로는 없을 것 — 발견 시 보고
 *
 * 사용법:
 *   node scripts/migrate-task-fields.js              # dry-run (백업 + 변환 시뮬레이션)
 *   node scripts/migrate-task-fields.js --apply      # 실제 적용 (확인 후)
 *
 * 안전장치:
 *   - 항상 시작 시 전체 tasks를 data/backup-tasks-{ts}.json 으로 백업
 *   - dry-run 결과는 data/migration-dryrun-{ts}.json 에 저장
 *   - --apply 시 batch update (500건씩 chunk)
 *   - 기존 필드(memo/notes/ceoFlag/ceoFlagReason)는 삭제하지 않음 (2주 보존)
 *   - lastModifiedBy: "마이그레이션", lastModifiedAt: 현재 시각 기록
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const {
  getFirestore,
  collection,
  getDocs,
  writeBatch,
  doc,
  Timestamp,
} = require('firebase/firestore');

const APPLY = process.argv.includes('--apply');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const BACKUP_PATH = path.join(DATA_DIR, `backup-tasks-${TIMESTAMP}.json`);
const DRYRUN_PATH = path.join(DATA_DIR, `migration-dryrun-${TIMESTAMP}.json`);

const MAX_REPORT_NOTE_LEN = 2000;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function buildReportNote(t) {
  const parts = [];
  const sources = {};

  if (typeof t.memo === 'string' && t.memo.trim()) {
    parts.push(t.memo.trim());
    sources.memo = true;
  }
  if (typeof t.notes === 'string' && t.notes.trim()) {
    parts.push(t.notes.trim());
    sources.notes = true;
  }
  if (typeof t.reportMemo === 'string' && t.reportMemo.trim()) {
    parts.push(t.reportMemo.trim());
    sources.reportMemo = true;
  }
  if (typeof t.ceoFlagReason === 'string' && t.ceoFlagReason.trim()) {
    parts.push('CEO 보고 사유: ' + t.ceoFlagReason.trim());
    sources.ceoFlagReason = true;
  }

  return { reportNote: parts.join('\n\n'), sources };
}

function determineReportTo(t) {
  if (t.priority === 'CEO') return { reportTo: 'ceo', via: 'priority' };
  if (t.ceoFlag === true) return { reportTo: 'ceo', via: 'ceoFlag' };
  return { reportTo: null, via: null };
}

function plainifyTask(raw) {
  const o = { ...raw };
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object' && typeof v.toDate === 'function') {
      o[k] = { __ts: v.toDate().toISOString() };
    }
  }
  return o;
}

async function main() {
  const projectId = process.env.REACT_APP_FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.error('❌ .env에 REACT_APP_FIREBASE_PROJECT_ID 가 없습니다.');
    process.exit(1);
  }
  console.log(`📡 Firebase 프로젝트: ${projectId}`);
  console.log(`🔧 모드: ${APPLY ? '★ APPLY (실제 쓰기) ★' : 'dry-run (읽기 전용)'}`);
  console.log('');

  const app = initializeApp({
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    projectId,
  });
  const db = getFirestore(app);

  // 1. 전체 tasks 읽기
  console.log('1/4  Firestore /tasks 전체 읽기…');
  const snap = await getDocs(collection(db, 'tasks'));
  const tasks = snap.docs.map((d) => ({ taskId: d.id, ...d.data() }));
  console.log(`     → ${tasks.length}건 로드`);

  // 2. 백업 저장
  console.log(`2/4  백업 저장 → ${path.relative(process.cwd(), BACKUP_PATH)}`);
  const backup = tasks.map(plainifyTask);
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`     → ${(fs.statSync(BACKUP_PATH).size / 1024).toFixed(1)} KB`);

  // 3. 변환 시뮬레이션 + 통계
  console.log('3/4  변환 시뮬레이션…');
  const stats = {
    total: tasks.length,
    sourceCounts: {
      memo: 0,
      notes: 0,
      reportMemo: 0,
      ceoFlagReason: 0,
    },
    reportNote: {
      empty: 0,
      from1Source: 0,
      from2Sources: 0,
      from3PlusSources: 0,
      over2000Chars: [],
    },
    reportTo: {
      ceo: 0,
      null: 0,
      viaCeoFlag: 0,
      viaPriority: 0,
    },
    sanity: {
      ceoFlagTrue: 0,
      priorityCeoFound: 0,
      reportMemoFound: 0,
    },
  };

  const transformed = [];
  for (const t of tasks) {
    const { reportNote, sources } = buildReportNote(t);
    const { reportTo, via } = determineReportTo(t);

    if (sources.memo) stats.sourceCounts.memo++;
    if (sources.notes) stats.sourceCounts.notes++;
    if (sources.reportMemo) {
      stats.sourceCounts.reportMemo++;
      stats.sanity.reportMemoFound++;
    }
    if (sources.ceoFlagReason) stats.sourceCounts.ceoFlagReason++;

    const sourceCount = Object.keys(sources).length;
    if (reportNote.length === 0) stats.reportNote.empty++;
    else if (sourceCount === 1) stats.reportNote.from1Source++;
    else if (sourceCount === 2) stats.reportNote.from2Sources++;
    else stats.reportNote.from3PlusSources++;

    if (reportNote.length > MAX_REPORT_NOTE_LEN) {
      stats.reportNote.over2000Chars.push({
        taskId: t.taskId,
        title: t.title || '(제목 없음)',
        length: reportNote.length,
        sources: Object.keys(sources),
      });
    }

    if (reportTo === 'ceo') stats.reportTo.ceo++;
    else stats.reportTo.null++;
    if (via === 'ceoFlag') stats.reportTo.viaCeoFlag++;
    if (via === 'priority') stats.reportTo.viaPriority++;

    if (t.ceoFlag === true) stats.sanity.ceoFlagTrue++;
    if (t.priority === 'CEO') stats.sanity.priorityCeoFound++;

    transformed.push({
      taskId: t.taskId,
      title: t.title,
      before: {
        memo: t.memo || '',
        notes: t.notes || '',
        reportMemo: t.reportMemo || '',
        ceoFlag: t.ceoFlag || false,
        ceoFlagReason: t.ceoFlagReason || '',
        priority: t.priority || '',
      },
      after: { reportNote, reportTo },
    });
  }

  // 4. dry-run 결과 저장
  console.log(`4/4  dry-run 결과 저장 → ${path.relative(process.cwd(), DRYRUN_PATH)}`);
  fs.writeFileSync(
    DRYRUN_PATH,
    JSON.stringify({ stats, transformed }, null, 2),
    'utf8'
  );

  // ─── 콘솔 보고서 ───
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  Step 1 마이그레이션 dry-run 보고서');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  총 task 건수                       : ${stats.total}`);
  console.log('');
  console.log('  [reportNote 출처별 보유 건수]');
  console.log(`    memo (있음)                      : ${stats.sourceCounts.memo}`);
  console.log(`    notes (있음)                     : ${stats.sourceCounts.notes}`);
  console.log(`    reportMemo (있음)                : ${stats.sourceCounts.reportMemo}  (예상: 0)`);
  console.log(`    ceoFlagReason (있음)             : ${stats.sourceCounts.ceoFlagReason}`);
  console.log('');
  console.log('  [reportNote 결합 결과]');
  console.log(`    빈 reportNote (모두 비어있음)    : ${stats.reportNote.empty}`);
  console.log(`    1개 출처 결합                    : ${stats.reportNote.from1Source}`);
  console.log(`    2개 출처 결합                    : ${stats.reportNote.from2Sources}`);
  console.log(`    3개 이상 출처 결합               : ${stats.reportNote.from3PlusSources}`);
  console.log(`    2000자 초과                      : ${stats.reportNote.over2000Chars.length}`);
  if (stats.reportNote.over2000Chars.length > 0) {
    console.log('       └ 초과 taskId 목록:');
    stats.reportNote.over2000Chars.forEach((x) => {
      console.log(`         · [${x.taskId}] "${x.title}" — ${x.length}자 (출처: ${x.sources.join(',')})`);
    });
  }
  console.log('');
  console.log('  [reportTo 변환 결과]');
  console.log(`    reportTo='ceo'                   : ${stats.reportTo.ceo}`);
  console.log(`      └ ceoFlag=true 경유           : ${stats.reportTo.viaCeoFlag}`);
  console.log(`      └ priority='CEO' 경유         : ${stats.reportTo.viaPriority}  (예상: 0)`);
  console.log(`    reportTo=null                    : ${stats.reportTo.null}`);
  console.log('');
  console.log('  [정합성 검증]');
  const parityOK = stats.sanity.ceoFlagTrue === stats.reportTo.viaCeoFlag;
  console.log(`    ceoFlag=true 건수                : ${stats.sanity.ceoFlagTrue}`);
  console.log(`    reportTo='ceo' (via ceoFlag)     : ${stats.reportTo.viaCeoFlag}`);
  console.log(`    → 일치 여부                      : ${parityOK ? '✅ 일치' : '❌ 불일치'}`);
  console.log(`    priority='CEO' 발견 건수         : ${stats.sanity.priorityCeoFound}  ${stats.sanity.priorityCeoFound === 0 ? '✅' : '⚠️ 0이어야 함 — 보고 필요'}`);
  console.log(`    reportMemo 필드 발견 건수        : ${stats.sanity.reportMemoFound}  ${stats.sanity.reportMemoFound === 0 ? '✅' : '⚠️ 0이어야 함 — 보고 필요'}`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  // 적용 모드 분기
  if (!APPLY) {
    console.log('💡 dry-run 모드입니다. 적용하려면:');
    console.log('   1) 백업본을 OneDrive 외부 위치에 추가 복사');
    console.log(`      cp "${path.relative(process.cwd(), BACKUP_PATH)}" <외부 경로>`);
    console.log('   2) 위 보고서 검토 후 사용자 승인');
    console.log('   3) node scripts/migrate-task-fields.js --apply');
    console.log('');
    process.exit(0);
  }

  // ── APPLY ──
  if (!parityOK || stats.sanity.reportMemoFound > 0 || stats.sanity.priorityCeoFound > 0) {
    console.error('❌ 정합성 검증에 이상치가 있어 --apply 를 중단합니다.');
    console.error('   먼저 보고하고 처리 결정을 받으세요.');
    process.exit(1);
  }

  console.log('★ APPLY 시작 — Firestore에 신규 필드 쓰기');
  console.log('   기존 필드(memo/notes/ceoFlag/ceoFlagReason)는 삭제하지 않음 (2주 보존)');
  console.log('');

  const now = Timestamp.now();
  const CHUNK = 450; // 안전 마진
  let written = 0;

  for (let i = 0; i < transformed.length; i += CHUNK) {
    const chunk = transformed.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const t of chunk) {
      batch.update(doc(db, 'tasks', t.taskId), {
        reportNote: t.after.reportNote,
        reportTo: t.after.reportTo,
        lastModifiedBy: '마이그레이션',
        lastModifiedAt: now,
        updatedAt: now,
      });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`   batch ${Math.floor(i / CHUNK) + 1}: ${chunk.length}건 적용 (누적 ${written}/${transformed.length})`);
  }

  console.log('');
  console.log(`✅ 적용 완료: ${written}건`);
  console.log('   다음 단계: Step 2 (Task 타입 + 입력 폼 변경)');
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ 오류:', e);
  process.exit(1);
});
