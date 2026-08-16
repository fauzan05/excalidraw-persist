import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { extractBearerToken, verifyHs256Jwt } from '../lib/jwt';
import { normalizeBoardId } from '../lib/boardId';

const readToken = (req: Request): string | null => {
  const headerToken = extractBearerToken(req.header('authorization'));
  if (headerToken) {
    return headerToken;
  }
  const queryToken = req.query.token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }
  return null;
};

export const requireServiceApiKey = (req: Request, res: Response, next: NextFunction) => {
  if (!env.SERVICE_API_KEY) {
    return res.status(401).json({ success: false, message: 'service_api_key_not_configured' });
  }
  const headerKey = (req.header('x-api-key') || '').trim();
  const bearer = extractBearerToken(req.header('authorization'));
  const provided = headerKey || bearer || '';
  if (!provided || provided !== env.SERVICE_API_KEY) {
    return res.status(401).json({ success: false, message: 'invalid_service_api_key' });
  }
  return next();
};

export const requireEmbedJwt = (req: Request, res: Response, next: NextFunction) => {
  if (!env.JWT_SECRET) {
    return next();
  }
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'jwt_required' });
  }
  try {
    req.embedAuth = verifyHs256Jwt(token, env.JWT_SECRET);
    return next();
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'token_expired'
        ? 'token_expired'
        : 'invalid_token';
    return res.status(401).json({ success: false, message });
  }
};

export const requireBoardJwtMatch = (req: Request, res: Response, next: NextFunction) => {
  if (!env.JWT_SECRET) {
    return next();
  }
  const paramId = normalizeBoardId(req.params.boardId || req.params.id);
  const claimId = normalizeBoardId(req.embedAuth?.board_id);
  if (!paramId || !claimId || paramId !== claimId) {
    return res.status(403).json({ success: false, message: 'board_forbidden' });
  }
  return next();
};
