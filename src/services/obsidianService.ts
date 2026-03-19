const API_KEY = process.env.REACT_APP_OBSIDIAN_API_KEY || '';
const PORT = process.env.REACT_APP_OBSIDIAN_PORT || '27124';
const BASE_URL = `https://127.0.0.1:${PORT}`;

async function obsidianFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'text/markdown',
      ...options.headers,
    },
  });
  return res;
}

/** Obsidian 연결 상태 확인 */
export async function checkConnection(): Promise<boolean> {
  try {
    const res = await obsidianFetch('/', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 바이너리 파일 저장 (이미지 등) */
export async function saveBinaryFile(filePath: string, blob: Blob): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/vault/${encodeURIComponent(filePath)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/octet-stream',
      },
      body: blob,
    });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

/** 노트 저장 (파일 경로 지정, 이미 존재하면 덮어쓰기) */
export async function saveNote(filePath: string, content: string): Promise<boolean> {
  try {
    const res = await obsidianFetch(`/vault/${encodeURIComponent(filePath)}`, {
      method: 'PUT',
      body: content,
    });
    return res.ok || res.status === 204;
  } catch (err) {
    console.error('Obsidian 저장 실패:', err);
    throw new Error(
      'Obsidian 연결 실패. 다음을 확인해주세요:\n' +
      '1. Obsidian이 실행 중인지\n' +
      '2. Local REST API 플러그인이 활성화되어 있는지\n' +
      '3. 브라우저에서 https://127.0.0.1:27124 에 접속하여 인증서를 승인했는지'
    );
  }
}

/** 회의 리포트를 마크다운으로 변환 후 Obsidian에 저장 */
export async function saveReportToObsidian(
  reportMarkdown: string,
  reportType: string,
  periodLabel: string,
): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const safeperiod = periodLabel.replace(/[/\\:*?"<>|]/g, '-');

  // 폴더 구조: 회의록/2026/03/
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const fileName = `회의록/${year}/${month}/${dateStr} ${reportType} (${safeperiod}).md`;

  await saveNote(fileName, reportMarkdown);
  return fileName;
}

/** 리포트 데이터를 마크다운 형식으로 변환 */
export function formatReportMarkdown(
  reportType: string,
  periodLabel: string,
  stats: { total: number; incomplete: number; completed: number; delayed: number },
  incompleteByCategory: { category: string; tasks: Array<{ title: string; assigneeName: string; progressRate: number; dueDate?: Date | null; daysLeft?: number | null; notes?: string }> }[],
  completedByCategory: { category: string; tasks: Array<{ title: string; assigneeName: string; completedDate?: string }> }[],
  ceoItems: Array<{ title: string; assigneeName: string; ceoFlagReason?: string; notes?: string }>,
): string {
  const now = new Date();
  const lines: string[] = [];

  lines.push(`---`);
  lines.push(`tags: [회의록, ${reportType}]`);
  lines.push(`date: ${now.toISOString().slice(0, 10)}`);
  lines.push(`period: ${periodLabel}`);
  lines.push(`---`);
  lines.push('');
  lines.push(`# ${reportType} 회의 자료`);
  lines.push(`> 기간: ${periodLabel}`);
  lines.push(`> 생성일: ${now.toISOString().slice(0, 10)}`);
  lines.push('');

  // 요약
  lines.push('## 요약');
  lines.push(`| 전체 | 미완료 | 완료 | 지연 |`);
  lines.push(`|------|--------|------|------|`);
  lines.push(`| ${stats.total} | ${stats.incomplete} | ${stats.completed} | ${stats.delayed} |`);
  lines.push('');

  // 미완료 업무
  if (incompleteByCategory.length > 0) {
    lines.push('## 미완료 업무');
    for (const group of incompleteByCategory) {
      lines.push(`### ${group.category} (${group.tasks.length}건)`);
      for (const t of group.tasks) {
        const dday = t.daysLeft !== null && t.daysLeft !== undefined
          ? (t.daysLeft < 0 ? `⚠️ D+${Math.abs(t.daysLeft)}` : `D-${t.daysLeft}`)
          : '';
        lines.push(`- [ ] **${t.title}** — ${t.assigneeName} · ${t.progressRate}% ${dday}`);
        if (t.notes) lines.push(`  - 메모: ${t.notes}`);
      }
      lines.push('');
    }
  }

  // CEO 결재
  if (ceoItems.length > 0) {
    lines.push('## CEO 결재/검토 필요');
    for (const t of ceoItems) {
      lines.push(`- **${t.title}** — ${t.assigneeName}`);
      if (t.ceoFlagReason) lines.push(`  - 사유: ${t.ceoFlagReason}`);
    }
    lines.push('');
  }

  // 완료 업무
  if (completedByCategory.length > 0) {
    lines.push('## 완료 업무');
    for (const group of completedByCategory) {
      lines.push(`### ${group.category} (${group.tasks.length}건)`);
      for (const t of group.tasks) {
        lines.push(`- [x] **${t.title}** — ${t.assigneeName} ${t.completedDate || ''}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
