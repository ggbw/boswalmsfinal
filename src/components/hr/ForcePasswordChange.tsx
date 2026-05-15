/**
 * First-login password reset modal (ported from
 * motho2/src/components/ForcePasswordChange.tsx).
 *
 * Renders ONLY when the current user's profile row has
 * `must_change_password = true`. The flag lives on the `profiles` table; if
 * that column is not present in the live schema the modal is inert (the read
 * in useUserRole returns undefined → false). To activate:
 *   1. Add column: ALTER TABLE profiles ADD COLUMN must_change_password BOOLEAN DEFAULT false;
 *   2. Set the flag when admin-creates a user with a temp password.
 *
 * The mount point is AppLayout.tsx; this component is full-screen and blocking.
 */

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';

interface Props {
  userId: string;
  onDone: () => void;
}

export default function ForcePasswordChange({ userId, onDone }: Props) {
  const { toast } = useApp();
  const { refreshProfile } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast('Password must be at least 8 characters.', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast('Passwords do not match.', 'error');
      return;
    }
    setSaving(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password: newPassword });
      if (authError) throw authError;
      // Clear the flag on the profile row. Tolerate the column being absent
      // (older schemas) — the password change itself is what matters.
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ must_change_password: false } as never)
        .eq('user_id', userId);
      if (profileErr && !/column .* does not exist/i.test(profileErr.message)) {
        // Real error — surface it, but the password is already updated.
        toast(profileErr.message, 'error');
      }
      await refreshProfile();
      toast('Password updated. Welcome!', 'success');
      onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update password.';
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="card"
        style={{ maxWidth: 440, width: '100%', margin: '0 16px', padding: 28 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(212,146,10,0.15)',
              color: '#d4920a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <i className="fa-solid fa-shield-halved" />
          </div>
          <div>
            <div className="page-title" style={{ fontSize: 16, marginBottom: 2 }}>
              Change Your Password
            </div>
            <div className="page-sub" style={{ fontSize: 12 }}>
              You must set a new password before continuing.
            </div>
          </div>
        </div>

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>New Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showNew ? 'text' : 'password'}
                className="form-input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                autoFocus
                style={{ paddingRight: 32 }}
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text3)',
                  cursor: 'pointer',
                }}
                aria-label={showNew ? 'Hide password' : 'Show password'}
              >
                <i className={`fa-solid ${showNew ? 'fa-eye-slash' : 'fa-eye'}`} />
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>Confirm New Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showConfirm ? 'text' : 'password'}
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                style={{ paddingRight: 32 }}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text3)',
                  cursor: 'pointer',
                }}
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
              >
                <i className={`fa-solid ${showConfirm ? 'fa-eye-slash' : 'fa-eye'}`} />
              </button>
            </div>
            {mismatch && (
              <div style={{ fontSize: 11, color: '#cf222e', marginTop: 4 }}>
                Passwords do not match.
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={saving || newPassword.length < 8 || newPassword !== confirmPassword}
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 8 }}
          >
            {saving ? 'Saving…' : 'Set New Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
