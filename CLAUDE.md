# 경영관리팀 업무관리 웹앱 - CLAUDE.md

## 프로젝트 개요

경영관리팀 팀장이 팀원 업무를 통합 관리하는 웹앱.
업무 등록/추적, KPI 관리, 회의 자료 자동 생성이 핵심 목적.

- **배포 URL**: https://seonachoi-sys.github.io/management-app/
- **GitHub**: https://github.com/seonachoi-sys/management-app
- **기술 스택**: React + TypeScript + Firebase Firestore + GitHub Pages
- **프로젝트 경로**: `C:/Users/seona/OneDrive/Desktop/management-app`

---

## 팀 구성

- **팀원**: 최선아, 송은정, 이웅해
- **업무 카테고리**: 인사, 총무, 회계/세무, 과제, 매출, 재무/자금, 예산

---

## 탭 구성 순서

KPI → 업무관리 → 매트릭스 → 보고서 → 설정

---

## 주요 기능 (현재 구현됨)

### 업무 관리 탭 (`TaskDashboard.tsx`)
- 상위업무 / 하위업무 계층 구조
- 담당자, 착수일, 종료일, 진행상태 관리
- 업무 우선순위 자동 배정 (마감 임박 + 진행률 낮음 → 1순위)
- 개인별 업무 부하량 자동 계산 (적정 / 다소많음 / 과부하)
- 지연업무 자동 감지 (마감일 초과 시 빨간 표시)
- 전월 미완료 업무 이월 표시

### 아이젠하워 매트릭스 탭 (`EisenhowerMatrix.tsx`)
- 긴급×중요 4분면 분류
- dnd-kit 드래그앤드롭으로 사분면 간 이동
- 드래그 시 Firestore 우선순위 자동 업데이트

### KPI 탭 (`KpiPanel.tsx`)
- 상위 KPI / 하위 KPI 계층 구조
- 기간 선택: 월간 / 분기 / 반기 / 연간
- 달성률 자동 계산 (하위 KPI 평균 → 상위 KPI 자동 반영)
- 업무와 KPI 연동 (업무 완료 시 KPI 현재값 자동 +1)
- KPI 대시보드: 기간별 달성률 추이 차트, 팀원별 KPI 담당 건수

### 보고서 자동 생성 (`MeetingReportPanel.tsx`)

#### 주간 보고서 (팀 미팅용) — 매주 월요일 기준
| 섹션 | 데이터 기준 |
|------|------------|
| 이번 주 진행 업무 | status === '진행중' && dueDate 이번 주, 담당자별 그룹 |
| 이번 주 완료 업무 | completedAt이 이번 주인 것 |
| 차주 진행 예정 | dueDate가 다음 주인 것, 우선순위 순 |
| 차주 이월 업무 | 미완료 && dueDate < 오늘, 지연일수 표시 |
| KPI 진행 현황 | 이번 주 기준 담당자별 KPI 달성률 |

#### 2주 보고서 (대표이사 보고용) — 격주 고정 일정 기준
- **미팅 일정**: 3/26 → 4/9 → 4/23 … (격주 수요일, 설정에서 관리)
- 보고서 기간: 직전 미팅일 ~ 다음 미팅일 사이
- 상단에 "3.12 ~ 3.26 대표이사 보고" 형태로 기간 표시

| 섹션 | 데이터 기준 |
|------|------------|
| 2주간 완료 업무 | 직전 미팅일 이후 완료된 것, 카테고리별 요약 |
| 앞으로 2주 진행 업무 | 다음 미팅일까지 마감인 업무, 마감일 + 담당자 |
| 결정 필요 사항 | priority === 'CEO' 또는 status === '보류' |
| KPI 달성 현황 | 해당 2주 기간 팀원별 KPI 달성률 |

#### 월간 보고서 (팀 전체 회의용) — 전월 1일~말일 기준
| 섹션 | 데이터 기준 |
|------|------------|
| 전월 완료 업무 | 카테고리별 완료 건수 + 전체 완료율 |
| 이월 업무 | 전월 미완료 → 당월 이월, 지연/보류 상태 기준 |
| 당월 신규 업무 | createdAt 기준 이번달 새로 등록된 것 |
| ~~KPI 섹션~~ | 월간 보고서에는 KPI 없음 |

