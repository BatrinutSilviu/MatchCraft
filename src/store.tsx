import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Tournament } from './types';
import { recompute } from './engine/progress';
import { api, ApiError, type User } from './api';

/** Where tournaments lived before accounts existed; offered for import after login. */
export const LEGACY_KEY = 'matchcraft:tournaments:v1';

export type AuthState = { status: 'loading' } | { status: 'out' } | { status: 'in'; user: User };

/** A change to a tournament, expressed as a function so it can be re-applied on top of someone else's edit. */
export type Change = (t: Tournament) => Tournament;

const MAX_CONFLICT_RETRIES = 3;

interface Store {
  auth: AuthState;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Sign in with a user returned by an endpoint that already set the session (e.g. password reset). */
  signedIn: (user: User) => void;
  refreshUser: () => Promise<void>;
  tournaments: Tournament[];
  loaded: boolean;
  get: (id: string) => Tournament | undefined;
  create: (t: Tournament) => Promise<boolean>;
  /** Applies a change locally at once, then saves it. Resolves false if it could not be saved. */
  update: (id: string, change: Change) => Promise<boolean>;
  /** Pulls the latest copy, e.g. to see a co-organiser's changes. */
  refresh: (id: string) => Promise<void>;
  reloadAll: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Drops a tournament from the local list after leaving it. */
  forget: (id: string) => void;
  setShared: (id: string, enabled: boolean) => Promise<void>;
  error: string;
  showError: (message: string) => void;
  dismissError: () => void;
}

const StoreContext = createContext<Store | null>(null);

const touch = (t: Tournament) => recompute({ ...t, updatedAt: Date.now() });

