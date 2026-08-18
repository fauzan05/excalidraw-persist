import crypto from 'crypto';
import http from 'http';
import { Socket } from 'net';
import { env } from '../config/env';
import { verifyHs256Jwt } from './jwt';
import { normalizeBoardId } from './boardId';
import logger from '../utils/logger';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

interface CollabPointer {
  x: number;
  y: number;
  tool: 'pointer' | 'laser';
}

interface CollabClient {
  socket: Socket;
  boardId: string;
  buffer: Buffer;
  clientId: string;
  username: string;
  avatarUrl?: string;
  pointer?: CollabPointer;
  button?: 'up' | 'down';
}

interface IncomingCollabMessage {
  type?: string;
  scene?: unknown;
  pointer?: CollabPointer;
  button?: 'up' | 'down';
}

const rooms = new Map<string, Set<CollabClient>>();

const acceptKey = (key: string): string =>
  crypto
    .createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');

const encodeText = (data: string): Buffer => {
  const payload = Buffer.from(data, 'utf8');
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
};

const decodeFrames = (client: CollabClient): string[] => {
  const messages: string[] = [];
  let buf = client.buffer;
  while (buf.length >= 2) {
    const first = buf[0];
    const second = buf[1];
    if (first === undefined || second === undefined) {
      break;
    }
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLen = second & 0x7f;
    let offset = 2;
    if (payloadLen === 126) {
      if (buf.length < 4) break;
      payloadLen = buf.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (buf.length < 10) break;
      payloadLen = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length < offset + maskLen + payloadLen) break;
    const mask = masked ? buf.subarray(offset, offset + 4) : null;
    offset += maskLen;
    const payload = Buffer.from(buf.subarray(offset, offset + payloadLen));
    if (mask) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
      }
    }
    buf = buf.subarray(offset + payloadLen);
    if (opcode === 0x8) {
      client.socket.end();
      break;
    }
    if (opcode === 0x1) {
      messages.push(payload.toString('utf8'));
    }
  }
  client.buffer = buf;
  return messages;
};

const addToRoom = (client: CollabClient) => {
  let room = rooms.get(client.boardId);
  if (!room) {
    room = new Set();
    rooms.set(client.boardId, room);
  }
  room.add(client);
};

const removeFromRoom = (client: CollabClient) => {
  const room = rooms.get(client.boardId);
  if (!room) return;
  room.delete(client);
  if (room.size === 0) {
    rooms.delete(client.boardId);
  }
};

const send = (client: CollabClient, payload: unknown) => {
  if (client.socket.destroyed) return;
  try {
    client.socket.write(encodeText(JSON.stringify(payload)));
  } catch (error) {
    logger.warn('collab send failed', error);
  }
};

export const broadcastScene = (boardId: string, scene: unknown, except: CollabClient | null) => {
  const room = rooms.get(boardId);
  if (!room) return;
  const clientId = except?.clientId;
  for (const client of room) {
    if (except && client === except) continue;
    send(client, { type: 'scene', board_id: boardId, scene, client_id: clientId ?? null });
  }
};

const collaboratorPayload = (client: CollabClient) => ({
  client_id: client.clientId,
  username: client.username,
  ...(client.avatarUrl ? { avatar_url: client.avatarUrl } : {}),
  pointer: client.pointer,
  button: client.button,
});

const roomRoster = (room: Set<CollabClient>) =>
  [...room].map(member => collaboratorPayload(member));

const broadcastPresence = (boardId: string, except: CollabClient | null) => {
  const room = rooms.get(boardId);
  if (!room) return;
  for (const client of room) {
    if (except && client === except) continue;
    send(client, { type: 'collaborators', board_id: boardId, collaborators: roomRoster(room) });
  }
};

const reject = (socket: Socket, status: number, message: string) => {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
};

const parseUpgradeRequest = (raw: string) => {
  const [requestLine, ...headerLines] = raw.split('\r\n');
  const parts = requestLine?.split(' ') ?? [];
  const pathAndQuery = parts[1] || '';
  const url = new URL(pathAndQuery, 'http://localhost');
  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
  }
  return { pathname: url.pathname, searchParams: url.searchParams, headers };
};

export const attachCollab = (server: http.Server) => {
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', 'http://localhost');
    if (url.pathname !== '/collab' && url.pathname !== '/collab/') {
      reject(socket as Socket, 404, 'Not Found');
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      reject(socket as Socket, 400, 'Bad Request');
      return;
    }

    const token =
      url.searchParams.get('token') ||
      (typeof req.headers.authorization === 'string'
        ? req.headers.authorization.replace(/^Bearer\s+/i, '').trim()
        : '');
    const boardId = normalizeBoardId(url.searchParams.get('board_id'));
    if (!boardId) {
      reject(socket as Socket, 400, 'Bad Request');
      return;
    }

    let username = 'Guest';
    let avatarUrl: string | undefined;
    if (env.JWT_SECRET) {
      if (!token) {
        reject(socket as Socket, 401, 'Unauthorized');
        return;
      }
      try {
        const claims = verifyHs256Jwt(token, env.JWT_SECRET);
        if (normalizeBoardId(claims.board_id) !== boardId) {
          reject(socket as Socket, 403, 'Forbidden');
          return;
        }
        username = claims.username || claims.sub || 'Guest';
        if (claims.avatar_url) {
          avatarUrl = claims.avatar_url;
        }
      } catch {
        reject(socket as Socket, 401, 'Unauthorized');
        return;
      }
    }

    const accept = acceptKey(key);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        '\r\n'
    );

    const client: CollabClient = {
      socket: socket as Socket,
      boardId,
      buffer: Buffer.from(head || []),
      clientId: crypto.randomBytes(8).toString('hex'),
      username,
      avatarUrl,
    };
    addToRoom(client);
    send(client, {
      type: 'hello',
      board_id: boardId,
      client_id: client.clientId,
      username: client.username,
      ...(client.avatarUrl ? { avatar_url: client.avatarUrl } : {}),
    });
    const room = rooms.get(boardId);
    send(client, {
      type: 'collaborators',
      board_id: boardId,
      collaborators: room ? roomRoster(room) : [collaboratorPayload(client)],
    });
    broadcastPresence(boardId, client);

    socket.on('data', (chunk: Buffer) => {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      const messages = decodeFrames(client);
      for (const rawMessage of messages) {
        try {
          const parsed = JSON.parse(rawMessage) as IncomingCollabMessage;
          if (parsed.type === 'scene' && parsed.scene) {
            broadcastScene(boardId, parsed.scene, client);
          }
          if (parsed.type === 'pointer' && parsed.pointer) {
            client.pointer = parsed.pointer;
            client.button = parsed.button === 'down' ? 'down' : 'up';
            const roomNow = rooms.get(boardId);
            if (!roomNow) continue;
            const payload = {
              type: 'pointer',
              board_id: boardId,
              ...collaboratorPayload(client),
            };
            for (const member of roomNow) {
              if (member === client) continue;
              send(member, payload);
            }
          }
        } catch {
          // ignore malformed collab frames
        }
      }
    });

    let left = false;
    const onLeave = () => {
      if (left) return;
      left = true;
      removeFromRoom(client);
      broadcastPresence(boardId, null);
    };
    socket.on('close', onLeave);
    socket.on('error', onLeave);
    socket.on('end', onLeave);
  });
};

export const parseCollabPathForTests = parseUpgradeRequest;
