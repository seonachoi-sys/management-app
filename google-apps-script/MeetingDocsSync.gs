/**
 * 경영관리팀 주간 회의록 - Google Docs 자동 생성 스크립트
 *
 * 스프레드시트의 업무 데이터를 기반으로 Google Docs 회의록을 자동 업데이트합니다.
 *
 * 설치 방법:
 * 1. 구글 시트 열기 → 확장 프로그램 → Apps Script
 * 2. 기존 CalendarSync.gs 옆에 새 파일(+) → MeetingDocsSync.gs
 * 3. 이 코드를 전체 복사하여 붙여넣기
 * 4. 저장 (Ctrl+S)
 * 5. generateMeetingDoc() 함수 실행 (최초 권한 승인 필요)
 * 6. 시트 상단 메뉴 "📋 회의록" → "회의록 생성/업데이트" 클릭으로 사용
 */

// ============================================================
// 설정
// ============================================================
const MEETING_DOC_ID = '1peKGhPGEGZHSZjnxkmnuwmzrtQyxe59kLdbgNg0qNIA';
const TASK_SHEET_NAMES = ['1월', '2월', '3월'];
const MEMBERS = ['송은정', '이웅해', '최선아'];

// 시트 컬럼 인덱스 (0-based)
const TCOL = {
  DEPT: 0,       // A: 구분
  LAYER: 1,      // B: 계층
  CONTENT: 2,    // C: 업무내용
  OWNER: 3,      // D: 담당자
  PRIORITY: 4,   // E: 우선순위
  START: 5,      // F: 시작일
  DEADLINE: 6,   // G: 마감일
  PROGRESS: 7,   // H: 진척도
  COMPLETION: 8, // I: 완료일
  STATUS_DESC: 9,// J: 상태 설명
  DECISION: 10,  // K: 결정필요 사항
  RESOURCE: 11,  // L: 필요 자원
  MEETING: 12    // M: 미팅 요청
};

// ============================================================
// 메인 함수
// ============================================================

/**
 * 회의록 Google Docs 생성/업데이트
 */
