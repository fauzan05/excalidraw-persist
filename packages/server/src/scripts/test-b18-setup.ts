import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'excalidraw-b18-'));

process.env.JWT_SECRET = 'test-jwt-secret-min-32-characters!!';
process.env.SERVICE_API_KEY = 'test-service-api-key';
process.env.DB_PATH = path.join(tmpDir, 'test.sqlite');
process.env.NODE_ENV = 'test';
