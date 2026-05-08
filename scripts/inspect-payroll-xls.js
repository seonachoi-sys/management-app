/**
 * 급여대장 XLS 파일 구조 점검
 */
const XLSX = require('xlsx');

const file = 'C:\\Users\\seona\\OneDrive\\Desktop\\SWSA0101_02.xls';
const wb = XLSX.readFile(file);
console.log('시트 목록:', wb.SheetNames);

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  console.log(`\n── 시트: "${sheetName}" (총 ${data.length}행)`);

  data.slice(0, 25).forEach((row, i) => {
    const cells = Array.isArray(row) ? row.slice(0, 28) : [];
    console.log(`  [${i}] ${cells.map((c, j) => `${j}:${String(c).slice(0, 14)}`).join(' | ')}`);
  });
  if (data.length > 25) console.log(`  ... (외 ${data.length - 25}행)`);
}
