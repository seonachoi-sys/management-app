const XLSX = require('xlsx');
const file = 'C:\\Users\\seona\\OneDrive\\Desktop\\1.xlsx';
const wb = XLSX.readFile(file);
console.log('시트 목록:', wb.SheetNames);

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  console.log(`\n── 시트: "${sheetName}" (총 ${data.length}행)`);
  data.slice(0, 12).forEach((row, i) => {
    const cells = (Array.isArray(row) ? row : []).slice(0, 16);
    console.log(`  [${i}] ${cells.map((c, j) => `${j}:${String(c).slice(0, 14)}`).join(' | ')}`);
  });
}
