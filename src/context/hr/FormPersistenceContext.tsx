// FormPersistenceContext — global registry for multi-form draft persistence.
// sessionStorage-backed, debounced 300 ms, flushes on tab hide / unload.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface FPCtx {
  queue: (formId: string, data: unknown) => void;
  read: (formId: string) => unknown;
  discard: (formId: string) => void;
}

const FormPersistenceCtx = createContext<FPCtx | null>(null);

const SS_PREFIX = 'boswalms-fp-';
const DEBOUNCE_MS = 300;

export const FormPersistenceProvider = ({ children }: { children: ReactNode }) => {
  const pending = useRef<Map<string, unknown>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const flushAll = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
    pending.current.forEach((data, formId) => {
      try {
        sessionStorage.setItem(SS_PREFIX + formId, JSON.stringify(data));
      } catch {
        /* quota — ignore */
      }
    });
    pending.current.clear();
  }, []);

  useEffect(() => {
    const handler = () => {
      if (document.hidden) flushAll();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [flushAll]);

  useEffect(() => {
    window.addEventListener('beforeunload', flushAll);
    return () => window.removeEventListener('beforeunload', flushAll);
  }, [flushAll]);

  useEffect(() => () => flushAll(), [flushAll]);

  const queue = useCallback((formId: string, data: unknown) => {
    pending.current.set(formId, data);
    const existing = timers.current.get(formId);
    if (existing !== undefined) clearTimeout(existing);
    const t = setTimeout(() => {
      const latest = pending.current.get(formId);
      if (latest !== undefined) {
        try {
          sessionStorage.setItem(SS_PREFIX + formId, JSON.stringify(latest));
        } catch {
          /* quota */
        }
        pending.current.delete(formId);
      }
      timers.current.delete(formId);
    }, DEBOUNCE_MS);
    timers.current.set(formId, t);
  }, []);

  const read = useCallback((formId: string): unknown => {
    try {
      const raw = sessionStorage.getItem(SS_PREFIX + formId);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const discard = useCallback((formId: string) => {
    const t = timers.current.get(formId);
    if (t !== undefined) {
      clearTimeout(t);
      timers.current.delete(formId);
    }
    pending.current.delete(formId);
    try {
      sessionStorage.removeItem(SS_PREFIX + formId);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <FormPersistenceCtx.Provider value={{ queue, read, discard }}>
      {children}
    </FormPersistenceCtx.Provider>
  );
};

export function useFormPersistence<T extends Record<string, unknown>>(formId: string) {
  const ctx = useContext(FormPersistenceCtx);
  if (!ctx) {
    throw new Error('useFormPersistence must be called inside <FormPersistenceProvider>');
  }
  const { queue, read, discard } = ctx;
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const lastSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDataRef = useRef<T | null>(null);

  const track = useCallback(
    (data: T) => {
      latestDataRef.current = data;
      queue(formId, data);
      setHasUnsaved(true);
      if (lastSavedTimer.current) clearTimeout(lastSavedTimer.current);
      lastSavedTimer.current = setTimeout(() => setLastSaved(new Date()), 350);
    },
    [queue, formId],
  );

  const restore = useCallback((): T | null => read(formId) as T | null, [read, formId]);

  const clear = useCallback(() => {
    latestDataRef.current = null;
    if (lastSavedTimer.current) clearTimeout(lastSavedTimer.current);
    discard(formId);
    setHasUnsaved(false);
    setLastSaved(null);
  }, [discard, formId]);

  useEffect(() => {
    return () => {
      if (lastSavedTimer.current) clearTimeout(lastSavedTimer.current);
      if (latestDataRef.current !== null) {
        try {
          sessionStorage.setItem(SS_PREFIX + formId, JSON.stringify(latestDataRef.current));
        } catch {
          /* ignore */
        }
      }
    };
  }, [formId]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsaved) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsaved]);

  return { track, restore, clear, hasUnsaved, lastSaved };
}

export function useUnsavedChangesWarning(hasUnsaved: boolean): void {
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsaved) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsaved]);
}
