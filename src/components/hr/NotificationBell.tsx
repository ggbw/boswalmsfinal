/**
 * NotificationBell — top-bar dropdown that surfaces per-user HR notifications.
 *
 * Reads from `hr_notifications` (see migration 20260514000001_hr_notifications.sql).
 * Polls every 5 minutes; refreshes immediately when the dropdown is opened.
 * Inert when the table doesn't exist yet (PostgREST returns an error and the
 * fetch silently sets an empty list, so the icon shows zero unread).
 */

import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

interface NotificationRow {
  id: string;
  title: string;
  message: string;
  type: string | null;
  is_read: boolean | null;
  created_at: string | null;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function borderColor(type: string | null): string {
  if (type === 'expired')         return '#cf222e';
  if (type === '7_day_warning')   return '#d4920a';
  if (type === '30_day_warning')  return '#f0b429';
  if (type === 'leave')           return '#0d9488';
  if (type === 'loan')            return '#6366f1';
  return 'var(--border)';
}

export default function NotificationBell() {
  const { user } = useAuth();
  const { navigate } = useApp();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const fetchNotifications = async () => {
    if (!user?.id) {
      setNotifications([]);
      return;
    }
    try {
      const { data } = await supabase
        .from('hr_notifications')
        .select('id,title,message,type,is_read,created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      setNotifications((data ?? []) as NotificationRow[]);
    } catch {
      // Table missing or RLS denied — render an empty state silently.
      setNotifications([]);
    }
  };

  useEffect(() => {
    void fetchNotifications();
    const id = setInterval(() => { void fetchNotifications(); }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [user?.id]);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markOneRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    try {
      await supabase.from('hr_notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id);
    } catch {
      // Best-effort.
    }
  };

  const markAllRead = async () => {
    if (!user?.id) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await supabase
        .from('hr_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('is_read', false);
    } catch {
      // Best-effort.
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void fetchNotifications();
        }}
        title="Notifications"
        style={{
          position: 'relative',
          background: 'transparent',
          border: 'none',
          padding: 6,
          borderRadius: 999,
          cursor: 'pointer',
          color: 'var(--text2)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <i className="fa-solid fa-bell" style={{ fontSize: 14 }} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              width: 14,
              height: 14,
              borderRadius: 999,
              background: '#cf222e',
              color: '#fff',
              fontSize: 9,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            width: 380,
            maxWidth: '90vw',
            zIndex: 50,
            padding: 0,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            border: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 11,
                  color: 'var(--text2)',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                <i className="fa-solid fa-check-double" style={{ marginRight: 4 }} /> Mark all read
              </button>
            )}
          </div>

          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 12, padding: '32px 16px' }}>
                No notifications.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    borderLeft: `3px solid ${borderColor(n.type)}`,
                    background: n.is_read ? 'transparent' : 'rgba(37,99,235,0.05)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: n.is_read ? 'var(--text2)' : 'var(--text)' }}>
                      {n.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2, lineHeight: 1.4 }}>
                      {n.message}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                      {timeAgo(n.created_at)}
                    </div>
                  </div>
                  {!n.is_read && (
                    <button
                      type="button"
                      onClick={() => void markOneRead(n.id)}
                      title="Mark read"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text3)',
                        cursor: 'pointer',
                        padding: 2,
                        flexShrink: 0,
                      }}
                    >
                      <i className="fa-solid fa-xmark" style={{ fontSize: 11 }} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          <div
            style={{
              padding: '8px 14px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <button
              type="button"
              onClick={() => {
                navigate('hr-document-expiry');
                setOpen(false);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: 11,
                color: 'var(--text2)',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              View Expiry Report →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