function generateMeetingDoc() {
  const tasks = loadAllTasks();
  const doc = DocumentApp.openById(MEETING_DOC_ID);
  const body = doc.getBody();

  // 기존 내용 전체 삭제
  body.clear();

  const now = new Date();
  const weekStart = getMonday(now);
  const nextFriday = new Date(weekStart);
  nextFriday.setDate(weekStart.getDate() + 11);

  // 활성 업무 (미완료)
  const activeTasks = tasks.filter(t => t.status !== '완료');
  const allStatuses = tasks.map(t => t.status);
  const completedCount = allStatuses.filter(s => s === '완료').length;
  const warnAndLate = tasks.filter(t => t.status === '지연' || t.status === '주의');
  const decisions = tasks.filter(t => t.decision && t.status !== '완료');
  const meetings = tasks.filter(t => t.meeting && t.status !== '완료');

  // ─── 제목 ───
  const title = body.appendParagraph('경영관리팀 주간 회의');
  title.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  title.setForegroundColor('#1a237e');
  title.setBold(true);

  const subtitle = body.appendParagraph('(참석자: 최선아, 이웅해, 송은정)');
  subtitle.setForegroundColor('#666666');
  subtitle.setFontSize(11);

  body.appendParagraph('');

  const dateInfo = body.appendParagraph(
    formatFullDate(now) + ' / 오후 4시 00분 / 소회의실'
  );
  dateInfo.setForegroundColor('#333333');
  dateInfo.setFontSize(10);

  // ─── 안내 사항 ───
  appendSectionHeader(body, '안내 사항');

  appendBullet(body, '전체 업무 ' + tasks.length + '건 중 ' + completedCount + '건 완료 (완료율 ' + (tasks.length > 0 ? Math.round(completedCount / tasks.length * 100) : 0) + '%)');

  if (warnAndLate.length > 0) {
    appendBullet(body, '⚠ 지연/주의 업무 ' + warnAndLate.length + '건 - 우선 확인 필요');
    warnAndLate.forEach(function(t) {
      appendSubBullet(body, t.content + ' (' + t.owner + ', 마감: ' + formatShortDate(t.deadline) + ')');
    });
  }

  // ─── 금주, 차주 주요 업무 ───
  appendSectionHeader(body, '금주, 차주 주요 업무 (' + formatShortDate2(weekStart) + ' 월 ~' + formatShortDate2(nextFriday) + ' ' + getDayName(nextFriday) + '까지)');

  MEMBERS.forEach(function(member) {
    var memberTasks = activeTasks
      .filter(function(t) { return getOwners(t.owner).indexOf(member) >= 0; })
      .sort(function(a, b) { return getPriNum(a.priority) - getPriNum(b.priority); });

    var memberHeader = body.appendParagraph('[' + member + ']');
    memberHeader.setBold(true);
    memberHeader.setFontSize(11);
    memberHeader.setSpacingBefore(8);

    if (memberTasks.length === 0) {
      appendCheckbox(body, '배정된 업무 없음', '');
    } else {
      memberTasks.forEach(function(t) {
        var dlStr = t.deadline ? formatShortDate(t.deadline) : '';
        var dlDisplay = dlStr ? ' (' + dlStr + ')' : '';
        var statusIcon = t.status === '지연' ? '⚠ ' : t.status === '주의' ? '⚡ ' : '';
        var desc = t.statusDesc ? ' - ' + t.statusDesc : '';
        appendCheckbox(body, t.priority + ': ' + statusIcon + t.content + dlDisplay, desc);
      });
    }
  });

  // ─── 기타 논의사항 ───
  if (meetings.length > 0) {
    appendSectionHeader(body, '기타 논의사항');
    meetings.forEach(function(t) {
      appendBullet(body, t.content + ': ' + t.meeting + ' (' + t.owner + ')');
    });
  }

  // ─── 기한외 지속적으로 F/U 사항 ───
  var followUpTasks = activeTasks.filter(function(t) {
    var dl = parseTaskDate(t.deadline);
    return dl && (dl.getTime() - now.getTime()) / 86400000 > 14;
  });
  if (followUpTasks.length > 0) {
    appendSectionHeader(body, '기한외 지속적으로 F/U 사항');
    followUpTasks.forEach(function(t) {
      appendBullet(body, t.content + ' (' + t.owner + ', 마감: ' + formatShortDate(t.deadline) + ')');
    });
  }

  // ─── 대표이사 확인 필요 사항 ───
  if (decisions.length > 0) {
    appendSectionHeader(body, '대표이사 확인 필요 사항');
    decisions.forEach(function(t) {
      appendBullet(body, t.decision + ' (' + t.dept + ' - ' + t.content + ', 담당: ' + t.owner + ')');
    });
  }

  // ─── 푸터 ───
  body.appendParagraph('');
  var footer = body.appendParagraph('자동 생성: ' + Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm') + ' | 업무관리 스프레드시트 기반');
  footer.setForegroundColor('#aaaaaa');
  footer.setFontSize(9);
  footer.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

  doc.saveAndClose();

  SpreadsheetApp.getActiveSpreadsheet().toast(
    '회의록이 업데이트되었습니다.',
    '📋 회의록 생성 완료',
    5
  );

  Logger.log('회의록 생성 완료: ' + doc.getUrl());
}

// ============================================================
// 데이터 로드
// ============================================================

function loadAllTasks() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var allTasks = [];

  TASK_SHEET_NAMES.forEach(function(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;

    var monthNum = parseInt(sheetName.replace(/[^0-9]/g, '')) || 0;
    var currentDept = '';

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var dept = String(row[TCOL.DEPT] || '').trim();
      var layer = String(row[TCOL.LAYER] || '').trim();
      var content = String(row[TCOL.CONTENT] || '').trim();

      if (dept) currentDept = dept;
      if (layer !== '하위' || !content) continue;

      var owner = String(row[TCOL.OWNER] || '').trim();
      var priority = String(row[TCOL.PRIORITY] || '4순위').trim();
      var deadline = row[TCOL.DEADLINE];
      var progress = parseProgressVal(row[TCOL.PROGRESS]);
      var completionDate = row[TCOL.COMPLETION];
      var statusDesc = String(row[TCOL.STATUS_DESC] || '').trim();
      var decision = String(row[TCOL.DECISION] || '').trim();
      var meeting = String(row[TCOL.MEETING] || '').trim();

      var taskDept = dept || currentDept;
      var status = getTaskStatus(deadline, progress, completionDate);

      allTasks.push({
        month: monthNum,
        dept: taskDept,
        content: content,
        owner: owner,
        priority: priority,
        deadline: deadline,
        progress: progress,
        completionDate: completionDate,
        statusDesc: statusDesc,
        decision: decision,
        meeting: meeting,
        status: status
      });
    }
  });

  return allTasks;
}