#### 공통 UI
- 보고서 상단 기간 자동 표시
- 각 섹션 아코디언 (접기/펼치기)
- 인쇄 / 복사 버튼
- Obsidian 저장 연동 유지 ✅
- 업무 없는 섹션은 "해당 없음" 표시

### 설정 탭 (`SettingsPanel.tsx`)
- 업무 분류(카테고리) 추가/삭제
- KPI 분류 추가/삭제
- 팀원 추가/수정/비활성화
- **대표이사 미팅 일정 관리** (격주 날짜 목록, 2주 보고서 기준일로 사용)
- 변경 시 앱 전체 즉시 반영 (Firestore 실시간 구독)

---

## 데이터 구조 (Firestore)

| 컬렉션 | 설명 |
|--------|------|
| `/tasks` | 업무 데이터 |
| `/kpis` | KPI 데이터 |
| `/settings` | 카테고리, 팀원, 대표이사 미팅 일정 |
| `/meetings` | 회의록 |

---

## 코딩 규칙 (필수 준수)

1. **TypeScript 사용** — 타입 정의 철저히
2. **기존 코드 보호** — 수정 전 반드시 현재 파일 구조 파악 후 충돌 여부 확인
3. **Firestore 실시간 구독** — `onSnapshot` 사용 (단순 get 지양)
4. **한국어 UI** — 모든 에러 메시지, 안내 문구 한국어
5. **모바일 반응형** — 모든 화면 모바일 대응
6. **상태 UI 완비** — 로딩 / 에러 / 데이터 없음 상태 모두 처리
7. **디자인 톤 유지** — 플랫, 화이트 배경, 얇은 테두리 스타일
8. **커스텀 훅** — `useSettings()`, `useKpis()` 등 Firestore 구독은 훅으로 분리

---

## 작업 시 주의사항

- 새 기능 추가 시 `/settings` 연동 여부 먼저 확인
- KPI와 업무 연결 로직 건드릴 때 양방향 업데이트 누락 주의
- GitHub Pages 배포는 `gh-pages` 브랜치 기준
- 환경변수(Firebase 설정)는 `.env` 파일 참조, 코드에 직접 노출 금지

### Git 주의사항
- 프로젝트가 OneDrive 경로에 있어 git 명령이 불안정할 수 있음
- git 오류 발생 시 OneDrive 동기화 일시 중지 후 재시도
- GitHub 리모트는 설정되어 있음

---

## 향후 추가 예정 기능
- [ ] Obsidian 연동 (회의록 → 노트 자동 저장)

---

## 완료된 작업 히스토리

### 2026-03-18 완료
- [x] 보고서 3종 개선 (주간/2주/월간) — MeetingReportPanel.tsx
- [x] 설정에 대표이사 미팅 일정 관리 추가 — SettingsPanel.tsx
- [x] 이번 주 뷰 — 날짜 기준 그룹핑, M.DD 마감일 칩, NEW 뱃지
- [x] 매트릭스 중요도 — importance 필드 추가, 사람이 직접 입력
- [x] 매트릭스 드래그 시 dueDate 자동 조정
- [x] 로그인 계정 → 담당자 자동 매핑 + 전체 보기 토글
- [x] 업무 수정자 자동 기록 (lastModifiedBy, lastModifiedAt)
  - services/taskService.ts updateTask에 changedByName 파라미터
  - TaskCard에 "최선아 수정 · 3.18 오후 2:30" 표시

### 데이터 구조 변경 이력
- Task에 importance: 'high' | 'normal' 추가
- Task에 lastModifiedBy: string 추가
- Task에 lastModifiedAt: Timestamp 추가
- Task에 isNewDismissed: boolean 추가
- Settings에 member.email 필드 추가
- Settings에 ceoMeetingDates 배열 추가