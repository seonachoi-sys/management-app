/**
 * 경영관리팀 업무관리 - Google Calendar 자동 연동 스크립트
 *
 * 설치 방법:
 * 1. 구글 시트 열기 → 확장 프로그램 → Apps Script
 * 2. 이 코드를 전체 복사하여 붙여넣기
 * 3. 저장 (Ctrl+S)
 * 4. syncAllToCalendar() 함수 한 번 실행 (최초 동기화)
 * 5. "트리거" 탭에서 자동 실행 설정 (아래 setupTrigger 함수 실행)
 */

// ============================================================
// 설정
// ============================================================
const CALENDAR_NAME = '경영관리팀 업무';  // 생성될 캘린더 이름
const SHEET_NAMES = ['1월', '2월', '3월'];

// 시트 컬럼 인덱스 (0-based)
const COL = {
  DEPT: 0,       // A: 구분
  LAYER: 1,      // B: 계층
  CONTENT: 2,    // C: 업무내용
  OWNER: 3,      // D: 담당자
  PRIORITY: 4,   // E: 우선순위
  START: 5,      // F: 시작일
  DEADLINE: 6,   // G: 마감일
  PROGRESS: 7,   // H: 진척도
  COMPLETION: 8, // I: 완료일
  STATUS_DESC: 9 // J: 비고
};

// ============================================================
// 메인 함수들
// ============================================================

/**
 * 모든 시트의 업무를 캘린더에 동기화
 */
function syncAllToCalendar() {
  const calendar = getOrCreateCalendar();
  let syncCount = 0;
  let skipCount = 0;
  let deleteCount = 0;

  SHEET_NAMES.forEach(sheetName => {
    const result = syncSheet(calendar, sheetName);
    syncCount += result.synced;
    skipCount += result.skipped;
    deleteCount += result.deleted;
  });

  Logger.log(`동기화 완료: ${syncCount}건 등록/수정, ${skipCount}건 스킵, ${deleteCount}건 삭제`);

  SpreadsheetApp.getActiveSpreadsheet().toast(
    `${syncCount}건 동기화, ${skipCount}건 스킵, ${deleteCount}건 삭제`,
    '캘린더 동기화 완료',
    5
  );
}

/**
 * 개별 시트 동기화
 */
function syncSheet(calendar, sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    Logger.log(`시트 "${sheetName}" 없음, 스킵`);
    return { synced: 0, skipped: 0, deleted: 0 };
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { synced: 0, skipped: 0, deleted: 0 };

  let synced = 0;
  let skipped = 0;

  // 현재 시트에서 관리하는 이벤트 ID 목록
  const activeEventIds = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const content = String(row[COL.CONTENT] || '').trim();
    const deadline = row[COL.DEADLINE];
    const dept = String(row[COL.DEPT] || '').trim();
    const owner = String(row[COL.OWNER] || '').trim();
    const priority = String(row[COL.PRIORITY] || '').trim();
    const progress = parseProgressValue(row[COL.PROGRESS]);
    const statusDesc = String(row[COL.STATUS_DESC] || '').trim();
    const startDate = row[COL.START];
    const completionDate = row[COL.COMPLETION];

    // 업무내용이나 마감일이 없으면 스킵
    if (!content || !deadline) {
      skipped++;
      continue;
    }

    // 마감일 파싱
    const dlDate = parseToDate(deadline);
    if (!dlDate) {
      skipped++;
      continue;
    }

    // 완료된 업무는 스킵 (진척도 100% 또는 완료일 있음)
    if (progress >= 100 || (completionDate && parseToDate(completionDate))) {
      skipped++;
      continue;
    }

    // 고유 ID 생성 (시트명 + 행번호 + 내용 해시)
    const eventTag = `task_${sheetName}_${hashCode(content)}`;
    activeEventIds.push(eventTag);

    // 상태 자동 판정
    const status = getStatus(dlDate, progress);

    // 이벤트 제목 & 설명 구성
    const title = `[${dept}] ${content}`;
    const description = [
      `구분: ${dept}`,
      `담당자: ${owner}`,
      `우선순위: ${priority}`,
      `진척도: ${progress}%`,
      `상태: ${status}`,
      statusDesc ? `비고: ${statusDesc}` : '',
      ``,
      `📊 시트: ${sheetName}`,
      `🔗 자동 동기화 by 경영관리팀 업무관리`
    ].filter(s => s).join('\n');

    // 색상 설정 (우선순위별)
    const color = getPriorityColor(priority);

    // 기존 이벤트 찾기
    const existing = findEventByTag(calendar, eventTag, dlDate);

    if (existing) {
      // 업데이트
      existing.setTitle(title);
      existing.setDescription(description);
      existing.setAllDayDate(dlDate);
      if (color) existing.setColor(color);
    } else {
      // 새로 생성 (종일 이벤트로 마감일에 등록)
      const event = calendar.createAllDayEvent(title, dlDate, { description: description });
      if (color) event.setColor(color);
      event.setTag('taskId', eventTag);

      // 마감 1일 전 알림
      event.removeAllReminders();
      event.addPopupReminder(24 * 60);  // 1일 전
      event.addPopupReminder(60);       // 1시간 전

      // 주의/지연 상태면 추가 알림
      if (status === '지연' || status === '주의') {
        event.addPopupReminder(2 * 24 * 60); // 2일 전
      }
    }
    synced++;
  }

  // 완료된 업무의 기존 캘린더 이벤트 정리
  const deleted = cleanupCompletedEvents(calendar, sheetName, activeEventIds);

  return { synced, skipped, deleted };
}

