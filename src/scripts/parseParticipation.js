/**
 * 참여율 CSV 파싱 → JSON 생성
 * 2026.csv, 2027.csv 파싱
 */
const fs = require('fs');
const path = require('path');

const CSV_DIR = 'c:/Users/seona/국책과제관리';

function parseRate(s) {
  if (!s || s === '' || s === '0') return 0;
  const str = String(s).replace('%', '').trim();
  const v = parseFloat(str);
  if (isNaN(v)) return 0;
  return Math.round(v); // 이미 % 단위 정수
}

function parseCSV(filename) {
  const text = fs.readFileSync(path.join(CSV_DIR, filename), 'utf-8');
  const lines = text.split('\n').map(l => l.split(','));
  return lines;
}

// ═══ 2026 CSV 파싱 ═══
function parse2026() {
  const lines = parseCSV('과제 참여율 정리 - 2026.csv');
  // Header row 0: 이름,소속,AI 빅테크,...,의료데이터,...,바이오코어,...,인재성장,...
  // Header row 1: ,,책임,유형,1,2,...12,평균,책임,유형,1,2,...12,평균,...
  // Data rows from row 2

  // 2026 과제별 컬럼 오프셋 (0-indexed):
  // AI빅테크: col 2=책임, 3=유형, 4~15=1~12월, 16=평균
  // 의료데이터: col 17=책임, 18=유형, 19~30=1~12월, 31=평균
  // 바이오코어: col 32=책임, 33=유형, 34~45=1~12월, 46=평균
  // 인재성장: col 47=책임, 48=유형, 49~60=1~12월, 61=평균

  const projects = [
    { id: 'AI빅테크', roleCol: 2, typeCol: 3, startCol: 4, endCol: 15 },
    { id: '의료데이터', roleCol: 17, typeCol: 18, startCol: 19, endCol: 30 },
    { id: '바이오코어', roleCol: 32, typeCol: 33, startCol: 34, endCol: 45 },
    { id: '인재성장', roleCol: 47, typeCol: 48, startCol: 49, endCol: 60 },
  ];

  const results = [];
  for (let i = 2; i < lines.length; i++) {
    const row = lines[i];
    const name = (row[0] || '').trim();
    if (!name) continue;

    for (const proj of projects) {
      const role = (row[proj.roleCol] || '').trim();
      const monthlyRates = {};
      let hasAny = false;

      for (let m = 1; m <= 12; m++) {
        const val = parseRate(row[proj.startCol + m - 1]);
        if (val > 0) hasAny = true;
        monthlyRates[String(m)] = val;
      }

      if (!hasAny) continue;
      results.push({
        projectId: proj.id,
        employeeName: name,
        year: 2026,
        role: role === '책임' ? '책임연구원' : '연구원',
        monthlyRates,
      });
    }
  }
  return results;
}

// ═══ 2027 CSV 파싱 ═══
function parse2027() {
  const lines = parseCSV('과제 참여율 정리 - 2027.csv');
  // 2027: AI빅테크, 바이오코어, 인재성장 (의료데이터는 2026에서 종료)
  // AI빅테크: col 2=책임, 3=유형, 4~15=1~12월, 16=평균
  // 바이오코어: col 17=책임, 18=유형, 19~30=1~12월, 31=평균
  // 인재성장: col 32=책임, 33=유형, 34~45=1~12월, 46=평균

  const projects = [
    { id: 'AI빅테크', roleCol: 2, typeCol: 3, startCol: 4, endCol: 15 },
    { id: '바이오코어', roleCol: 17, typeCol: 18, startCol: 19, endCol: 30 },
    { id: '인재성장', roleCol: 32, typeCol: 33, startCol: 34, endCol: 45 },
  ];

  const results = [];
  for (let i = 2; i < lines.length; i++) {
    const row = lines[i];
    const name = (row[0] || '').trim();
    if (!name) continue;

    for (const proj of projects) {
      const role = (row[proj.roleCol] || '').trim();
      const monthlyRates = {};
      let hasAny = false;

      for (let m = 1; m <= 12; m++) {
        const val = parseRate(row[proj.startCol + m - 1]);
        if (val > 0) hasAny = true;
        monthlyRates[String(m)] = val;
      }

      if (!hasAny) continue;
      results.push({
        projectId: proj.id,
        employeeName: name,
        year: 2027,
        role: role === '책임' ? '책임연구원' : '연구원',
        monthlyRates,
      });
    }
  }
  return results;
}

// ═══ 메인 ═══
const data2026 = parse2026();
const data2027 = parse2027();
const allData = [...data2026, ...data2027];

console.log(`2026: ${data2026.length}건`);
console.log(`2027: ${data2027.length}건`);
console.log(`합계: ${allData.length}건`);

// 이름 목록
const names = new Set(allData.map(d => d.employeeName));
console.log(`\n참여 인원: ${names.size}명`);
console.log(Array.from(names).join(', '));

// 샘플 출력
console.log('\n=== 샘플 (박재민 2026) ===');
allData.filter(d => d.employeeName === '박재민' && d.year === 2026).forEach(d => {
  console.log(`  ${d.projectId} (${d.role}): ${JSON.stringify(d.monthlyRates)}`);
});

// JSON 저장
const outputPath = path.join(__dirname, 'participation_parsed.json');
fs.writeFileSync(outputPath, JSON.stringify(allData, null, 2), 'utf-8');
console.log(`\n✅ ${outputPath}에 저장 완료`);
