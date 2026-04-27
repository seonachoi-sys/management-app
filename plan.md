# 회의록 기능 개편 plan.md (v2)

> **목적**: CEO 격주 보고서 및 월간 팀 보고서 가독성·실용성 개선
> **범위**: `MeetingReportPanel.tsx`, `TaskDashboard.tsx`, `TaskForm.tsx`, `TaskCard.tsx`, `EisenhowerMatrix.tsx`, Task 타입, Firestore 마이그레이션
> **작업 원칙**: 단계별 커밋 분리, 각 단계 완료 후 배포 확인
> **갱신 이력**: v1 → v2 (실제 코드베이스 전수 조사 반영, 2026-04-27)

---

## 0. v1 대비 주요 정정 사항

| 항목 | v1 가정 | 실제 |
|---|---|---|
| 메모 필드 구성 | `description` / `memo` / `reportMemo` 3개 | `description` / `notes` / `memo` 3개 (`reportMemo`는 **존재하지 않음**) |
| `memo` 의미 | 일반 메모 | **이미 "보고서 메모" 역할** (1초 debounced auto-save 적용) |
| `notes` 의미 | (언급 없음) | 일반 메모. CEO/지연 항목 reason fallback으로도 사용됨 |
| CEO 보고 플래그 | `priority === 'CEO'` | `priority` enum에 'CEO' 값 **없음**. **`ceoFlag: boolean` + `ceoFlagReason: string`** 별도 존재 |
| `ceoFlag` 부수 효과 | (언급 없음) | `priorityCalculator.ts:54`에서 +10점 우선순위 가산 |

→ 이에 따라 §2 데이터 모델 및 §7 Step 1 마이그레이션 매핑을 전면 갱신.

---

## 1. 변경 범위 정리

| 보고서 화면 | 변경 사항 |
|------------|----------|
| **CEO 격주** | 좌우 분할 (회의록 sticky), 진행/완료/KPI/통계 탭, 카드 가독성, 통계 신규 |
| **월간 팀** | 카테고리별 좌우 분할 (4월 완료 ↔ 5월 진행 예정) |
| **주간 팀** | 디자인은 유지하되 §7 Step 7에서 카드 디자인 통일 |

---

## 2. 데이터 모델 통합

### 2-1. 현재 Task 인터페이스 (전수, `src/types/index.ts`)

```ts
interface Task {
  // 식별/기본
  taskId: string;
  title: string;
  description: string;          // 업무 자체 설명 (불변)
  assignee: string;
  assigneeName: string;
  category: TaskCategory;
  status: TaskStatus;            // '대기' | '진행중' | '완료' | '지연' | '보류'

  // 우선순위 (계산값 — priorityCalculator.ts)
  priority: TaskPriority;        // '긴급' | '높음' | '보통' | '낮음'  ← 'CEO' 없음
  priorityScore: number;
  importance: 'high' | 'normal'; // 매트릭스용 사용자 입력

  // 계층/일정
  parentTaskId: string | null;
  startDate: Timestamp | null;
  dueDate: Timestamp | null;
  completedDate: Timestamp | null;
  progressRate: number;
  leadTimeDays: number | null;

  // KPI / 외부 연동
  kpiLinked: string | null;
  googleTaskId: string | null;

  // ── 본 개편 영향 필드 ──
  notes: string;                 // (제거 예정 → reportNote)
  memo: string;                  // (제거 예정 → reportNote, debounced 1s)
  ceoFlag: boolean;              // (제거 예정 → reportTo)
  ceoFlagReason: string;         // (제거 예정 → reportNote 끝에 라벨로 결합)

  // 반복/감사
  isRecurring: boolean;
  recurrenceRule: RecurrenceRule;
  lastModifiedBy: string | null;
  lastModifiedAt: Timestamp | null;
  isNewDismissed: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}
```

### 2-2. 변경 후 (3필드 신규/조정, 4필드 제거)

