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
- new Date('YYYY-MM-DD') — UTC 파싱으로 하루 밀림
- getDate() + N — 월말 날짜 오류
- 날짜 하드코딩

## KST 주의
- Firestore Timestamp → toDate() 후 사용
- 비교 시 시간 제거: new Date(date.setHours(0,0,0,0))
