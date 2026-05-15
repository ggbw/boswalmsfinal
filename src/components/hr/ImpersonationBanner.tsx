/**
 * ImpersonationBanner — full-width amber banner shown when the current user's
 * session is the result of an admin impersonation.
 *
 * Detection works via the `impersonation_sessions` table (see migration
 * 20260514000003_impersonation_sessions.sql). The hr-impersonate-user edge
 * function inserts a row when an admin starts an impersonation; this
 * component reads the row from the target user's perspective (RLS allows
 * target_user_id = auth.uid()) and renders the banner until the session is
 * ended or expires.
 *
 * Exiting the impersonation:
 *   1. Marks the session row ended_at = now()
 *   2. Signs out the current (target) session
 *   3. The user lands back on LoginScreen and can sign in with their own
 *      credentials
 *
 * Bounded false-positive: if the target user signs in normally within the
 * 2-hour window of a recent impersonation, the banner may still show. The
 * "Exit" action will sign them out — they re-authenticate and it goes away.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

interface SessionRow {
  id: string;
  admin_user_id: string;
  started_at: string | null;
  expires_at: string | null;
  admin_name: string | null;
}

export default function ImpersonationBanner() {
  const { user, signOut } = useAuth();
  const [active, setActive] = useState<SessionRow | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!user?.id) {
      setActive(null);
      return;
    }
    void (async () => {
      try {
        const { data: rows } = await supabase
          .from('impersonation_sessions')
          .select('id, admin_user_id, started_at, expires_at')
          .eq('target_user_id', user.id)
          .is('ended_at', null)
          .gt('expires_at', new Date().toISOString())
          .order('started_at', { ascending: false })
          .limit(1);
        if (!alive) return;
        const row = (rows ?? [])[0] as { id: string; admin_user_id: string; started_at: string; expires_at: string } | undefined;
        if (!row) {
          setActive(null);
          return;
        }
        // Pull the admin's display name from profiles for the banner copy.
        const { data: prof } = await supabase
          .from('profiles')
          .select('name')
          .eq('user_id', row.admin_user_id)
          .maybeSingle();
        if (!alive) return;
        setActive({
          id: row.id,
          admin_user_id: row.admin_user_id,
          started_at: row.started_at ?? null,
          expires_at: row.expires_at ?? null,
          admin_name: (prof as { name?: string } | null)?.name ?? null,
        });
      } catch {
        // Table missing or RLS denied — banner is inert.
        if (alive) setActive(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.id]);

  if (!active) return null;

  const handleExit = async () => {
    if (exiting) return;
    setExiting(true);
    try {
      await supabase
        .from('impersonation_sessions')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', active.id);
    } catch {
      // Continue with sign-out even if the row write failed.
    }
    await signOut();
    // signOut clears session; AppLayout unmounts and LoginScreen renders.
  };

  const adminLabel = active.admin_name ? ` by ${active.admin_name}` : '';

  return (
    <div
      style={{
        background: '#d4920a',
        color: '#fff',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        fontSize: 12,
        fontWeight: 600,
        boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <i className="fa-solid fa-user-secret" style={{ fontSize: 14 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          You are currently impersonated{adminLabel}. Any action you take is logged against this account.
        </span>
      </div>
      <button
        type="button"
        onClick={() => void handleExit()}
        disabled={exiting}
        style={{
          background: 'rgba(0,0,0,0.18)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.5)',
          padding: '4px 12px',
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          cursor: exiting ? 'wait' : 'pointer',
          flexShrink: 0,
        }}
      >
        <i className="fa-solid fa-right-from-bracket" style={{ marginRight: 6 }} />
        {exiting ? 'Exiting…' : 'Exit Impersonation'}
      </button>
    </div>
  );
}