export function StoreProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [tournaments, setTournamentsState] = useState<Tournament[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const current = useRef<Tournament[]>([]);
  /** Last copy the server confirmed, per tournament: the base every queued change is applied to. */
  const confirmed = useRef(new Map<string, Tournament>());
  // Saves for the same tournament run one after another so an older write can't land last.
  const queues = useRef(new Map<string, Promise<unknown>>());
  const pending = useRef(new Map<string, number>());

  const setTournaments = useCallback((fn: (all: Tournament[]) => Tournament[]) => {
    current.current = fn(current.current);
    setTournamentsState(current.current);
  }, []);

  const putLocal = useCallback((t: Tournament) => setTournaments((all) => {
    const i = all.findIndex((x) => x.id === t.id);
    if (i === -1) return [t, ...all];
    const copy = [...all];
    copy[i] = t;
    return copy;
  }), [setTournaments]);

  const acceptServer = useCallback((t: Tournament) => {
    confirmed.current.set(t.id, t);
    // Only show the server copy once no local edits are still waiting, so the UI never jumps back.
    if (!pending.current.get(t.id)) putLocal(t);
  }, [putLocal]);

  const replaceAll = useCallback((list: Tournament[]) => {
    confirmed.current = new Map(list.map((t) => [t.id, t]));
    setTournaments(() => list);
  }, [setTournaments]);

  useEffect(() => {
    api.me()
      .then(({ user }) => setAuth(user ? { status: 'in', user } : { status: 'out' }))
      .catch(() => setAuth({ status: 'out' }));
  }, []);

  const userId = auth.status === 'in' ? auth.user.id : null;
  const reloadAll = useCallback(async () => {
    try {
      replaceAll((await api.list()).tournaments);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }, [replaceAll]);

  useEffect(() => {
    replaceAll([]);
    setLoaded(false);
    if (userId) void reloadAll();
  }, [userId, reloadAll, replaceAll]);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) setAuth({ status: 'out' });
    setError(e instanceof Error ? e.message : 'Something went wrong.');
  }, []);

  const enqueue = useCallback(<T,>(id: string, job: () => Promise<T>): Promise<T> => {
    const prev = queues.current.get(id) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(job);
    queues.current.set(id, run);
    return run;
  }, []);

  const create = useCallback(async (t: Tournament) => {
    const fresh = touch(t);
    putLocal(fresh);
    try {
      const { tournament } = await enqueue(t.id, () => api.save(fresh));
      acceptServer(tournament);
      return true;
    } catch (e) {
      setTournaments((all) => all.filter((x) => x.id !== t.id));
      fail(e);
      return false;
    }
  }, [enqueue, putLocal, acceptServer, setTournaments, fail]);

  const update = useCallback(async (id: string, change: Change) => {
    const local = current.current.find((t) => t.id === id);
    if (!local) return false;
    putLocal(touch(change(local)));
    pending.current.set(id, (pending.current.get(id) ?? 0) + 1);

    const ok = await enqueue(id, async () => {
      let base = confirmed.current.get(id) ?? local;
      for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
        try {
          const { tournament } = await api.save(touch(change(base)), base.version);
          confirmed.current.set(id, tournament);
          return true;
        } catch (e) {
          const latest = e instanceof ApiError && e.status === 409 ? (e.data.tournament as Tournament | undefined) : undefined;
          if (!latest) {
            fail(e);
            return false;
          }
          // A co-organiser saved first: re-apply this change on top of their version.
          confirmed.current.set(id, latest);
          base = latest;
        }
      }
      setError('This tournament is being edited a lot right now. Your last change wasn’t saved; please try again.');
      return false;
    });

    const left = (pending.current.get(id) ?? 1) - 1;
    pending.current.set(id, left);
    if (left === 0) {
      const server = confirmed.current.get(id);
      if (server) putLocal(server);
    }
    return ok;
  }, [enqueue, putLocal, fail]);

  const refresh = useCallback(async (id: string) => {
    if (pending.current.get(id)) return;
    try {
      const { tournament } = await api.get(id);
      const known = confirmed.current.get(id);
      if (!known || (tournament.version ?? 0) > (known.version ?? 0)) acceptServer(tournament);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // Deleted, or this user was removed as co-organiser.
        setTournaments((all) => all.filter((t) => t.id !== id));
      }
    }
  }, [acceptServer, setTournaments]);

  const forget = useCallback((id: string) => {
    confirmed.current.delete(id);
    setTournaments((all) => all.filter((t) => t.id !== id));
  }, [setTournaments]);

  const remove = useCallback(async (id: string) => {
    try {
      await api.remove(id);
      forget(id);
    } catch (e) {
      fail(e);
    }
  }, [fail, forget]);

  const setShared = useCallback(async (id: string, enabled: boolean) => {
    try {
      const { shareId } = await api.share(id, enabled);
      setTournaments((all) => all.map((t) => (t.id === id ? { ...t, shareId: shareId ?? undefined } : t)));
      const c = confirmed.current.get(id);
      if (c) confirmed.current.set(id, { ...c, shareId: shareId ?? undefined });
    } catch (e) {
      fail(e);
    }
  }, [fail, setTournaments]);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.login(email, password);
    setAuth({ status: 'in', user });
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string) => {
    const { user } = await api.signup(name, email, password);
    setAuth({ status: 'in', user });
  }, []);

  const signedIn = useCallback((user: User) => setAuth({ status: 'in', user }), []);

  const refreshUser = useCallback(async () => {
    const { user } = await api.me();
    setAuth(user ? { status: 'in', user } : { status: 'out' });
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setAuth({ status: 'out' });
    navigate('/');
  }, []);

  const value = useMemo<Store>(() => ({
    auth, login, signup, logout, signedIn, refreshUser,
    tournaments, loaded, get: (id) => tournaments.find((t) => t.id === id),
    create, update, refresh, reloadAll, remove, forget, setShared,
    error, showError: setError, dismissError: () => setError(''),
  }), [auth, login, signup, logout, signedIn, refreshUser, tournaments, loaded, create, update, refresh, reloadAll, remove, forget, setShared, error]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore must be used inside StoreProvider');
  return s;
}

export function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#/, '') || '/';
}

export function navigate(path: string) {
  window.location.hash = path;
}
