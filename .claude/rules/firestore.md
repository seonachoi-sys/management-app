# Firestore 규칙

## 컬렉션 구조
- /tasks — 업무 (전체 공유)
- /kpis — KPI
- /settings — 카테고리, 팀원, CEO 미팅 일정
- /meetings — 회의록
- /projects — 과제관리 (업무관리와 독립)

## 필수 규칙
1. 구독은 onSnapshot 사용 (get 지양)
2. 업데이트 시 lastModifiedBy + lastModifiedAt 항상 포함
3. KPI 업데이트 시 반드시 getDoc으로 기존 값 읽어서 병합
4. task 삭제 시 KPI linkedTaskIds + taskHistory orphan 정리
5. status '완료' 변경 시 leadTimeDays 자동 계산

## 하위업무 자동완료 로직
- 하위업무 완료 시 형제 업무 전체 확인
- 전부 완료이면 상위업무 자동 완료
- lastModifiedBy: "자동완료"
- 완료된 상위에 하위 추가 시 상위 자동 진행중 복귀
