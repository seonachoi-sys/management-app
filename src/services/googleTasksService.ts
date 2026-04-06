import { Timestamp } from 'firebase/firestore';
import type { Task } from '../types';

const SCOPES = 'https://www.googleapis.com/auth/tasks';
const TASK_LIST_NAME = '경영관리팀 업무';

let gapiLoaded = false;
let tokenClient: google.accounts.oauth2.TokenClient | null = null;

/* ─── GAPI 초기화 ─── */
export async function initGoogleTasks(): Promise<void> {
  if (gapiLoaded) return;

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google API 스크립트 로드 실패'));
    document.body.appendChild(script);
  });

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Identity 스크립트 로드 실패'));
    document.body.appendChild(script);
  });

  await new Promise<void>((resolve, reject) => {
    gapi.load('client', {
      callback: () => resolve(),
      onerror: () => reject(new Error('GAPI client 로드 실패')),
    });
  });

  await gapi.client.init({
    apiKey: process.env.REACT_APP_GOOGLE_API_KEY,
    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest'],
  });

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: process.env.REACT_APP_GOOGLE_CLIENT_ID || '',
    scope: SCOPES,
    callback: () => {},
  });

  gapiLoaded = true;
}

/* ─── 인증 ─── */
export function requestAccess(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error('Google Tasks가 초기화되지 않았습니다.'));
      return;
    }
    tokenClient.callback = (resp: google.accounts.oauth2.TokenResponse) => {
      if (resp.error) {
        reject(new Error(`인증 실패: ${resp.error}`));
        return;
      }
      resolve();
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

export function isSignedIn(): boolean {
  return gapiLoaded && !!gapi.client.getToken();
}

/* ─── 태스크 리스트 가져오기/생성 ─── */
async function getOrCreateTaskList(): Promise<string> {
  const res = await gapi.client.tasks.tasklists.list();
  const existing = res.result.items?.find((l: { title?: string }) => l.title === TASK_LIST_NAME);
  if (existing?.id) return existing.id;

  const created = await gapi.client.tasks.tasklists.insert({
    resource: { title: TASK_LIST_NAME },
  });
  return created.result.id!;
}

/* ─── Google Tasks 목록 캐시 (동기화 세션 내 재사용) ─── */
let _cachedGoogleTasks: Array<{ id: string; notes: string }> | null = null;

export function clearGoogleTasksCache(): void {
  _cachedGoogleTasks = null;
}

async function getExistingGoogleTasks(listId: string): Promise<Array<{ id: string; notes: string }>> {
  if (_cachedGoogleTasks) return _cachedGoogleTasks;

  const res = await gapi.client.tasks.tasks.list({
    tasklist: listId,
    showCompleted: true,
    showHidden: true,
    maxResults: 100,
  });
  _cachedGoogleTasks = (res.result.items || []).map((item: Record<string, unknown>) => ({
    id: item.id as string,
    notes: (item.notes as string) || '',
  }));
  return _cachedGoogleTasks;
}

/* ─── Firestore → Google Tasks 동기화 ─── */
export async function syncTaskToGoogleTasks(task: Task): Promise<string | null> {
  if (!isSignedIn()) return null;

  const listId = await getOrCreateTaskList();
  const dueDate = task.dueDate instanceof Timestamp ? task.dueDate.toDate() : null;
  const notes = `[taskId:${task.taskId}]\n${task.description || ''}\n담당: ${task.assigneeName || '-'}\n카테고리: ${task.category}`;

  const resource: Record<string, unknown> = {
    title: task.title,
    notes,
    status: task.status === '완료' ? 'completed' : 'needsAction',
  };

  if (dueDate) {
    resource.due = dueDate.toISOString();
  }

  // 기존 Google Task가 있으면 업데이트
  if (task.googleTaskId) {
    try {
      const res = await gapi.client.tasks.tasks.update({
        tasklist: listId,
        task: task.googleTaskId,
        resource,
      });
      return res.result.id || null;
    } catch {
      // Google 측에서 삭제된 경우 → 아래에서 중복 확인 후 생성
    }
  }

  // googleTaskId가 없거나 업데이트 실패 시, 기존 Google Tasks에서 같은 taskId 태그가 있는지 확인
  const existingTasks = await getExistingGoogleTasks(listId);
  const marker = `[taskId:${task.taskId}]`;
  const found = existingTasks.find(gt => gt.notes.includes(marker));

  if (found) {
    // 이미 존재 → 업데이트
    try {
      const res = await gapi.client.tasks.tasks.update({
        tasklist: listId,
        task: found.id,
        resource,
      });
      return res.result.id || null;
    } catch {
      // 업데이트 실패 시 새로 생성
    }
  }

  // 새로 생성
  const res = await gapi.client.tasks.tasks.insert({
    tasklist: listId,
    resource,
  });
  const newId = res.result.id || null;

  // 캐시에 추가 (같은 세션 내 중복 방지)
  if (newId && _cachedGoogleTasks) {
    _cachedGoogleTasks.push({ id: newId, notes });
  }

  return newId;
}

/* ─── Google Tasks → Firestore 변경사항 가져오기 ─── */
export interface GoogleTaskChange {
  googleTaskId: string;
  title: string;
  notes: string;
  status: 'needsAction' | 'completed';
  due: string | null;
  firestoreTaskId: string | null; // notes에서 추출
  updated: string;
}

export async function fetchGoogleTasks(): Promise<GoogleTaskChange[]> {
  if (!isSignedIn()) return [];

  const listId = await getOrCreateTaskList();
  const res = await gapi.client.tasks.tasks.list({
    tasklist: listId,
    showCompleted: true,
    showHidden: true,
    maxResults: 100,
  });

  const items = res.result.items || [];
  return items.map((item: Record<string, unknown>) => {
    const notes = (item.notes as string) || '';
    const match = notes.match(/\[taskId:([^\]]+)\]/);
    return {
      googleTaskId: item.id as string,
      title: (item.title as string) || '',
      notes,
      status: item.status as 'needsAction' | 'completed',
      due: (item.due as string) || null,
      firestoreTaskId: match ? match[1] : null,
      updated: (item.updated as string) || '',
    };
  });
}

/* ─── Google Task 삭제 ─── */
export async function deleteGoogleTask(googleTaskId: string): Promise<void> {
  if (!isSignedIn()) return;
  const listId = await getOrCreateTaskList();
  await (gapi.client.tasks.tasks as any)['delete']({
    tasklist: listId,
    task: googleTaskId,
  });
}

/* ─── 마지막 동기화 시간 ─── */
const SYNC_TIME_KEY = 'google-tasks-last-sync';

export function getLastSyncTime(): string | null {
  return localStorage.getItem(SYNC_TIME_KEY);
}

export function setLastSyncTime(): void {
  localStorage.setItem(SYNC_TIME_KEY, new Date().toISOString());
}
