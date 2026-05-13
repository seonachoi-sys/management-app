/**
 * CSV 파싱 스크립트 — EUC-KR 인코딩 + 쉼표 포함 숫자 처리
 */
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const DATA_DIR = path.join(__dirname, '../../data');

function readCSV(filename) {
  const filepath = path.join(DATA_DIR, filename);
  const buffer = fs.readFileSync(filepath);
  let text = iconv.decode(buffer, 'cp949');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return text;
}

/** 쌍따옴표 안의 쉼표를 처리하는 CSV 라인 파서 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseNumber(str) {
  if (!str) return 0;
  return parseInt(str.replace(/,/g, '').replace(/"/g, '').trim(), 10) || 0;
}

// ═══ 1. 급여대장 파싱 ═══
function parsePayroll() {
  const text = readCSV('1월급여대장_전체인원.csv.csv');
  const lines = text.split('\n').map(l => parseCSVLine(l));
  const employees = [];
  let i = 0;

  while (i < lines.length) {
    const row = lines[i];
    if (row[0] && /^\d{7}$/.test(row[0].trim())) {
      const row1 = lines[i];
      const row2 = lines[i + 1] || [];
      const row3 = lines[i + 2] || [];

      const emp = {
        employeeNumber: row1[0].trim(),
        name: row1[1].trim(),
        salary: {
          basePay: parseNumber(row1[2]),
          mealAllowance: parseNumber(row1[3]),
          vehicleAllowance: parseNumber(row1[4]),
          researchAllowance: parseNumber(row1[5]),
          childcareAllowance: parseNumber(row1[6]),
          totalPay: 0,
        },
        deductions: {
          nationalPension: parseNumber(row1[9]),
          healthInsurance: parseNumber(row1[10]),
          employmentInsurance: parseNumber(row1[11]),
          longTermCare: parseNumber(row1[12]),
          incomeTax: parseNumber(row1[13]),
          localIncomeTax: parseNumber(row1[14]),
        },
        hireDate: row2[0] ? row2[0].trim() : '',
        position: row2[1] ? row2[1].trim() : '',
        department: row3[1] ? row3[1].trim() : '',
        totalPay: parseNumber(row3[8]),
        otherDeduct1: parseNumber(row3[9]),
        netPay: parseNumber(row3[14]),
      };

      emp.salary.totalPay = emp.totalPay;
      employees.push(emp);
      i += 3;
    } else {
      i++;
    }
  }
  return employees;
}

// ═══ 2. 건강보험 파싱 ═══
function parseHealthInsurance() {
  const text = readCSV('건강보험_1월.csv.csv');
  const lines = text.split('\n').map(l => parseCSVLine(l));
  const result = {};

  for (const row of lines) {
    // 이름 컬럼(5)에 값이 있고, 건강보험금액(16)이 숫자인 행
    const name = (row[5] || '').trim();
    if (!name || name === '합계' || name === '총계') continue;
    const healthVal = parseNumber(row[16]);
    if (healthVal === 0 && parseNumber(row[30]) === 0) continue; // 헤더행 스킵

    const healthInsPersonal = parseNumber(row[16]);
    const longTermCarePersonal = parseNumber(row[20]);
    const totalBothHealth = parseNumber(row[28]); // 건강+요양 합계(본인+회사)

    result[name] = {
      healthInsurance: healthInsPersonal,
      healthInsuranceCompany: healthInsPersonal,
      longTermCare: longTermCarePersonal,
      longTermCareCompany: longTermCarePersonal,
    };
  }
  return result;
}

// ═══ 3. 국민연금 파싱 ═══
function parseNationalPension() {
  const text = readCSV('국민연금_1월.csv.csv');
  const lines = text.split('\n').map(l => parseCSVLine(l));
  const result = {};

  for (const row of lines) {
    if (row[0] && /^\d+$/.test(row[0].trim()) && row[1]) {
      const name = row[1].trim();
      if (name === '합계') continue;
      const personal = parseNumber(row[5]);
      const company = parseNumber(row[6]);
      result[name] = {
        nationalPension: personal,
        nationalPensionCompany: company,
      };
    }
  }
  return result;
}

// ═══ 4. 고용보험 파싱 ═══
function parseEmploymentInsurance() {
  const text = readCSV('고용보험_1월.csv.csv');
  const lines = text.split('\n').map(l => parseCSVLine(l));
  const result = {};

  for (const row of lines) {
    if (row[0] && /^\d+$/.test(row[0].trim()) && row[2]) {
      const name = row[2].trim();
      if (name === '합계') continue;
      // 근로자실업급여(당월): col9, 사업주실업급여(당월): col10, 사업주고안직능(당월): col11
      const workerUnemp = parseNumber(row[9]);
      const companyUnemp = parseNumber(row[10]);
      const companySkill = parseNumber(row[11]);

      result[name] = {
        employmentInsurance: workerUnemp,
        employmentInsCompany: companyUnemp + companySkill,
      };
    }
  }
  return result;
}

// ═══ 5. 산재보험 파싱 ═══
function parseIndustrialAccident() {
  const text = readCSV('산재보험_1월.csv.csv');
  const lines = text.split('\n').map(l => parseCSVLine(l));
  const result = {};

  for (const row of lines) {
    if (row[0] && /^\d+$/.test(row[0].trim()) && row[2]) {
      const name = row[2].trim();
      if (name === '합계') continue;
      const amount = parseNumber(row[9]);
      result[name] = {
        industrialAccident: amount,
      };
    }
  }
  return result;
}

// ═══ 메인 실행 ═══
const payrollData = parsePayroll();
const healthData = parseHealthInsurance();
const pensionData = parseNationalPension();
const empInsData = parseEmploymentInsurance();
const accidentData = parseIndustrialAccident();

console.log(`\n=== 파싱 결과 ===`);
console.log(`급여대장: ${payrollData.length}명`);
console.log(`건강보험: ${Object.keys(healthData).length}명`);
console.log(`국민연금: ${Object.keys(pensionData).length}명`);
console.log(`고용보험: ${Object.keys(empInsData).length}명`);
console.log(`산재보험: ${Object.keys(accidentData).length}명`);

const executives = ['박재민', '문재훈', '안준', '신규보'];

const merged = payrollData.map(emp => {
  const name = emp.name;
  const isExec = executives.includes(name);

  const health = healthData[name] || {};
  const pension = pensionData[name] || {};
  const empIns = isExec ? {} : (empInsData[name] || {});
  const accident = isExec ? {} : (accidentData[name] || {});

  const insurance = {
    nationalPension: pension.nationalPension || emp.deductions.nationalPension,
    nationalPensionCompany: pension.nationalPensionCompany || emp.deductions.nationalPension,
    healthInsurance: health.healthInsurance || emp.deductions.healthInsurance,
    healthInsuranceCompany: health.healthInsuranceCompany || emp.deductions.healthInsurance,
    longTermCare: health.longTermCare || emp.deductions.longTermCare,
    longTermCareCompany: health.longTermCareCompany || emp.deductions.longTermCare,
    employmentInsurance: empIns.employmentInsurance || (isExec ? 0 : emp.deductions.employmentInsurance),
    employmentInsCompany: empIns.employmentInsCompany || 0,
    industrialAccident: accident.industrialAccident || 0,
    totalCompanyBurden: 0,
  };

  insurance.totalCompanyBurden =
    insurance.nationalPensionCompany +
    insurance.healthInsuranceCompany +
    insurance.longTermCareCompany +
    insurance.employmentInsCompany +
    insurance.industrialAccident;

  return {
    employeeNumber: emp.employeeNumber,
    name,
    position: emp.position,
    department: emp.department,
    hireDate: emp.hireDate,
    salary: emp.salary,
    insurance,
    netPay: emp.netPay,
  };
});

console.log(`\n=== 병합 결과: ${merged.length}명 ===\n`);

merged.forEach((emp, i) => {
  console.log(`${i + 1}. ${emp.name} (${emp.employeeNumber}) — ${emp.position} @ ${emp.department}`);
  console.log(`   급여: 기본급 ${emp.salary.basePay.toLocaleString()} | 식대 ${emp.salary.mealAllowance.toLocaleString()} | 차량 ${emp.salary.vehicleAllowance.toLocaleString()} | 연구 ${emp.salary.researchAllowance.toLocaleString()} | 육아 ${emp.salary.childcareAllowance.toLocaleString()} | 지급합계 ${emp.salary.totalPay.toLocaleString()} | 실지급 ${emp.netPay.toLocaleString()}`);
  console.log(`   보험(회사): 국민연금 ${emp.insurance.nationalPensionCompany.toLocaleString()} | 건강 ${emp.insurance.healthInsuranceCompany.toLocaleString()} | 요양 ${emp.insurance.longTermCareCompany.toLocaleString()} | 고용 ${emp.insurance.employmentInsCompany.toLocaleString()} | 산재 ${emp.insurance.industrialAccident.toLocaleString()} | 합계 ${emp.insurance.totalCompanyBurden.toLocaleString()}`);
});

const outputPath = path.join(DATA_DIR, 'employees_parsed.json');
fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2), 'utf-8');
console.log(`\n✅ ${outputPath}에 저장 완료`);
