const XLSX = require('xlsx');
const file = 'G:\\공유 드라이브\\경영관리팀_(구. 사업본부_관리파트)\\07. 과제\\★최선아 수행과제\\2027.12.31_AI빅테크\\2. 2026년 사업비 집행\\0. 내부인건비\\2026 AI빅테크 참여연구원현황.xlsx';
const wb = XLSX.readFile(file);
console.log('시트 목록:', wb.SheetNames);

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  console.log(`\n══════ 시트: "${sheetName}" (총 ${data.length}행) ══════`);
  data.slice(0, 30).forEach((row, i) => {
    const cells = (Array.isArray(row) ? row : []).slice(0, 14);
    console.log(`  [${i}] ${cells.map((c, j) => `${j}:${String(c).slice(0, 14)}`).join(' | ')}`);
  });
  if (data.length > 30) console.log(`  ... (외 ${data.length - 30}행)`);
}