```ts
interface Task {
  // ... 위 모든 필드 그대로 (notes/memo/ceoFlag/ceoFlagReason 제외)

  description: string;           // 변경 없음

  reportNote: string;            // ★ 신규
  // 회의록 노출용 진행상황/이슈/결정필요사항/CEO 보고 사유 통합 필드
  // memo + notes + ceoFlagReason 흡수
  // debounced 1s auto-save 유지 (기존 memo의 동작 그대로)

  reportTo: 'ceo' | 'team' | 'both' | null;  // ★ 신규
  // null = 회의록 노출 안 함
  // ceoFlag === true → 'ceo'
  // ceoFlag === false → null (사용자가 명시 선택)
  // 기본값: 신규 등록 시 'team' (§9 위험완화 항목과 일치)

  // priority enum: 'CEO' 값이 없었으므로 변경 없음
  // priorityCalculator.ts: ceoFlag 분기 → reportTo === 'ceo' || reportTo === 'both' 분기로 교체
}
```

### 2-3. 마이그레이션 매핑표 (확정)

| 기존 필드 | 신규 필드 | 결합 규칙 |
|---|---|---|
| `memo` | `reportNote` | 1차 베이스 (그대로 대입) |
| `notes` | `reportNote` | 비어있지 않으면 `\n\n` + 원문 추가 |
| `ceoFlagReason` | `reportNote` | 비어있지 않으면 `\n\nCEO 보고 사유: ` + 원문 추가 |
| `ceoFlag === true` | `reportTo: 'ceo'` | |
| `ceoFlag === false` | `reportTo: null` | (신규 등록 폼 기본값은 'team', 기존 데이터는 null로 안전하게) |
| `priority === 'CEO'` | (해당 없음) | 실제 데이터에 존재하지 않으므로 변환 대상 0건. dry-run에서 카운트만 검증. |

**제거 대상**: `memo`, `notes`, `ceoFlag`, `ceoFlagReason`
**보존 정책**: 마이그레이션 직후 즉시 삭제하지 **않음**. 2주 동안 4개 필드를 함께 유지(읽기 미사용, 쓰기 미수행). §7 Step 8에서 별도 작업으로 일괄 삭제.

### 2-4. 영향 받는 파일 (전수, 14개)

| 파일 | 영향 내용 |
|---|---|
| `src/types/index.ts` | Task 인터페이스 변경 |
| `src/services/taskService.ts` | create/update 로직, 기본값, lastModifiedBy 패턴 |
| `src/utils/priorityCalculator.ts` | `task.ceoFlag` → `reportTo` 기반 가산 |
| `src/utils/csvImport.ts` | CSV → Task 매핑에서 메모/플래그 칼럼 처리 |
| `src/task-manager/TaskForm.tsx` | 입력 폼 3필드 → 2필드(+reportTo 라디오) 재구성 |
| `src/task-manager/TaskCard.tsx` | `task.memo`, `task.ceoFlag` 표시부 |
| `src/task-manager/TaskDashboard.tsx` | 매트릭스 드래그 시 `ceoFlag` 업데이트 (line 1030) |
| `src/task-manager/EisenhowerMatrix.tsx` | `ceoFlag`, `notes` 사용 (line 53, 93, 106) |
| `src/task-manager/MeetingReportPanel.tsx` | 좌우 분할, 카드 리뉴얼, 통계 탭 신규 |
| `src/task-manager/MeetingReportPanel.css` | 좌우 분할/카드 스타일 |
| `src/hooks/useMeetingReport.ts` | ceoDecisionItems 필터 변경, reason 매핑 |
| `src/hooks/useMigration.ts` | 레거시 마이그레이션 시 신규 필드로 직접 생성 (구필드 거치지 않게) |
| `src/services/obsidianService.ts` | 메모 export 시 reportNote 사용 |
| `src/services/googleTasksService.ts` | Google Tasks 연동 시 메모 매핑 |
| `src/services/meetingLogService.ts` | 회의록 저장 시 reportNote 참조 |

> 위에 명시되지 않은 필드/파일이 마이그레이션 또는 구현 중 추가로 발견되면 **즉시 별도 보고**하고 처리 결정 받음.

---

## 3. 업무 입력 화면 (`TaskForm.tsx`)

