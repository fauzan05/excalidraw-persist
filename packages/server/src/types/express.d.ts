import type { EmbedClaims } from '../lib/jwt';

declare global {
  namespace Express {
    interface Request {
      embedAuth?: EmbedClaims;
    }
  }
}

export {};
