# 배포

## 실행 순서
1. TypeScript 타입 체크: npx tsc --noEmit
2. 빌드: npm run build
3. 배포: npm run deploy
4. 확인: https://seonachoi-sys.github.io/management-app/

## 주의
- .env 파일 있는지 확인 후 빌드
- OneDrive 동기화 중이면 일시 중지 후 진행
- 배포 후 5분 정도 캐시 적용 시간 필요
