# 날짜 계산 규칙

## 필수 헬퍼 함수
```ts
// 날짜 덧셈
const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

// 로컬 날짜 파싱
const parseLocalDate = (dateStr: string) =>
  new Date(dateStr + 'T00:00:00');

// M.DD 포맷
const formatMDD = (date: Date) =>
  `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, '0')}`;
```

## 금지 패턴
- `new Date('YYYY-MM-DD')` — UTC 파싱으로 하루 밀림
- `getDate() + N` — 월말 날짜 오류 (31일 + 1 → NaN 아닌 엉뚱한 값)
- 날짜 하드코딩 금지

## KST 주의
- Firestore Timestamp → `toDate()` 후 사용
- 비교 시 시간 제거: `new Date(date.setHours(0,0,0,0))`

## 과제 관리 날짜 규칙

### yearMonth 형식
- 항상 `YYYY-MM` 문자열 (예: "2026-03")
- 전월 계산: month === 1이면 year-1 + "12"

### 과제 기간 비교
- 과제 연차 범위: `y.start.slice(0,7)` ~ `y.end.slice(0,7)` 로 YYYY-MM 비교
- `isMonthInProject(project, year, month)` 패턴 사용

### 근속 연수 계산
- 퇴직금추계용: `(targetDate - hireDate) / (365.25 * 86400000)`
- hireDate 없으면 0 반환
