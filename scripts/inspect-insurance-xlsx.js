/**
 * 4대보험 엑셀 파일 구조 점검 스크립트
 * 사용: node scripts/inspect-insurance-xlsx.js
 */
const XLSX = require('xlsx');
const path = require('path');

const FILES = [
  'G:\\내 드라이브\\(주)타이로스코프\\0. 과제관리\\★수행과제\\(공통)_2025년 4대보험료 자료\\2026년\\기본\\2601_고용보험.xlsx',
  'G:\\내 드라이브\\(주)타이로스코프\\0. 과제관리\\★수행과제\\(공통)_2025년 4대보험료 자료\\2026년\\기본\\2601_국민연금.xlsx',
  'G:\\내 드라이브\\(주)타이로스코프\\0. 과제관리\\★수행과제\\(공통)_2025년 4대보험료 자료\\2026년\\기본\\2601_산재보험.xlsx',
];

for (const file of FILES) {
  console.log('\n══════════════════════════════════════════════');
  console.log(`📄 ${path.basename(file)}`);
  console.log('══════════════════════════════════════════════');

  try {
    const wb = XLSX.readFile(file);
    console.log('시트 목록:', wb.SheetNames);

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      console.log(`\n── 시트: "${sheetName}" (총 ${data.length}행)`);

      // 처음 12행 표시
      data.slice(0, 12).forEach((row, i) => {
        const cells = Array.isArray(row) ? row.slice(0, 25) : [];
        console.log(`  [${i}] ${cells.map((c, j) => `${j}:${String(c).slice(0, 18)}`).join(' | ')}`);
      });
      if (data.length > 12) console.log(`  ... (외 ${data.length - 12}행)`);
    }
  } catch (err) {
    console.error('❌ 읽기 실패:', err.message);
  }
}
