const API_BASE = '/api';

export interface SessionUser {
  uid: string;
  email: string;
  name: string | null;
  phone?: string | null;
  role: string;
  orgId: string;
}

/**
 * Resolves the current backend session from the httpOnly cookie.
 * Returns null when there is no active session.
 */
export async function getSession(): Promise<SessionUser | null> {
  try {
    const res = await fetch(`${API_BASE}/auth/session`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.success && json.data ? (json.data as SessionUser) : null;
  } catch {
    return null;
  }
}

/**
 * Exchanges a Firebase ID token for a persistent backend session cookie.
 */
export async function createSession(idToken: string): Promise<SessionUser> {
  const res = await fetch(`${API_BASE}/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ idToken }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const error = new Error(
      json.error || 'Falha ao autenticar. Verifique se o e-mail é corporativo.'
    );
    (error as Error & { code?: string }).code = json.code;
    throw error;
  }

  return json.data as SessionUser;
}

/**
 * Clears the backend session cookie.
 */
export async function logoutSession(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Best effort: the cookie is httpOnly, so a network failure just means the
    // session may still be valid until it expires.
  }
}
