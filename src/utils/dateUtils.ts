import { Timestamp } from 'firebase/firestore';
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  differenceInDays,
  addWeeks,
  subWeeks,
} from 'date-fns';
import { ko } from 'date-fns/locale';

export function toDate(ts: Timestamp | null | undefined): Date | null {
  if (!ts) return null;
  return ts instanceof Timestamp ? ts.toDate() : new Date(ts as unknown as string);
}

export function formatDate(ts: Timestamp | null | undefined, pattern = 'yyyy.MM.dd'): string {
  const d = toDate(ts);
  if (!d) return '-';
  return format(d, pattern, { locale: ko });
}

export function formatShort(ts: Timestamp | null | undefined): string {
  return formatDate(ts, 'M/d');
}

export function daysLeft(ts: Timestamp | null | undefined): number | null {
  const d = toDate(ts);
  if (!d) return null;
  return differenceInDays(d, new Date());
}

export function dDayLabel(ts: Timestamp | null | undefined): string {
  const days = daysLeft(ts);
  if (days === null) return '';
  if (days === 0) return 'D-day';
  if (days < 0) return `D+${Math.abs(days)}`;
  return `D-${days}`;
}

export function getWeekRange(baseDate: Date = new Date()) {
  const start = startOfWeek(baseDate, { weekStartsOn: 1 });
  const end = endOfWeek(baseDate, { weekStartsOn: 1 });
  return { start, end };
}

export function getLastWeekRange(baseDate: Date = new Date()) {
  const lastWeek = subWeeks(baseDate, 1);
  return getWeekRange(lastWeek);
}

export function getNextWeekRange(baseDate: Date = new Date()) {
  const nextWeek = addWeeks(baseDate, 1);
  return getWeekRange(nextWeek);
}

export function getTwoWeekRange(baseDate: Date = new Date()) {
  const twoWeeksAgo = subWeeks(baseDate, 2);
  const start = startOfWeek(twoWeeksAgo, { weekStartsOn: 1 });
  const end = endOfWeek(subWeeks(baseDate, 1), { weekStartsOn: 1 });
  return { start, end };
}

export function getMonthRange(year: number, month: number) {
  const date = new Date(year, month - 1, 1);
  return { start: startOfMonth(date), end: endOfMonth(date) };
}

export function formatPeriod(start: Date, end: Date): string {
  return `${format(start, 'yyyy.MM.dd')} ~ ${format(end, 'yyyy.MM.dd')}`;
}

export function toTimestamp(date: Date | string | null): Timestamp | null {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  return Timestamp.fromDate(d);
}