// ============================================================
// 유틸리티 함수들
// ============================================================

/**
 * 전용 캘린더 가져오기 (없으면 생성)
 */
function getOrCreateCalendar() {
  const calendars = CalendarApp.getCalendarsByName(CALENDAR_NAME);
  if (calendars.length > 0) return calendars[0];

  const cal = CalendarApp.createCalendar(CALENDAR_NAME, {
    summary: '경영관리팀 업무 마감일 관리',
    color: CalendarApp.Color.PALE_BLUE
  });
  Logger.log(`캘린더 "${CALENDAR_NAME}" 생성됨`);
  return cal;
}

/**
 * 날짜 파싱
 */
function parseToDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  const str = String(value).trim();
  // YYYY-MM-DD, YYYY.MM.DD, MM/DD 등
  let match = str.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (match) return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));

  match = str.match(/(\d{1,2})[-./](\d{1,2})/);
  if (match) return new Date(new Date().getFullYear(), parseInt(match[1]) - 1, parseInt(match[2]));

  return null;
}

/**
 * 진척도 파싱
 */
function parseProgressValue(value) {
  if (!value) return 0;
  const str = String(value).replace('%', '').trim();
  const num = parseInt(str);
  return isNaN(num) ? 0 : Math.min(100, Math.max(0, num));
}

/**
 * 상태 자동 판정
 */
function getStatus(deadline, progress) {
  if (progress >= 100) return '완료';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dl = new Date(deadline);
  dl.setHours(0, 0, 0, 0);
  const daysLeft = (dl - today) / 86400000;

  if (daysLeft < 0) return '지연';
  if (daysLeft <= 3 && progress < 70) return '주의';
  if (progress > 0) return '진행중';
  return '미착수';
}

/**
 * 우선순위별 캘린더 색상
 */
function getPriorityColor(priority) {
  switch (priority) {
    case '1순위': return CalendarApp.EventColor.RED;
    case '2순위': return CalendarApp.EventColor.ORANGE;
    case '3순위': return CalendarApp.EventColor.CYAN;
    case '4순위': return CalendarApp.EventColor.GRAY;
    default: return CalendarApp.EventColor.PALE_BLUE;
  }
}

/**
 * 문자열 해시 코드
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * 태그로 기존 이벤트 찾기
 */
function findEventByTag(calendar, tag, aroundDate) {
  const start = new Date(aroundDate);
  start.setDate(start.getDate() - 30);
  const end = new Date(aroundDate);
  end.setDate(end.getDate() + 30);

  const events = calendar.getEvents(start, end);
  for (const event of events) {
    if (event.getTag('taskId') === tag) return event;
  }
  return null;
}

/**
 * 완료된 업무의 캘린더 이벤트 삭제
 */
function cleanupCompletedEvents(calendar, sheetName, activeEventIds) {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear(), 11, 31);

  const events = calendar.getEvents(start, end);
  let deleted = 0;

  events.forEach(event => {
    const tag = event.getTag('taskId');
    if (tag && tag.startsWith(`task_${sheetName}_`) && !activeEventIds.includes(tag)) {
      event.deleteEvent();
      deleted++;
    }
  });

  return deleted;
}

// ============================================================
// 트리거 설정
// ============================================================

/**
 * 자동 트리거 설정 (최초 1회 실행)
 * - 시트 수정 시 자동 동기화
 * - 매일 아침 8시 동기화
 */
function setupTrigger() {
  // 기존 트리거 삭제
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));

  // 시트 수정 시 동기화
  ScriptApp.newTrigger('onEditSync')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();

  // 매일 아침 8시 동기화
  ScriptApp.newTrigger('syncAllToCalendar')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  Logger.log('트리거 설정 완료: 시트 수정 시 + 매일 08시 자동 동기화');
  SpreadsheetApp.getActiveSpreadsheet().toast(
    '시트 수정 시 + 매일 08시 자동 동기화 설정됨',
    '트리거 설정 완료',
    5
  );
}

/**
 * 시트 수정 시 디바운스 동기화 (너무 자주 실행 방지)
 */
function onEditSync(e) {
  const sheet = e.source.getActiveSheet();
  const sheetName = sheet.getName();

  // 업무 시트가 아니면 무시
  if (!SHEET_NAMES.includes(sheetName)) return;

  // 마지막 동기화로부터 2분 이내면 스킵
  const cache = CacheService.getScriptCache();
  const lastSync = cache.get('lastSync');
  if (lastSync && (Date.now() - parseInt(lastSync)) < 120000) return;

  cache.put('lastSync', String(Date.now()), 300);

  const calendar = getOrCreateCalendar();
  syncSheet(calendar, sheetName);
}

// ============================================================
// 커스텀 메뉴
// ============================================================

/**
 * 시트 열 때 메뉴 추가
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📅 캘린더 연동')
    .addItem('전체 동기화', 'syncAllToCalendar')
    .addItem('자동 동기화 설정', 'setupTrigger')
    .addSeparator()
    .addItem('캘린더 열기', 'openCalendar')
    .addToUi();
  ui.createMenu('📋 회의록')
    .addItem('회의록 생성/업데이트', 'generateMeetingDoc')
    .addItem('회의록 문서 열기', 'openMeetingDoc')
    .addToUi();
}

function openCalendar() {
  const html = HtmlService.createHtmlOutput(
    '<script>window.open("https://calendar.google.com");google.script.host.close();</script>'
  ).setWidth(1).setHeight(1);
  SpreadsheetApp.getUi().showModalDialog(html, '캘린더 열기');
}
