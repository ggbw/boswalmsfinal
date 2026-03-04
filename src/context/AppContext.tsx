import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { DB, User, createInitialDB } from '@/data/db';

interface ToastItem { id: number; msg: string; type: string; }

interface AppContextType {
  db: DB;
  setDb: React.Dispatch<React.SetStateAction<DB>>;
  currentUser: User | null;
  setCurrentUser: (u: User | null) => void;
  activePage: string;
  navigate: (page: string) => void;
  toast: (msg: string, type?: string) => void;
  toasts: ToastItem[];
  modalContent: { title: string; body: ReactNode; size?: string } | null;
  showModal: (title: string, body: ReactNode, size?: string) => void;
  closeModal: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(() => createInitialDB());
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activePage, setActivePage] = useState('dashboard');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [modalContent, setModalContent] = useState<{ title: string; body: ReactNode; size?: string } | null>(null);

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

  return (
    <AppContext.Provider value={{ db, setDb, currentUser, setCurrentUser, activePage, navigate, toast, toasts, modalContent, showModal, closeModal }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
