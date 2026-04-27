/**
 * dry-run JSON에서 표본 케이스를 추출 (검증용 일회성)
 *   1) 2개 출처 결합 1건 (모두)
 *   2) ceoFlagReason 결합 모두 (3건)
 *   3) memo 단독 1건 + notes 단독 1건
 */
const fs = require('fs');
const path = require('path');

const files = fs
  .readdirSync(path.resolve(__dirname, '..', 'data'))
  .filter((f) => f.startsWith('migration-dryrun-') && f.endsWith('.json'))
  .sort();
const target = files[files.length - 1];
const filePath = path.resolve(__dirname, '..', 'data', target);
const { transformed } = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const has = (s) => typeof s === 'string' && s.trim().length > 0;

const sourceCount = (b) => {
  let n = 0;
  if (has(b.memo)) n++;
  if (has(b.notes)) n++;
  if (has(b.reportMemo)) n++;
  if (has(b.ceoFlagReason)) n++;
  return n;
};

const twoSource = transformed.filter((t) => sourceCount(t.before) === 2);
const withCeoReason = transformed.filter((t) => has(t.before.ceoFlagReason));
const memoOnly = transformed.filter(
  (t) =>
    has(t.before.memo) &&
    !has(t.before.notes) &&
    !has(t.before.ceoFlagReason) &&
    !has(t.before.reportMemo)
);
const notesOnly = transformed.filter(
  (t) =>
    has(t.before.notes) &&
    !has(t.before.memo) &&
    !has(t.before.ceoFlagReason) &&
    !has(t.before.reportMemo)
);

const fmt = (label, items) => {
  console.log(`\n══════ ${label} (${items.length}건) ══════`);
  items.forEach((t, i) => {
    console.log(`\n[${i + 1}] taskId: ${t.taskId}`);
    console.log(`    title:  ${t.title || '(없음)'}`);
    console.log(`    BEFORE:`);
    console.log(`      memo          = ${JSON.stringify(t.before.memo || '')}`);
    console.log(`      notes         = ${JSON.stringify(t.before.notes || '')}`);
    console.log(`      reportMemo    = ${JSON.stringify(t.before.reportMemo || '')}`);
    console.log(`      ceoFlag       = ${t.before.ceoFlag}`);
    console.log(`      ceoFlagReason = ${JSON.stringify(t.before.ceoFlagReason || '')}`);
    console.log(`      priority      = ${JSON.stringify(t.before.priority || '')}`);
    console.log(`    AFTER:`);
    console.log(`      reportNote    = ${JSON.stringify(t.after.reportNote)}`);
    console.log(`      reportTo      = ${JSON.stringify(t.after.reportTo)}`);
  });
};

fmt('① 2개 출처 결합', twoSource);
fmt('② ceoFlagReason 결합', withCeoReason);
fmt('③-a memo 단독', memoOnly.slice(0, 1));
fmt('③-b notes 단독', notesOnly.slice(0, 1));

console.log(`\n참조 dry-run 파일: ${target}`);
