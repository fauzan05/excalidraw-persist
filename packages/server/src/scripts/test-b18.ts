import './test-b18-setup';
import assert from 'assert';
import http from 'http';
import { AddressInfo } from 'net';
import { createApp } from '../app';
import { attachCollab } from '../lib/collab';
import { openDatabase, initializeDatabase, closeDatabase } from '../lib/database';
import { signHs256Jwt, verifyHs256Jwt } from '../lib/jwt';

const JWT_SECRET = process.env.JWT_SECRET as string;
const SERVICE_KEY = process.env.SERVICE_API_KEY as string;

const mint = (
  boardId: string,
  expOffsetSeconds = 3600,
  extra?: { sub?: string; username?: string }
) => {
  const now = Math.floor(Date.now() / 1000);
  return signHs256Jwt(
    {
      board_id: boardId,
      resource_type: 'document',
      iat: now,
      exp: now + expOffsetSeconds,
      ...(extra?.sub ? { sub: extra.sub } : {}),
      ...(extra?.username ? { username: extra.username } : {}),
    },
    JWT_SECRET
  );
};

const decodeUnmaskedTextFrames = (buf: Buffer): string[] => {
  const frames: string[] = [];
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const opcode = (buf[offset] ?? 0) & 0x0f;
    let payloadLen = (buf[offset + 1] ?? 0) & 0x7f;
    offset += 2;
    if (payloadLen === 126) {
      if (offset + 2 > buf.length) break;
      payloadLen = buf.readUInt16BE(offset);
      offset += 2;
    }
    if (offset + payloadLen > buf.length) break;
    if (opcode === 0x1) {
      frames.push(buf.subarray(offset, offset + payloadLen).toString('utf8'));
    }
    offset += payloadLen;
  }
  return frames;
};

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

