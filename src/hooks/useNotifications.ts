import { useState, useEffect, useCallback, useRef } from 'react';
import type { Notification } from '../types';
import {
  subscribeNotifications,
  markAsRead,
  markAllAsRead,
  checkDeadlineNotifications,
} from '../services/notificationService';

export function useNotifications(userId: string | undefined) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!userId) return;

    const unsub = subscribeNotifications(
      userId,
      (data) => {
        setNotifications(data);
        setLoading(false);
      },
      () => setLoading(false),
    );

    // 앱 실행 시 마감 알림 체크 (1회)
    if (!checkedRef.current) {
      checkedRef.current = true;
      checkDeadlineNotifications(userId).catch(() => {});
    }

    return unsub;
  }, [userId]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const read = useCallback(async (notifId: string) => {
    await markAsRead(notifId);
  }, []);

  const readAll = useCallback(async () => {
    if (!userId) return;
    await markAllAsRead(userId);
  }, [userId]);

  return { notifications, unreadCount, loading, read, readAll };
}
