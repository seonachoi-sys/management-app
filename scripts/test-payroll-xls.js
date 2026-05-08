const XLSX = require('xlsx');

function parseNumber(s) {
  if (!s) return 0;
  return parseInt(String(s).replace(/,/g, '').replace(/"/g, ''), 10) || 0;
}

const file = 'C:\\Users\\seona\\OneDrive\\Desktop\\SWSA0101_02.xls';
const wb = XLSX.readFile(file);
const ws = wb.Sheets[wb.SheetNames[0]];
const lines = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
  .map((row) => (Array.isArray(row) ? row : []).map((c) => String(c ?? '').trim()));

const employees = [];
let i = 0;
while (i < lines.length) {
  const row = lines[i];
  const c0 = String(row[0] || '').trim();
  if (/^\d{7}$/.test(c0)) {
    const row1 = lines[i];
    const row2 = lines[i + 1] || [];
    const row3 = lines[i + 2] || [];
    employees.push({
      employeeNumber: c0,
      name: String(row1[1] || '').trim(),
      basePay: parseNumber(row1[2]),
      mealAllowance: parseNumber(row1[3]),
      vehicleAllowance: parseNumber(row1[4]),
      totalPay: parseNumber(row3[8]),
      nationalPension: parseNumber(row1[9]),
      healthInsurance: parseNumber(row1[10]),
      longTermCare: parseNumber(row1[12]),
      netPay: parseNumber(row3[14]),
      hireDate: String(row2[0] || '').trim(),
      position: String(row2[1] || '').trim(),
      department: String(row3[1] || '').trim(),
    });
    i += 3;
  } else {
    i++;
  }
}

console.log(`총 ${employees.length}명 파싱 완료\n`);
employees.slice(0, 8).forEach((e) => console.log(JSON.stringify(e, null, 0)));
