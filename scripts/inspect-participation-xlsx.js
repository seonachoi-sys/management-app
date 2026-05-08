const XLSX = require('xlsx');
const file = 'C:\\Users\\seona\\OneDrive\\Desktop\\참여율 업데이트 양식.xlsx';
const wb = XLSX.readFile(file);
console.log('시트 목록:', wb.SheetNames);

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  // raw: false (포맷된 텍스트), raw: true (원본 값) 둘 다 보기
  const formatted = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  console.log(`\n── 시트: "${sheetName}" (총 ${formatted.length}행)`);
  console.log('  [F=formatted, R=raw 원본]');

  formatted.slice(0, 15).forEach((row, i) => {
    const rawRow = raw[i] || [];
    const cells = (Array.isArray(row) ? row : []).slice(0, 15);
    cells.forEach((c, j) => {
      const r = rawRow[j];
      const sameLabel = String(c) === String(r) ? '' : ` (raw=${JSON.stringify(r)})`;
      if (j === 0) process.stdout.write(`  [${i}] `);
      else process.stdout.write(' | ');
      process.stdout.write(`${j}:${String(c).slice(0, 12)}${sameLabel.slice(0, 18)}`);
    });
    console.log('');
  });
}
