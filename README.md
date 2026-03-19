# (주)타이로스코프 경영관리팀 업무 포탈

국책과제 관리 및 업무관리 시스템

## 기술 스택

- **Frontend:** React 19 + TypeScript
- **Backend/DB:** Firebase Firestore (실시간 동기화)
- **인증:** Firebase Authentication (Google 로그인)
- **외부 연동:** Google Tasks API
- **배포:** GitHub Pages

## 시작하기

### 1. 패키지 설치

```bash
npm install
```

### 2. 환경변수 설정

프로젝트 루트에 `.env` 파일을 생성하고 아래 내용을 입력합니다.
(`.env.example` 참고)

```env
# Firebase 설정
REACT_APP_FIREBASE_API_KEY=your_api_key
REACT_APP_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your_project_id
REACT_APP_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
REACT_APP_FIREBASE_APP_ID=your_app_id

# Google Tasks API
REACT_APP_GOOGLE_CLIENT_ID=your_google_client_id
REACT_APP_GOOGLE_API_KEY=your_google_api_key
```

### 3. Firebase 프로젝트 설정

1. [Firebase Console](https://console.firebase.google.com/)에서 새 프로젝트 생성
2. **Authentication** > 로그인 제공업체에서 **Google** 활성화
3. **Firestore Database** > 데이터베이스 만들기 (프로덕션 모드)
4. 프로젝트 설정 > 일반 > 웹 앱 추가 > Firebase 구성 값을 `.env`에 입력

#### Firestore 보안 규칙 (권장)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

#### Firestore 복합 인덱스

앱 실행 시 콘솔에 인덱스 생성 링크가 나타나면 클릭하여 생성하세요.
필요한 주요 인덱스:

- `tasks`: `status` (오름차순) + `priorityScore` (내림차순)
- `tasks`: `assignee` (오름차순) + `priorityScore` (내림차순)
- `notifications`: `targetUserId` (오름차순) + `createdAt` (내림차순)

### 4. Google Tasks API 설정

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트 선택 (Firebase와 동일 프로젝트)
2. **API 및 서비스** > **라이브러리** > **Tasks API** 검색 후 활성화
3. **API 및 서비스** > **사용자 인증 정보**:
   - **API 키** 생성 > Tasks API만 제한 > `.env`의 `REACT_APP_GOOGLE_API_KEY`에 입력
   - **OAuth 2.0 클라이언트 ID** 생성 (웹 애플리케이션):
     - 승인된 JavaScript 출처: `http://localhost:3000`, `https://seonachoi-sys.github.io`
     - 클라이언트 ID를 `.env`의 `REACT_APP_GOOGLE_CLIENT_ID`에 입력
4. **OAuth 동의 화면** 설정:
   - 앱 이름, 사용자 지원 이메일 입력
   - 범위 추가: `https://www.googleapis.com/auth/tasks`
   - 테스트 사용자 추가 (개발 중에는 내부 사용자만)

### 5. 로컬 실행

```bash
npm start
```

### 6. 배포

```bash
npm run deploy
```

## 주요 기능

### 업무관리
- Firebase Firestore 실시간 동기화
- 우선순위 자동 계산 (마감일, 카테고리, KPI 연결, CEO 플래그 등 종합 점수)
- 담당자별/카테고리별/상태별 필터링
- 팀원별 업무량 모니터링
- 업무 변경 이력 자동 저장
- D-day 카운트다운 및 긴급 알림 배너

### 알림 시스템
- D-7, D-3, D-1, D-day, 지연 자동 감지
- 팀원 업무 과부하 경고 (5건 초과)
- 24시간 내 중복 알림 방지

### 회의 자료 자동 생성
- **주간 리포트:** 완료/진행중/지연/예정 업무, 팀원별 업무량
- **격주 리포트 (CEO):** 2주 요약, CEO 결재 필요 항목, 위험 업무
- **월간 리포트:** 팀 성과 요약, 팀원별 현황, 주요 성과 Top 5
- 클립보드 복사 기능
- 섹션별 접기/펼치기

### Google Tasks 연동
- Firestore 업무를 Google Tasks로 동기화
- Google Tasks에서 생성한 업무 자동 가져오기
- 완료 상태 양방향 동기화
- "경영관리팀 업무" 태스크 리스트 자동 생성

## 프로젝트 구조

```
src/
├── App.js                    # 메인 앱 (사이드바 + 라우팅)
├── firebase/config.ts        # Firebase 초기화
├── types/index.ts            # TypeScript 타입 정의
├── types/google.d.ts         # Google API 타입
├── utils/
│   ├── priorityCalculator.ts # 우선순위 자동 계산
│   └── dateUtils.ts          # 날짜 유틸리티
├── services/
│   ├── taskService.ts        # Firestore 업무 CRUD
│   ├── memberService.ts      # 팀원 관리
│   ├── notificationService.ts # 알림 시스템
│   └── googleTasksService.ts # Google Tasks 연동
├── hooks/
│   ├── useAuth.ts            # Google 인증
│   ├── useTasks.ts           # 업무 데이터 훅
│   ├── useMembers.ts         # 팀원 데이터 훅
│   ├── useNotifications.ts   # 알림 훅
│   └── useMeetingReport.ts   # 회의록 생성 훅
├── task-manager/
│   ├── TaskDashboard.tsx     # 메인 대시보드
│   ├── TaskCard.tsx          # 업무 카드
│   ├── TaskForm.tsx          # 업무 생성/수정 모달
│   ├── MeetingReportPanel.tsx # 회의 자료 패널
│   ├── NotificationCenter.tsx # 알림 센터
│   └── TaskManager.css       # 스타일
└── components/
    └── TaskManager.js        # (기존 - 레거시)
```

## Firestore 컬렉션

| 컬렉션 | 설명 |
|--------|------|
| `tasks` | 업무 (상태, 우선순위, 마감일, 담당자 등) |
| `members` | 팀원 정보 |
| `kpis` | KPI 목표 및 현황 |
| `meetingLogs` | 회의록 저장 |
| `taskHistory` | 업무 변경 이력 |
| `notifications` | 알림 (마감, 지연, 과부하) |