const run = async () => {
  await openDatabase();
  await initializeDatabase();

  const app = createApp();
  const server = http.createServer(app);
  attachCollab(server);

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200, 'health should be 200');

    const missingJwt = await fetch(`${base}/api/boards`);
    assert.equal(missingJwt.status, 401, 'REST without JWT should be 401');
    const missingBody = await json(missingJwt);
    assert.equal(missingBody.message, 'jwt_required');

    const invalidJwt = await fetch(`${base}/api/boards`, {
      headers: { Authorization: 'Bearer not-a-jwt' },
    });
    assert.equal(invalidJwt.status, 401, 'invalid JWT should be 401');

    const expired = mint('00000000-0000-4000-8000-000000000001', -10);
    const expiredRes = await fetch(`${base}/api/boards`, {
      headers: { Authorization: `Bearer ${expired}` },
    });
    assert.equal(expiredRes.status, 401, 'expired JWT should be 401');

    const noKey = await fetch(`${base}/api/service/boards/ensure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ external_key: 'document:11111111-1111-4111-8111-111111111111' }),
    });
    assert.equal(noKey.status, 401, 'EnsureBoard without service key should be 401');

    const ensureBody = {
      external_key: 'document:22222222-2222-4222-8222-222222222222',
      name: 'Whiteboard',
      resource_type: 'document',
    };
    const ensureHeaders = {
      'Content-Type': 'application/json',
      'X-API-Key': SERVICE_KEY,
    };
    const first = await fetch(`${base}/api/service/boards/ensure`, {
      method: 'POST',
      headers: ensureHeaders,
      body: JSON.stringify(ensureBody),
    });
    assert.ok(
      first.status === 200 || first.status === 201,
      `first EnsureBoard status ${first.status}`
    );
    const firstJson = (await first.json()) as { data: { id: string; created: boolean } };
    assert.ok(firstJson.data?.id, 'EnsureBoard should return id');
    const boardId = firstJson.data.id;

    const second = await fetch(`${base}/api/service/boards/ensure`, {
      method: 'POST',
      headers: ensureHeaders,
      body: JSON.stringify(ensureBody),
    });
    assert.equal(second.status, 200, 'second EnsureBoard should be 200');
    const secondJson = (await second.json()) as { data: { id: string; created: boolean } };
    assert.equal(secondJson.data.id, boardId, 'EnsureBoard must be idempotent by external_key');
    assert.equal(secondJson.data.created, false);

    const token = mint(boardId);
    const list = await fetch(`${base}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(list.status, 200);
    const listJson = (await list.json()) as { data: Array<{ id: string }> };
    assert.equal(listJson.data.length, 1, 'embed JWT must not see the global board list');
    assert.equal(listJson.data[0]?.id, boardId);

    const createDenied = await fetch(`${base}/api/boards`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(
      createDenied.status,
      403,
      'anonymous/embed create must be disabled when JWT is on'
    );

    const scene = await fetch(`${base}/api/boards/${boardId}/elements`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(scene.status, 200, 'JWT can read own scene');

    const otherToken = mint('33333333-3333-4333-8333-333333333333');
    const forbidden = await fetch(`${base}/api/boards/${boardId}/elements`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    assert.equal(forbidden.status, 403, 'JWT for another board cannot read this scene');

    const put = await fetch(`${base}/api/service/boards/${boardId}/scene`, {
      method: 'PUT',
      headers: ensureHeaders,
      body: JSON.stringify({ elements: [], files: {} }),
    });
    assert.equal(put.status, 200, 'service PutScene should succeed');

    const get = await fetch(`${base}/api/service/boards/${boardId}/scene`, {
      headers: { 'X-API-Key': SERVICE_KEY },
    });
    assert.equal(get.status, 200, 'service GetScene should succeed');

    const wsRejected = await new Promise<number>(resolve => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: `/collab?board_id=${boardId}`,
        method: 'GET',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        },
      });
      req.on('response', res => resolve(res.statusCode || 0));
      req.on('upgrade', () => resolve(101));
      req.on('error', () => resolve(0));
      req.end();
    });
    assert.notEqual(wsRejected, 101, 'WS without JWT must not upgrade');
    assert.ok(wsRejected === 401 || wsRejected === 0, `WS without JWT status ${wsRejected}`);

    const namedToken = mint(boardId, 3600, { sub: 'user-1', username: 'Ada Lovelace' });
    const namedClaims = verifyHs256Jwt(namedToken, JWT_SECRET);
    assert.equal(namedClaims.sub, 'user-1');
    assert.equal(namedClaims.username, 'Ada Lovelace');

    const putJwt = await fetch(`${base}/api/boards/${boardId}/elements`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        elements: [
          { id: 'e1', type: 'rectangle', index: '' },
          { id: 'e2', type: 'ellipse', index: '' },
        ],
        files: {},
      }),
    });
    const putJwtBody = await json(putJwt);
    assert.equal(
      putJwt.status,
      200,
      `JWT PUT scene should succeed (${putJwt.status}) ${JSON.stringify(putJwtBody)}`
    );

    const gotScene = await fetch(`${base}/api/boards/${boardId}/elements`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(gotScene.status, 200, 'GET scene after PUT should succeed');
    const gotSceneJson = (await gotScene.json()) as {
      data: { elements: Array<{ id: string }> };
    };
    const savedIds = new Set((gotSceneJson.data?.elements ?? []).map(element => element.id));
    assert.ok(savedIds.has('e1') && savedIds.has('e2'), 'PUT elements should round-trip on GET');

    const concurrentPuts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        fetch(`${base}/api/boards/${boardId}/elements`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            elements: [
              { id: 'e1', type: 'rectangle', index: 'a0' },
              { id: `stroke-${i}`, type: 'freedraw', index: `a${i + 1}` },
            ],
            files: {},
          }),
        })
      )
    );
    for (const res of concurrentPuts) {
      const body = await json(res);
      assert.equal(
        res.status,
        200,
        `concurrent PUT should succeed (${res.status}) ${JSON.stringify(body)}`
      );
    }

    const afterConcurrent = await fetch(`${base}/api/boards/${boardId}/elements`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(afterConcurrent.status, 200, 'GET after concurrent PUTs should succeed');
    const afterConcurrentJson = (await afterConcurrent.json()) as {
      data: { elements: Array<{ id: string }> };
    };
    assert.ok(
      (afterConcurrentJson.data?.elements ?? []).length >= 1,
      'scene should keep replaced elements after concurrent PUTs'
    );

    const helloPayload = await new Promise<string>(resolve => {
      const timer = setTimeout(() => resolve(''), 3000);
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: `/collab?board_id=${boardId}&token=${encodeURIComponent(namedToken)}`,
        method: 'GET',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        },
      });
      const finish = (text: string) => {
        clearTimeout(timer);
        resolve(text);
      };
      req.on('upgrade', (_res, socket, head) => {
        const collected: Buffer[] = [Buffer.from(head || [])];
        const tryDecode = () => {
          const frames = decodeUnmaskedTextFrames(Buffer.concat(collected));
          if (frames.some(frame => frame.includes('Ada Lovelace'))) {
            finish(frames.join('\n'));
            socket.destroy();
            return true;
          }
          return false;
        };
        if (tryDecode()) {
          return;
        }
        socket.on('data', chunk => {
          collected.push(chunk as Buffer);
          tryDecode();
        });
      });
      req.on('error', () => finish(''));
      req.end();
    });
    assert.ok(
      helloPayload.includes('Ada Lovelace'),
      `collab hello should include username: ${helloPayload}`
    );

    console.log('B18 persist tests passed');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(err => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
      server.closeAllConnections();
    });
    await closeDatabase();
  }
};

run().catch(error => {
  console.error(error);
  process.exit(1);
});
