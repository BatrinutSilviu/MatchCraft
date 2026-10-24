import type { Tournament } from './types';

export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
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
  publicView: (shareId: string) =>
    request<{ tournament: Tournament; owner: string }>('GET', `/public/${encodeURIComponent(shareId)}`),

  members: (id: string) => request<Members>('GET', `${tid(id)}/members`),
  invite: (id: string, email: string) => request<{ invite: Members['invites'][number] }>('POST', `${tid(id)}/invites`, { email }),
  cancelInvite: (id: string, inviteId: string) => request<{ ok: true }>('DELETE', `${tid(id)}/invites/${encodeURIComponent(inviteId)}`),
  removeMember: (id: string, userId: string) => request<{ ok: true }>('DELETE', `${tid(id)}/members/${encodeURIComponent(userId)}`),
  invitePreview: (token: string) => request<InvitePreview>('GET', `/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) => request<{ tournamentId: string }>('POST', '/invites/accept', { token }),
};
