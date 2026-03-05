import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { DB, User } from '@/data/db';
import { useAuth } from '@/hooks/useAuth';
import { useDbData } from '@/hooks/useDbData';

interface ToastItem { id: number; msg: string; type: string; }

interface AppContextType {
  db: DB;
  setDb: React.Dispatch<React.SetStateAction<DB | null>>;
  currentUser: User | null;
  setCurrentUser: (u: User | null) => void;
  activePage: string;
  navigate: (page: string) => void;
  toast: (msg: string, type?: string) => void;
  toasts: ToastItem[];
  modalContent: { title: string; body: ReactNode; size?: string } | null;
  showModal: (title: string, body: ReactNode, size?: string) => void;
  closeModal: () => void;
  reloadDb: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { profile, role, signOut } = useAuth();
  const { db, loading, reload, setDb } = useDbData();
  const [activePage, setActivePage] = useState('dashboard');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [modalContent, setModalContent] = useState<{ title: string; body: ReactNode; size?: string } | null>(null);

  // Create a compatible User object from auth profile
  const currentUser: User | null = profile ? {
    id: profile.user_id,
    username: profile.email || '',
    password: '',
    role: role || 'admin',
    name: profile.name,
    changed: false,
    email: profile.email || '',
    dept: profile.dept || '',
    code: profile.code || '',
    studentRef: profile.student_ref || '',
    studentId: profile.student_id || '',
  } : null;

  const setCurrentUser = (u: User | null) => {
    if (!u) signOut();
  };

  const navigate = useCallback((page: string) => setActivePage(page), []);

  const toast = useCallback((msg: string, type: string = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const showModal = useCallback((title: string, body: ReactNode, size?: string) => {
    setModalContent({ title, body, size });
  }, []);

  const closeModal = useCallback(() => setModalContent(null), []);

  if (loading || !db) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0d1117', color: '#e6edf3' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>Loading...</div>
          <div style={{ fontSize: 12, color: '#484f58' }}>Connecting to database</div>
        </div>
      </div>
    );
  }

  return (
    <AppContext.Provider value={{ 
      db, setDb, currentUser, setCurrentUser, activePage, navigate, 
      toast, toasts, modalContent, showModal, closeModal, reloadDb: reload 
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
