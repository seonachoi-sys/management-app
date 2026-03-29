# 체크리스트 검증

## 실행 순서
1. 전체 소스 파일 읽기
2. 아래 항목 코드에서 직접 확인 (브라우저 테스트 아님)
3. 각 항목 ✅ / ❌ / ⚠️ 로 표시
4. ❌ ⚠️ 항목만 모아서 우선순위 정리

## 체크 항목

### 데이터
- [ ] Task 타입에 importance, lastModifiedBy, lastModifiedAt, isNewDismissed, leadTimeDays 필드 존재
- [ ] Settings 타입에 ceoMeetingDates, member.email 필드 존재
- [ ] Firestore 업데이트 시 lastModifiedBy + lastModifiedAt 항상 기록
- [ ] KPI 업데이트 시 getDoc으로 기존 값 병합

### 날짜
- [ ] new Date('YYYY-MM-DD') 직접 파싱 없음 (T00:00:00 필수)
- [ ] 날짜 덧셈 getDate()+N 없음 (addDays 헬퍼 사용)
- [ ] completedDate 기존 값 보존 (재완료 시 덮어쓰지 않음)

### 필터
- [ ] 이번 주 뷰 filteredTasks 기준 (tasks 원본 아님)
- [ ] 담당자 필터 assigneeName 기준으로 통일

### UI
- [ ] 상태 드롭다운 position: fixed + getBoundingClientRect()
- [ ] 완료 하위업무 기본 숨김 + 토글 버튼 표시
- [ ] NEW 뱃지 isNewDismissed 기반
