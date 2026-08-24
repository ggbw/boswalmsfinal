import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { startAuditSession, endAuditSession, logAuthFailure } from '@/lib/audit';
import type { User, Session } from '@supabase/supabase-js';

interface Profile {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  dept: string | null;
  code: string | null;
  student_ref: string | null;
  student_id: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfileAndRole = async (userId: string) => {
    const [profileRes, roleRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', userId).single(),
      supabase.from('user_roles').select('role').eq('user_id', userId).single(),
    ]);
    if (profileRes.data) setProfile(profileRes.data as Profile);
    if (roleRes.data) {
      setRole(roleRes.data.role);
    } else {
      // No role found — check if this user is an applicant
      const { data: applicant } = await supabase
        .from('applicants')
        .select('id')
        .eq('user_id', userId)
        .single();
      setRole(applicant ? 'applicant' : null);
    }
    setLoading(false);

    // Open the audit session here rather than in signIn(), because this runs
    // for every route into the app — password sign-in, the magic link used by
    // impersonation, and a restored session on reload. Doing it in signIn()
    // would miss two of the three. startAuditSession is idempotent per user,
    // so the token refreshes that also land here do not add a second row.
    void startAuditSession(userId);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        // Use setTimeout to avoid Supabase deadlock
        setTimeout(() => fetchProfileAndRole(session.user.id), 0);
      } else {
        setProfile(null);
        setRole(null);
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfileAndRole(session.user.id);
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    // A refused sign-in leaves no other trace anywhere in the system. Recorded
    // with the attempted username and the caller's IP, twenty of these in a
    // minute are recognisable as what they are.
    if (error) void logAuthFailure(email, error.message);
    return { error: error?.message || null };
  };

  const signOut = async () => {
    // Before signOut, not after: end_user_session checks auth.uid(), so once
    // the token is gone the row can no longer be closed by its owner and the
    // duration would have to be guessed by the idle sweep instead of measured.
    await endAuditSession('signout');
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRole(null);
  };

  // Re-fetch the current profile + role. Used after first-login password
  // changes and similar flows that mutate the row without re-authenticating.
  const refreshProfile = async () => {
    const uid = session?.user?.id;
    if (!uid) return;
    await fetchProfileAndRole(uid);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, role, loading, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
