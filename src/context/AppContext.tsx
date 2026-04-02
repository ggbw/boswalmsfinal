import { createContext, useContext, type ReactNode } from 'react';
import type { DB, User } from '@/data/db';

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

export const AppContext = createContext<AppContextType | null>(null);

export interface AppProviderProps {
  children: ReactNode;
  authUser: User;
  onSignOut: () => void;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
