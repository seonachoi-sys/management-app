import React, { useState, useRef, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Timestamp } from 'firebase/firestore';
import type { Notification } from '../types';

interface Props {
  notifications: Notification[];
  unreadCount: number;
  onRead: (id: string) => void;
  onReadAll: () => void;
  onClickNotif: (taskId: string) => void;
}

export default function NotificationCenter({
  notifications,
  unreadCount,
  onRead,
  onReadAll,
  onClickNotif,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const formatTime = (ts: Timestamp) => {
    const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts as unknown as string);
    return formatDistanceToNow(d, { addSuffix: true, locale: ko });
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="tm-notif-trigger" onClick={() => setOpen(!open)}>
        &#128276;
        {unreadCount > 0 && (
          <span className="tm-notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="tm-notif-panel">
          <div className="tm-notif-header">
            <h4>알림</h4>
            {unreadCount > 0 && (
              <button className="tm-notif-readall" onClick={onReadAll}>
                전체 읽음
              </button>
            )}
          </div>
          <div className="tm-notif-list">
            {notifications.length === 0 ? (
              <div className="tm-notif-empty">알림이 없습니다</div>
            ) : (
              notifications.slice(0, 30).map((n) => (
                <div
                  key={n.notifId}
                  className={`tm-notif-item ${!n.isRead ? 'unread' : ''}`}
                  onClick={() => {
                    if (!n.isRead) onRead(n.notifId);
                    if (n.taskId) onClickNotif(n.taskId);
                    setOpen(false);
                  }}
                >
                  <div className={`tm-notif-dot type-${n.type}`} />
                  <div>
                    <div className="tm-notif-text">{n.message}</div>
                    <div className="tm-notif-time">{n.createdAt ? formatTime(n.createdAt) : ''}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
