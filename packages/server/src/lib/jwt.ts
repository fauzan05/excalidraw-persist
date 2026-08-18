import crypto from 'crypto';

export type ResourceType = 'meeting' | 'document';

export interface EmbedClaims {
  board_id: string;
  resource_type: ResourceType;
  exp: number;
  iat?: number;
  sub?: string;
  username?: string;
  avatar_url?: string;
}

const base64UrlEncode = (input: Buffer | string): string => {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

const base64UrlDecode = (input: string): Buffer => {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  return Buffer.from(padded, 'base64');
};

const timingSafeEqual = (a: string, b: string): boolean => {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
};

export const signHs256Jwt = (payload: EmbedClaims, secret: string): string => {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest();
  return `${data}.${base64UrlEncode(sig)}`;
};

export const verifyHs256Jwt = (token: string, secret: string): EmbedClaims => {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('invalid_token');
  }

  const data = `${parts[0]}.${parts[1]}`;
  const expected = base64UrlEncode(crypto.createHmac('sha256', secret).update(data).digest());
  if (!timingSafeEqual(expected, parts[2])) {
    throw new Error('invalid_token');
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('invalid_token');
  }

  const boardId = typeof payload.board_id === 'string' ? payload.board_id.trim() : '';
  const resourceType = payload.resource_type;
  const exp = typeof payload.exp === 'number' ? payload.exp : Number(payload.exp);
  if (
    !boardId ||
    (resourceType !== 'meeting' && resourceType !== 'document') ||
    !Number.isFinite(exp)
  ) {
    throw new Error('invalid_token');
  }
  if (exp * 1000 <= Date.now()) {
    throw new Error('token_expired');
  }

  const claims: EmbedClaims = {
    board_id: boardId,
    resource_type: resourceType,
    exp,
  };
  if (typeof payload.iat === 'number') {
    claims.iat = payload.iat;
  }
  if (typeof payload.sub === 'string' && payload.sub.trim()) {
    claims.sub = payload.sub.trim();
  }
  const username =
    (typeof payload.username === 'string' && payload.username.trim()) ||
    (typeof payload.name === 'string' && payload.name.trim()) ||
    '';
  if (username) {
    claims.username = username;
  }
  const avatarUrl = typeof payload.avatar_url === 'string' ? payload.avatar_url.trim() : '';
  if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
    claims.avatar_url = avatarUrl;
  }
  return claims;
};

export const extractBearerToken = (header: string | undefined): string | null => {
  if (!header) {
    return null;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};
