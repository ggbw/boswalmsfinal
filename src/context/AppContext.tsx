import { createContext, useContext, type ReactNode } from 'react';
import type { DB, User } from '@/data/db';
import type { LoadFailure } from '@/hooks/useDbData';

interface ToastItem { id: number; msg: string; type: string; }

interface AppContextType {
  db: DB;
  /**
   * Queries that failed during the last load. Empty when everything arrived.
   * Surfaced so a failed query stops looking identical to an empty table —
   * previously both rendered as "No students in this class".
   */
  failures: LoadFailure[];
  setDb: React.Dispatch<React.SetStateAction<DB | null>>;
  currentUser: User | null;
  setCurrentUser: (u: User | null) => void;
  activePage: string;
  pageParams: Record<string, unknown>;
  navigate: (page: string, params?: Record<string, unknown>) => void;
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
  initialPage?: string;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
