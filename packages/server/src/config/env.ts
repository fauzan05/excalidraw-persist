import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '4000', 10),
  DB_PATH: process.env.DB_PATH || path.join(process.cwd(), 'data', 'excalidraw.db'),
  JWT_SECRET: (process.env.JWT_SECRET || process.env.EMBED_JWT_SECRET || '').trim(),
  SERVICE_API_KEY: (process.env.SERVICE_API_KEY || '').trim(),
};
