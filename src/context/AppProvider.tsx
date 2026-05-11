import { useCallback, useReducer, useState, type ReactNode } from 'react';
import type { User } from '@/data/db';
import { useDbData } from '@/hooks/useDbData';
import { AppContext, type AppProviderProps } from '@/context/AppContext';

interface ToastItem {
  id: number;
  msg: string;
  type: string;
}

interface PageState {
  activePage: string;
  pageParams: Record<string, unknown>;
}

type PageAction = { type: 'navigate'; page: string; params?: Record<string, unknown> };

function pageReducer(state: PageState, action: PageAction): PageState {
  switch (action.type) {
    case 'navigate':
      return { activePage: action.page, pageParams: action.params ?? {} };
    default:
      return state;
  }
}

export function AppProvider({ children, authUser, onSignOut, initialPage }: AppProviderProps) {
  const { db, loading, reload, setDb } = useDbData();
  const [pageState, dispatchPage] = useReducer(pageReducer, { activePage: initialPage ?? 'dashboard', pageParams: {} });
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [modalContent, setModalContent] = useState<{ title: string; body: ReactNode; size?: string } | null>(null);

  const setCurrentUser = (u: User | null) => {
    if (!u) onSignOut();
  };

  const navigate = useCallback(
    (page: string, params?: Record<string, unknown>) => dispatchPage({ type: 'navigate', page, params }),
    [],
  );

  const toast = useCallback((msg: string, type: string = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
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
    <AppContext.Provider
      value={{
        db,
        setDb,
        currentUser: authUser,
        setCurrentUser,
        activePage: pageState.activePage,
        pageParams: pageState.pageParams,
        navigate,
        toast,
        toasts,
        modalContent,
        showModal,
        closeModal,
        reloadDb: reload,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