// ============================================================
// 문서 서식 헬퍼
// ============================================================

function appendSectionHeader(body, text) {
  body.appendParagraph('');
  var p = body.appendParagraph(text);
  p.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  p.setForegroundColor('#e05070');
  p.setBold(true);
  p.setFontSize(13);
}

function appendBullet(body, text) {
  var p = body.appendListItem(text);
  p.setGlyphType(DocumentApp.GlyphType.BULLET);
  p.setFontSize(10);
  p.setForegroundColor('#333333');
}

function appendSubBullet(body, text) {
  var p = body.appendListItem(text);
  p.setGlyphType(DocumentApp.GlyphType.HOLLOW_BULLET);
  p.setNestingLevel(1);
  p.setFontSize(10);
  p.setForegroundColor('#666666');
}

function appendCheckbox(body, mainText, subText) {
  var p = body.appendListItem(mainText + subText);
  p.setGlyphType(DocumentApp.GlyphType.SQUARE_BULLET);
  p.setFontSize(10);
  p.setForegroundColor('#333333');
}

// ============================================================
// 유틸리티
// ============================================================

function getTaskStatus(deadline, progress, completionDate) {
  if (progress >= 100 || (completionDate && parseTaskDate(completionDate))) return '완료';
  var dl = parseTaskDate(deadline);
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dl) {
    var diff = (dl.getTime() - today.getTime()) / 86400000;
    if (diff < 0 && progress < 100) return '지연';
    if (diff >= 0 && diff <= 3 && progress < 100) return '주의';
  }
  if (progress > 0) return '진행중';
  return '미착수';
}

function parseTaskDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  var str = String(value).trim();
  var match = str.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (match) return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  return null;
}

function parseProgressVal(value) {
  if (!value) return 0;
  var str = String(value).replace('%', '').trim();
  var num = parseInt(str);
  return isNaN(num) ? 0 : Math.min(100, Math.max(0, num));
}

function getOwners(ownerStr) {
  return String(ownerStr).split(',').map(function(s) { return s.trim(); });
}

function getPriNum(pri) {
  var map = { '1순위': 1, '2순위': 2, '3순위': 3, '4순위': 4 };
  return map[pri] || 9;
}

function getMonday(d) {
  var date = new Date(d);
  var day = date.getDay();
  var diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getDayName(d) {
  var names = ['일', '월', '화', '수', '목', '금', '토'];
  return names[d.getDay()];
}

function formatFullDate(d) {
  return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
}

function formatShortDate(value) {
  var d = parseTaskDate(value);
  if (!d) return '-';
  return (d.getMonth() + 1) + '/' + d.getDate();
}

function formatShortDate2(d) {
  return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
}

// ============================================================
// 메뉴 등록 (onOpen에 추가)
// ============================================================

/**
 * 시트 열 때 회의록 메뉴 추가
 *
 * 기존 CalendarSync.gs의 onOpen()과 충돌 방지:
 * CalendarSync.gs의 onOpen()에 아래 코드를 추가하세요:
 *
 *   SpreadsheetApp.getUi().createMenu('📋 회의록')
 *     .addItem('회의록 생성/업데이트', 'generateMeetingDoc')
 *     .addItem('회의록 문서 열기', 'openMeetingDoc')
 *     .addToUi();
 */
function addMeetingMenu() {
  SpreadsheetApp.getUi().createMenu('📋 회의록')
    .addItem('회의록 생성/업데이트', 'generateMeetingDoc')
    .addItem('회의록 문서 열기', 'openMeetingDoc')
    .addToUi();
}

function openMeetingDoc() {
  var html = HtmlService.createHtmlOutput(
    '<script>window.open("https://docs.google.com/document/d/' + MEETING_DOC_ID + '/edit");google.script.host.close();</script>'
  ).setWidth(1).setHeight(1);
  SpreadsheetApp.getUi().showModalDialog(html, '회의록 열기');
}