```
┌─ 업무 정보 ─────────────────────────────────┐
│ 업무명: [_______________]                  │
│ 카테고리: [___▼] 담당자: [___▼]            │
│ 착수일: [___] 마감일: [___]                │
│                                            │
│ 상세 내용 (description)                    │
│ [업무 자체에 대한 설명을 적어주세요]       │
│ [____________________________________]    │
│                                            │
│ ─── 📋 회의록 노출 영역 ────────────────── │
│                                            │
│ 회의록 메모 (reportNote)  ⚡ 자동 저장      │
│ 💡 여기 작성한 내용이 회의록에 노출됩니다  │
│ [진행상황 / 이슈 / 결정 필요 / CEO 사유]   │
│ [____________________________________]    │
│                                            │
│ 어느 회의에 보고? (reportTo)               │
│ ○ 보고 안 함  ● 팀 주간   ○ CEO 격주     │
│ ○ 둘 다                                   │
└────────────────────────────────────────────┘
```

- 신규 등록 시 `reportTo` 기본값 = `'team'` (격주 미선택 시에도 주간에는 노출)
- 입력 폼 4필드(description/memo/notes/ceoFlag) → **3필드(description/reportNote/reportTo)**로 단순화
- "회의록 노출 영역"을 시각 경계선으로 분리

---

## 4. CEO 격주 보고서 레이아웃

### 4-1. 전체 구조 (좌우 35:65 분할)

```
┌──────────────────────┬─────────────────────────────┐
│ 회의록 작성 (sticky) │ 업무 데이터                  │
│ ─────────────────    │ [진행][완료][KPI][통계]      │
│ • 의제               │                            │
│ • 결정사항           │ ▼ 진행 업무 (8건)            │
│ • 액션아이템         │   ┌── 카드 ──────┐         │
│                      │   └─────────────┘         │
│ [복사][인쇄][저장]    │   ...                       │
│                      │                            │
│ width: 35%           │   width: 65%                │
└──────────────────────┴─────────────────────────────┘
```

### 4-2. 좌측 회의록 작성 영역 — 템플릿 + 체크리스트

기본 템플릿(편집 가능):
- 📌 의제
  - [ ] (의제 1)
- ✅ 결정사항
  - [ ]
- 🎯 액션아이템 (담당/기한)
  - [ ]

### 4-3. 업무 카드 디자인 (가독성 강조)

