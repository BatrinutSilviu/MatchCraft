import type { Tournament } from './types';

export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  plan: 'free' | 'club';
}

export type BillingConfig =
  | { enabled: false }
  | { enabled: true; provider: 'stripe' | 'fake'; prices: { event: string; club: string }; freeParticipantLimit: number };

export interface Registration {
  id: string;
  participantId: string;
  name: string;
  email: string;
  note: string | null;
  createdAt: number;
}

export interface PublicTournament {
  tournament: Tournament;
  owner: string;
  /** Sign-ups waiting for a spot. */
  waitlist: number;
}

export interface Person {
  id: string;
  name: string;
  email: string;
}

export interface Members {
  owner: Person;
  members: (Person & { addedAt: number })[];
  invites: { id: string; email: string; createdAt: number; expiresAt: number }[];
}

export interface InvitePreview {
  tournamentName: string;
  inviterName: string;
  email: string;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Matchcraft': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Can’t reach the server. Check your connection.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'Something went wrong.', res.status, data);
  return data as T;
}

const tid = (id: string) => `/tournaments/${encodeURIComponent(id)}`;

export const api = {
  me: () => request<{ user: User | null }>('GET', '/me'),
  signup: (name: string, email: string, password: string) =>
    request<{ user: User }>('POST', '/signup', { name, email, password }),
  login: (email: string, password: string) => request<{ user: User }>('POST', '/login', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/logout'),

  verifyEmail: (token: string) => request<{ ok: true }>('POST', '/verify', { token }),
  resendVerification: () => request<{ ok: true }>('POST', '/verify/resend'),
  forgotPassword: (email: string) => request<{ ok: true }>('POST', '/password/forgot', { email }),
  resetPassword: (token: string, password: string) =>
    request<{ user: User }>('POST', '/password/reset', { token, password }),

  list: () => request<{ tournaments: Tournament[] }>('GET', '/tournaments'),
  get: (id: string) => request<{ tournament: Tournament }>('GET', tid(id)),
  /** `baseVersion` is the server version the change was made from; omit when creating. */
  save: (t: Tournament, baseVersion?: number) =>
    request<{ tournament: Tournament }>('PUT', tid(t.id), { tournament: t, baseVersion }),
  remove: (id: string) => request<{ ok: true }>('DELETE', tid(id)),
  share: (id: string, enabled: boolean) => request<{ shareId: string | null }>('POST', `${tid(id)}/share`, { enabled }),
  publicView: (shareId: string) => request<PublicTournament>('GET', `/public/${encodeURIComponent(shareId)}`),
  register: (shareId: string, entry: { name: string; email: string; note?: string }) =>
    request<{ status: 'entered' | 'waitlist' }>('POST', `/public/${encodeURIComponent(shareId)}/register`, entry),
  registrations: (id: string) => request<{ registrations: Registration[] }>('GET', `${tid(id)}/registrations`),
  removeRegistration: (id: string, regId: string) =>
    request<{ ok: true }>('DELETE', `${tid(id)}/registrations/${encodeURIComponent(regId)}`),

  config: () => request<{ billing: BillingConfig }>('GET', '/config'),
  checkout: (kind: 'event' | 'club', tournamentId?: string) =>
    request<{ url: string }>('POST', '/billing/checkout', { kind, tournamentId }),
  billingPortal: () => request<{ url: string }>('POST', '/billing/portal'),

  members: (id: string) => request<Members>('GET', `${tid(id)}/members`),
  invite: (id: string, email: string) => request<{ invite: Members['invites'][number] }>('POST', `${tid(id)}/invites`, { email }),
  cancelInvite: (id: string, inviteId: string) => request<{ ok: true }>('DELETE', `${tid(id)}/invites/${encodeURIComponent(inviteId)}`),
  removeMember: (id: string, userId: string) => request<{ ok: true }>('DELETE', `${tid(id)}/members/${encodeURIComponent(userId)}`),
  invitePreview: (token: string) => request<InvitePreview>('GET', `/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) => request<{ tournamentId: string }>('POST', '/invites/accept', { token }),
};

/** Live-update stream URLs (Server-Sent Events). */
export const liveUrl = {
  tournament: (id: string) => `/api${tid(id)}/live`,
  shared: (shareId: string) => `/api/public/${encodeURIComponent(shareId)}/live`,
};
