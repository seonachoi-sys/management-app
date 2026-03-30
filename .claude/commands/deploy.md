# 배포

## 사전 체크
1. `.env` 파일 존재 여부 확인
2. OneDrive 동기화 중이면 일시 중지
3. 커밋되지 않은 변경사항 확인 (`git status`)

## 실행 순서
1. TypeScript 타입 체크: `npx tsc --noEmit`
2. 빌드: `npm run build`
3. 배포: `npm run deploy`
4. 확인: https://seonachoi-sys.github.io/management-app/

## 배포 후 확인
- 배포 후 3~5분 캐시 적용 시간 필요
- 404 발생 시 `public/404.html` SPA 리다이렉트 확인
- 과제 관리 라우트 (`/project`) 직접 접근 시 404 안 나는지 확인
- Firebase 연결 정상 여부 (콘솔에서 Firestore 에러 없는지)

## 주의
- `gh-pages` 브랜치 기준 배포
- 브랜치는 `main` (master 아님)
- 빌드 실패 시 타입 에러 먼저 해결
- `homepage` 필드가 `package.json`에 설정되어 있어야 함
