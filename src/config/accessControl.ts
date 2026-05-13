export const ACCESS_CONTROL = {
  // 국책과제 관리 접근 가능 이메일
  projectManagement: [
    'eunjeong.song@thyroscope.com',
    'unghae.lee@thyroscope.com',
    'seona.choi@thyroscope.com',
    'jaemin.park@thyroscope.com',
  ],
  // 인건비증빙 접근 가능 이메일 (더 제한적)
  payrollAccess: [
    'eunjeong.song@thyroscope.com',
    'unghae.lee@thyroscope.com',
    'seona.choi@thyroscope.com',
  ],
  // 업무관리: 로그인만 하면 누구나 접근 가능
};

export type AccessLevel = 'projectManagement' | 'payrollAccess';

export function hasAccess(email: string | null | undefined, level: AccessLevel): boolean {
  if (!email) return false;
  return ACCESS_CONTROL[level].includes(email.toLowerCase());
}
