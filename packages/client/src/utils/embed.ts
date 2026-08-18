const TOKEN_KEY = 'excalidraw_embed_token';

export interface EmbedUser {
  boardId: string;
  userId: string;
  username: string;
  avatarUrl?: string;
}

export const isEmbedPath = (pathname: string = window.location.pathname): boolean =>
  pathname.startsWith('/embed/');

export const readEmbedToken = (): string | null => {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('token')?.trim();
  if (fromQuery) {
    try {
      sessionStorage.setItem(TOKEN_KEY, fromQuery);
    } catch {
      // ignore sessionStorage failures in restricted iframes
    }
    return fromQuery;
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((parts[1].length + 3) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const readEmbedUser = (): EmbedUser | null => {
  const token = readEmbedToken();
  if (!token) {
    return null;
  }
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return null;
  }
  const boardId = typeof payload.board_id === 'string' ? payload.board_id.trim() : '';
  const userId = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  const username =
    (typeof payload.username === 'string' && payload.username.trim()) ||
    (typeof payload.name === 'string' && payload.name.trim()) ||
    userId;
  if (!boardId && !userId && !username) {
    return null;
  }
  const rawAvatar = typeof payload.avatar_url === 'string' ? payload.avatar_url.trim() : '';
  const avatarUrl =
    rawAvatar.startsWith('http://') || rawAvatar.startsWith('https://') ? rawAvatar : undefined;
  return { boardId, userId, username, avatarUrl };
};

export const authHeaders = (): Record<string, string> => {
  const token = readEmbedToken();
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
};

/** Same-origin `/collab` — Vite (dev) and nginx (prod) proxy the upgrade to persist API :4001. */
export const collabUrl = (boardId: string): string => {
  const token = readEmbedToken();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({ board_id: boardId });
  if (token) {
    params.set('token', token);
  }
  return `${protocol}//${window.location.host}/collab?${params.toString()}`;
};
