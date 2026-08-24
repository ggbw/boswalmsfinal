import { useEffect } from 'react';
import { touchAuditSession } from '@/lib/audit';

/**
 * Keeps the current audit session marked as alive.
 *
 * "Duration of access" is only trustworthy if the end of a session is known,
 * and most people never sign out — they close the tab, or the laptop lid.
 * A periodic touch of `last_seen_at` is what lets close_stale_user_sessions()
 * later say "this session ended at 16:42", instead of leaving it open for ever
 * or, worse, crediting someone with fourteen hours of access because a tab was
 * left open overnight.
 *
 * Two minutes, and only while the tab is visible. A background tab is not
 * access, and polling one would inflate the very number this exists to keep
 * honest. The extra touch on becoming visible again closes the gap when
 * someone returns between intervals.
 */
const HEARTBEAT_MS = 2 * 60 * 1000;

export function useAuditHeartbeat(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    void touchAuditSession();

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void touchAuditSession();
    }, HEARTBEAT_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') void touchAuditSession();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}
