/**
 * 영문 Google 계정 이름 → 한글 표준 이름 매핑
 *
 * Firebase Auth의 displayName이 영문(Google 계정명)으로 들어오는 경우,
 * 팀 내부 표준 한글 이름으로 정규화하여 일관성 유지.
 *
 * 새 매핑이 생기면 여기 추가.
 */
export const NAME_MAP: Readonly<Record<string, string>> = {
  'seonA Choi': '최선아',
  'Unghae Lee': '이웅해',
  // 송은정 영문 계정 발견 시 추가 (예: 'Eunjeong Song': '송은정')
};

/** 영문 이름 → 한글 표준 이름. 매핑 없으면 원본 반환. */
export function normalizeUserName(name: string | null | undefined): string {
  if (!name) return '';
  return NAME_MAP[name] || name;
}

/** 매핑 대상인지 (= 정규화 시 값이 바뀌는지) */
export function needsNameNormalization(name: string | null | undefined): boolean {
  if (!name) return false;
  return name in NAME_MAP;
}
