# Firestore 규칙

## 컬렉션 구조

### 업무관리
| 컬렉션 | 설명 |
|--------|------|
| `/tasks` | 업무 (전체 공유) |
| `/kpis` | KPI |
| `/settings` | 카테고리, 팀원, CEO 미팅 일정 |
| `/meetings` | 회의록 |

### 과제관리
| 컬렉션 | 설명 |
|--------|------|
| `/projects` | 과제 마스터 — years[] 안에 budget, budgetExecution, budgetDetail 포함 |
| `/employees` | 직원 마스터 — 급여(EmployeeSalary), 4대보험(EmployeeInsurance), 직급, 입사일 |
| `/yearlyParticipations` | 연간 참여율 — ID: `{projectId}_{employeeName}_{year}`, monthlyRates 맵 |
| `/participations` | 월별 참여율 (레거시, yearlyParticipations로 이관 중) |
| `/monthlyData/{YYYY-MM}` | 월별 급여/보험 스냅샷 — payroll/insurance 원본 + changeLog |
| `/employeeMemos/{employeeNumber}` | 직원별 메모 |
| `/auditLog` | 데이터 변경 감사 로그 (전체) |

## 공통 필수 규칙
1. 구독은 `onSnapshot` 사용 (get 지양)
2. 업데이트 시 `lastModifiedBy` + `lastModifiedAt` 항상 포함
3. KPI 업데이트 시 반드시 `getDoc`으로 기존 값 읽어서 병합
4. task 삭제 시 KPI `linkedTaskIds` + `taskHistory` orphan 정리
5. status '완료' 변경 시 `leadTimeDays` 자동 계산

## 업무 자동화 로직
- 하위업무 완료 → 형제 전체 확인 → 상위업무 자동 완료
- `lastModifiedBy: "자동완료"`
- 완료된 상위에 하위 추가 시 자동 '진행중' 복귀

## 과제 관리 규칙

### projects 컬렉션
- `years[]` 배열 내부에 연차별 데이터 중첩
- 예산 수정: `getYears()` → 찾기 → 수정 → `saveYears()` 패턴
- `budgetDetail` 없으면 `createDefaultBudgetDetail()`로 초기화
- 과제 정렬: `orderBy('shortName')`

### yearlyParticipations
- 문서 ID: `{projectId}_{employeeName}_{year}` (upsert 방식 — `setDoc`)
- `averageRate` 자동 계산: 0 초과 월만 평균
- 역할: `'책임연구원' | '연구원'`

### monthlyData
- 문서 ID: YYYY-MM (예: "2026-03")
- 구조: `{ payroll: { data, uploadDate }, insurance: { data, uploadDate }, changeLog }`
- 전월 대비 변동 자동 감지 후 changeLog에 기록

### auditLog
- 모든 과제 데이터 변경 시 `logAction()` 호출
- 필드: action, collection, documentId, field, oldValue, newValue, userEmail, createdAt
