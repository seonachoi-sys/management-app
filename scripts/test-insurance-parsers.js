/**
 * 4대보험 파일 파싱 테스트 (Node에서 실제 함수 호출)
 * 사용: node scripts/test-insurance-parsers.js
 */
const XLSX = require('xlsx');
const fs = require('fs');

// payrollParserService의 핵심 로직을 inline 복제 (테스트용)

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else current += ch;
  }
  result.push(current.trim());
  return result;
}

function parseNumber(s) {
  if (!s) return 0;
  return parseInt(String(s).replace(/,/g, '').replace(/"/g, ''), 10) || 0;
}

function readFileAsRows(filePath) {
  const ext = filePath.toLowerCase().split('.').pop();
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    return data.map((row) => (Array.isArray(row) ? row : []).map((c) => String(c ?? '').trim()));
  }
  // CSV
  const buffer = fs.readFileSync(filePath);
  let text;
  // CP949 / EUC-KR 처리: Node에는 iconv-lite가 필요. 일단 utf8 시도, 실패 시 fallback
  try {
    text = buffer.toString('utf8');
    // 한글 깨짐 검출 (replacement char가 많으면 EUC-KR 가능성)
    const bad = (text.match(/�/g) || []).length;
    if (bad > 5) {
      // iconv-lite가 있으면 사용, 없으면 latin1 → CP949 변환 시도
      try {
        const iconv = require('iconv-lite');
        text = iconv.decode(buffer, 'cp949');
      } catch {
        text = buffer.toString('latin1'); // 검증용으로 raw 보기만
      }
    }
  } catch {
    text = buffer.toString('utf8');
  }
  return text.split('\n').map((l) => parseCSVLine(l));
}

function buildColumnHeaders(rows) {
  let dataStart = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const c0 = String(rows[i][0] || '').trim();
    if (/^\d+$/.test(c0)) { dataStart = i; break; }
  }
  if (dataStart < 0) dataStart = 1;

  const numCols = Math.max(...rows.slice(0, dataStart).map((r) => (r ? r.length : 0)), 0);
  const headers = [];
  for (let c = 0; c < numCols; c++) {
    const parts = [];
    for (let r = 0; r < dataStart; r++) {
      const cell = String((rows[r] && rows[r][c]) || '').replace(/\s+/g, '');
      if (cell && !parts.includes(cell)) parts.push(cell);
    }
    headers.push(parts.join('|'));
  }
  return headers;
}

function findCol(headers, keywords) {
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c];
    if (keywords.some((k) => h.includes(k.replace(/\s+/g, '')))) return c;
  }
  return -1;
}

function extractDataRows(rows) {
  return rows.filter((r) => /^\d+$/.test(String(r[0] || '').trim()));
}

// ─── 4개 파서 ───
function parseHealth(file) {
  const rows = readFileAsRows(file);
  const headers = buildColumnHeaders(rows);
  const nameCol = findCol(headers, ['성명']);
  const ssnCol = findCol(headers, ['주민번호', '주민등록번호']);
  const noticeCols = [];
  for (let c = 0; c < headers.length; c++) if (headers[c].includes('고지보험료')) noticeCols.push(c);
  const hiCol = noticeCols[0] ?? 13;
  const ltcCol = noticeCols[1] ?? 26;

  const result = [];
  for (const row of extractDataRows(rows)) {
    const name = String(row[nameCol >= 0 ? nameCol : 3] || '').trim();
    if (!name) continue;
    if (ssnCol >= 0 && !/\d{6}-/.test(String(row[ssnCol] || ''))) continue;
    const hi = parseNumber(row[hiCol]);
    const ltc = parseNumber(row[ltcCol]);
    if (hi === 0 && ltc === 0) continue;
    result.push({ name, hi, ltc });
  }
  return { headers: headers.slice(0, 10), nameCol, hiCol, ltcCol, result };
}

function parsePension(file) {
  const rows = readFileAsRows(file);
  const headers = buildColumnHeaders(rows);
  const nameCol = findCol(headers, ['성명', '근로자명']);
  const empCol = findCol(headers, ['근로자기여금']);
  const compCol = findCol(headers, ['사용자부담금']);

  const result = [];
  for (const row of extractDataRows(rows)) {
    const name = String(row[nameCol >= 0 ? nameCol : 1] || '').trim();
    if (!name || name === '합계') continue;
    result.push({
      name,
      emp: parseNumber(row[empCol >= 0 ? empCol : 5]),
      comp: parseNumber(row[compCol >= 0 ? compCol : 6]),
    });
  }
  return { headers: headers.slice(0, 10), nameCol, empCol, compCol, result };
}

function parseEmployment(file) {
  const rows = readFileAsRows(file);
  const headers = buildColumnHeaders(rows);
  const nameCol = findCol(headers, ['근로자명', '성명']);
  const empCol = findCol(headers, ['근로자실업급여']);
  const compEmpInsCol = findCol(headers, ['사업주실업급여']);
  const compStabilityCol = findCol(headers, ['사업주고안', '고안직능']);

  const result = [];
  for (const row of extractDataRows(rows)) {
    const name = String(row[nameCol >= 0 ? nameCol : 2] || '').trim();
    if (!name || name === '합계') continue;
    const emp = parseNumber(row[empCol >= 0 ? empCol : 9]);
    const comp =
      parseNumber(row[compEmpInsCol >= 0 ? compEmpInsCol : 10]) +
      parseNumber(row[compStabilityCol >= 0 ? compStabilityCol : 11]);
    result.push({ name, emp, comp });
  }
  return { headers: headers.slice(0, 14), nameCol, empCol, compEmpInsCol, compStabilityCol, result };
}

function parseAccident(file) {
  const rows = readFileAsRows(file);
  const headers = buildColumnHeaders(rows);
  const nameCol = findCol(headers, ['근로자명', '성명']);
  const compCol = findCol(headers, ['산정보험료']);

  const result = [];
  for (const row of extractDataRows(rows)) {
    const name = String(row[nameCol >= 0 ? nameCol : 2] || '').trim();
    if (!name || name === '합계') continue;
    result.push({ name, comp: parseNumber(row[compCol >= 0 ? compCol : 9]) });
  }
  return { headers: headers.slice(0, 14), nameCol, compCol, result };
}

const BASE = 'G:\\내 드라이브\\(주)타이로스코프\\0. 과제관리\\★수행과제\\(공통)_2025년 4대보험료 자료\\2026년';

const tests = [
  { name: '건강보험 (CSV)', file: BASE + '\\03. 2602_건강보험.csv', fn: parseHealth },
  { name: '국민연금 (XLSX)', file: BASE + '\\기본\\2601_국민연금.xlsx', fn: parsePension },
  { name: '고용보험 (XLSX)', file: BASE + '\\기본\\2601_고용보험.xlsx', fn: parseEmployment },
  { name: '산재보험 (XLSX)', file: BASE + '\\기본\\2601_산재보험.xlsx', fn: parseAccident },
];

for (const t of tests) {
  console.log('\n══════════════════════════════════════════');
  console.log(`📄 ${t.name}`);
  console.log('══════════════════════════════════════════');
  try {
    const out = t.fn(t.file);
    console.log('헤더 매핑 (앞 10):', out.headers);
    console.log('컬럼 인덱스:', Object.fromEntries(Object.entries(out).filter(([k]) => k.endsWith('Col'))));
    console.log(`데이터 ${out.result.length}건 — 처음 5건:`);
    out.result.slice(0, 5).forEach((r) => console.log('  ', r));
  } catch (err) {
    console.error('❌', err.message);
  }
}