```
┌[인사] 매뉴얼 개선 ────── 최선아 · 4.30 ──┐
│ 🎯 직원 행동강령 v2 작성 및 검토 의뢰    │
│ ┌──────────────────────────────────────┐ │
│ │ 💬 법무 검토 완료, 5/2 게시 예정.     │ │
│ │    노무사 의견 반영 여부 결정 필요.   │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

- 상단: 카테고리 배지 + 업무명 + 담당자/마감
- 중단: description (회색 톤, 1~2줄)
- 하단: reportNote (강조 박스, 핵심 정보)

### 4-4. 탭별 데이터 기준

| 탭 | 필터 |
|----|------|
| **진행** | `status === '진행중'` && `reportTo IN ('ceo','both')` && `dueDate ≤ 다음 미팅일` |
| **완료** | `completedDate ∈ [직전 미팅일, 다음 미팅일]` && `reportTo IN ('ceo','both')` |
| **KPI** | 해당 2주 기간 담당자별 KPI 달성률 (기존 유지) |
| **통계** | §5 참조 |

---

## 5. 통계 탭 (CEO 한정 표시) — 4종 모두 구현

| 지표 | 시각화 | 산식 |
|------|-------|------|
| **카테고리별 평균 리드타임** | 가로 막대 | `avg(completedDate - createdAt)` 카테고리별 |
| **완료 속도 분포** | 도넛 | 조기(마감 전) / 정시(±2일) / 지연(마감 초과) 비율 |
| **담당자별 부하 추이** | 라인 (주차별) | 진행중 업무 수 시계열 |
| **카테고리별 완료 건수** | 세로 막대 | 최근 8주 카테고리별 완료 건수 |

### 데이터 부족 시 처리

```
"최소 4주 데이터 누적 후 의미 있는 통계가 표시됩니다"
```

빈 차트보다는 안내 메시지로 graceful degradation.

### 라이브러리 — CSS + SVG 직접 구현 (확정)

`.claude/rules/css.md` "외부 차트 라이브러리 금지" 규칙 준수. recharts 등 외부 차트 라이브러리 미사용.

### 차트별 구현 방식

**컴포넌트 분리** (`src/components/charts/`):
- `LeadTimeChart.tsx` — 가로 막대
- `CompletionRateDonut.tsx` — 도넛
- `WorkloadLineChart.tsx` — 라인
- `CategoryBarChart.tsx` — 세로 막대

`StatisticsPanel.tsx`에서 4개 컴포넌트 조합.

**1. 카테고리별 평균 리드타임 (가로 막대)**
- SVG 불필요 — `div + flex + width%`로 충분
- 행 구조: `[카테고리 라벨] [bar(채워진 div)] [n일]`
- bar 색상은 카테고리별 디자인 토큰
- 비어있으면 "데이터 누적 중" 표시

**2. 완료 속도 분포 (도넛)**
- SVG `<circle>` + `stroke-dasharray` 활용
- 3개 세그먼트: 조기(success #3B6D11) / 정시(info #185FA5) / 지연(danger #A32D2D)
- 중앙: 총 건수 + 지연율 %
- 범례: 도넛 우측 (색상 + 라벨 + 건수/비율)

**3. 담당자별 부하 추이 (라인, 주차별)**
- SVG `<polyline>`
- 그리드: 가로 점선 (y축 5단계)
- x축: 주차 라벨 (M.DD)
- 라인 3개 (담당자별), 색상 구분
- 데이터 점: SVG `<circle r="3">`

**4. 카테고리별 완료 건수 (세로 막대)**
- SVG `<rect>` 또는 `div + height%`
- 카테고리당 막대 + 상단에 숫자
- x축 라벨 회전 또는 줄바꿈

**공통 규칙**
- ResponsiveContainer 패턴 직접 구현: 부모 `width: 100%`, ResizeObserver로 폭 측정 후 SVG `viewBox` 조정
- 색상은 `.claude/rules/css.md`의 디자인 토큰만 사용
- 폰트 11~13px (CSS 규칙)

---

## 6. 월간 팀 보고서 레이아웃

### 6-1. 좌우 분할 (카테고리 기반, 담당자별 그룹화 X)

```
┌──────────────────────────┬─────────────────────────┐
│ 📊 4월 완료 업무 (32건) │ 📊 5월 진행 예정 (28건) │
│ ─────────────────────    │ ──────────────────────  │
│ ▼ 인사 (8건)             │ ▼ 인사 (5건)            │
│   📌 채용 프로세스 개편  │   📌 평가제도 도입      │
│      ↳ JD 템플릿 작성    │      ↳ 평가표 수정안   │
│        (송은정)          │        (최선아)         │
│      ↳ 면접관 교육       │      ↳ 평가 시스템 검토 │
│        (최선아)          │        (송은정)         │
│ ▼ 회계/세무 (7건)        │ ▼ 회계/세무 (6건)       │
│ ▼ 과제 (5건)             │ ▼ 과제 (4건)            │
│ ▼ 매출 (4건)             │ ▼ 매출 (3건)            │
│ ▼ 재무/자금 (4건)        │                         │
│ ▼ 예산 (4건)             │                         │
└──────────────────────────┴─────────────────────────┘
```

### 6-2. 데이터 기준

| 영역 | 필터 |
|------|------|
| **좌측 (전월 완료)** | `completedDate ∈ 전월 1일 ~ 말일` && `reportTo IN ('team','both')` |
| **우측 (당월 진행)** | `dueDate ∈ 당월 1일 ~ 말일` && `status IN ('진행중','대기')` && `reportTo IN ('team','both')` |

### 6-3. 그룹핑 규칙

1. **1차 그룹**: 카테고리 (인사 / 총무 / 회계·세무 / 과제 / 매출 / 재무·자금 / 예산)
2. **2차 표시**: 상위업무 (📌 아이콘)
3. **3차 표시**: 하위업무 (↳ 들여쓰기)
4. **담당자**: 카드 우측 상단 흐린 글씨로만

---

## 7. 작업 단계 (Claude Code 실행)

각 단계 완료 후 **개별 커밋**, 배포 확인 후 다음 단계.

### Step 1: 데이터 마이그레이션 (가장 위험 — 백업 필수)

**준비**
- Firestore `/tasks` 컬렉션 JSON 백업
- 백업본을 OneDrive 폴더 외부에도 한 부 복사 (예: `~/Desktop/management-app-backup/` 또는 외장 경로)

**스크립트**
- `scripts/migrate-task-fields.ts` 신규 작성 (admin SDK 또는 firebase-tools)
- **dry-run 모드 우선 실행** — 변환 결과를 `migration-dryrun-{timestamp}.json`으로 저장

**dry-run 보고서 필수 항목 (사용자에게 먼저 보여주고 승인 후 적용)**
- 전체 task 건수
- `reportNote`로 결합된 건수 (memo/notes/ceoFlagReason 출처별)
- **빈 reportNote가 되는 건수** (모든 출처 빈 값 — 정상 케이스이지만 모수 확인용)
- **결합 후 2000자 초과 건수** (목록 + taskId 노출, 잘림 위험 검토)
- `reportTo='ceo'`로 변환되는 건수 (= 기존 ceoFlag true 건수와 일치 확인)
- `priority === 'CEO'` 발견 건수 (예상: 0건. 0이 아니면 즉시 보고)

**실행**
- 사용자 승인 → 본 적용
- 적용 직후 임의 표본 10건 손수 검증

**커밋 1-A**: 마이그레이션 스크립트 + dry-run 결과 (코드/스크립트만)
**커밋 1-B**: (실데이터 적용은 Firestore에서, 커밋 없음)

### Step 2: Task 타입 + 입력 폼

- `types/index.ts`: `reportNote`, `reportTo` 추가. **기존 4필드(memo/notes/ceoFlag/ceoFlagReason)는 optional로 유지** (2주 보존)
- `services/taskService.ts`: create/update에서 신규 필드 사용. 기존 4필드는 빈 값으로 기본 세팅
- `utils/priorityCalculator.ts`: `task.ceoFlag` → `task.reportTo === 'ceo' || task.reportTo === 'both'`로 교체
- `task-manager/TaskForm.tsx`: 입력 폼 §3 형태로 재구성. memo의 debounced 로직을 reportNote에 그대로 적용
- `hooks/useMigration.ts`: 레거시 import 시 신규 필드로 직접 매핑

**커밋 2**: feat(task): reportNote/reportTo 도입

### Step 3: 카드/매트릭스 표시부 정리

- `TaskCard.tsx`: `task.memo` → `task.reportNote`, `task.ceoFlag` → `task.reportTo === 'ceo'`
- `EisenhowerMatrix.tsx`: 동일 (line 53, 93, 106-107)
- `TaskDashboard.tsx`: 매트릭스 드래그 시 `ceoFlag` 업데이트 → `reportTo` 업데이트로 (line 1030 수정)
- `services/obsidianService.ts`, `googleTasksService.ts`: 메모 매핑 변경

**커밋 3**: refactor(ui): reportNote/reportTo 표시부 정리

### Step 4: CEO 격주 좌우 분할 + 탭 (통계 제외)

- `MeetingReportPanel.tsx` 레이아웃 좌우 분할
- 좌측 sticky 회의록 작성 영역 + 템플릿 + 체크리스트
- 우측 진행/완료/KPI 탭
- 카드 디자인 신규 (TaskCard와는 별도 컴포넌트로 — `ReportTaskCard.tsx`)

**커밋 4**: feat(report): CEO 격주 좌우 분할 + 탭 + 카드 리뉴얼

### Step 5: 통계 탭 구현

- `StatisticsPanel.tsx` 신규 또는 MeetingReportPanel 내부 분할
- 차트 4종 (recharts 또는 CSS+SVG, §8에서 결정)
- 데이터 부족 시 안내 메시지

**커밋 5**: feat(report): 통계 탭 4종 차트

### Step 6: 월간 보고서 카테고리 기반 좌우 분할

- 월간 뷰 좌우 50:50
- 카테고리 → 상위업무 → 하위업무 트리
- 담당자는 우측 흐린 글씨
- 인쇄 시 한 페이지 비교 가능하게 `@media print`

**커밋 6**: feat(report): 월간 보고서 카테고리 좌우 분할

### Step 7: 주간 보고서 카드 디자인 통일

- 주간 뷰의 업무 표시를 §4-3 카드 디자인으로 통일
- 주간 전용 필터(`reportTo IN ('team','both')` && `dueDate 이번 주`)는 유지

**커밋 7**: refactor(report): 주간 보고서 카드 통일

### Step 8: 기존 필드 삭제 (Step 1로부터 2주 후)

- 운영 안정성 확인 후
- `types/index.ts`에서 `memo`, `notes`, `ceoFlag`, `ceoFlagReason` 제거
- 일회성 cleanup 스크립트로 Firestore에서 4개 필드 일괄 삭제 (`FieldValue.delete()`)
- 모든 참조 파일에서 잔존 코드 제거 확인 (TypeScript 빌드로 검증)

**커밋 8**: chore(task): 레거시 메모/CEO 필드 삭제

---

## 8. 의사결정 결과 (확정)

| # | 항목 | 결정 |
|---|------|-----|
| 1 | 좌측 회의록 영역 폭 | **35%** (35:65) |
| 2 | 회의록 작성 영역 템플릿 + 체크리스트 | **포함** (의제/결정사항/액션아이템) |
| 3 | 통계 차트 종류 | **4종 모두** (리드타임/완료속도/부하추이/카테고리별 완료건수) |
| 4 | 기존 필드 즉시 삭제 | **2주 보존 후 삭제** (Step 8 별도 작업) |
| 5 | 주간 보고서 카드 디자인 통일 | **통일** (Step 7) |
| 6 | `notes` 필드 처리 | **reportNote에 흡수** |
| 7 | `ceoFlagReason` 처리 | **reportNote 끝에 라벨로 결합** |
| 8 | 차트 라이브러리 | **CSS + SVG 직접 구현** (`.claude/rules/css.md` 규칙 준수, recharts 미사용, 컴포넌트 4개 분리 — §5 참조) |

---

## 9. 위험 요소 / 안전장치

| 위험 | 대응 |
|------|------|
| 마이그레이션 중 데이터 유실 | Firestore JSON 백업 + **OneDrive 외부 추가 카피** + dry-run 결과 사용자 승인 + 2주 기존 필드 보존 |
| dry-run에서 미상의 변환 케이스 발견 | 빈/2000자 초과/0이 아닌 priority='CEO' 등 별도 카운트 필수 |
| 좌우 분할이 모바일에서 깨짐 | `@media (max-width: 768px)` 세로 스택 |
| 통계 탭 데이터 부족 | 안내 메시지로 graceful degradation |
| OneDrive sync git 충돌 | 각 단계 시작 전 `git pull` + `git status` 확인 |
| `reportTo` 미입력 시 회의록 누락 | 신규 등록 폼 기본 'team', 마이그레이션 기존 데이터 null (안전 우선) |
| 우선순위 가산 로직 변경 | priorityCalculator 단위 테스트 (가능하면) — ceoFlag → reportTo 매핑 후 score 동일 확인 |

---

## 10. 코딩 규칙 재확인 (CLAUDE.md)

- T00:00:00 로컬 날짜 파싱
- `addDays()` helper 사용
- Firestore KPI 업데이트 시 기존 값 머지 (`getDoc` → 머지 → `setDoc`)
- `completedDate`는 편집 시 보존
- TypeScript 타입 정의 철저
- 기존 코드 보호: 수정 전 파일 구조 파악 필수
- `lastModifiedBy` + `lastModifiedAt` 모든 update에 포함
- 상태 UI 완비 (로딩 / 에러 / 데이터 없음)
- 한국어 UI 유지
