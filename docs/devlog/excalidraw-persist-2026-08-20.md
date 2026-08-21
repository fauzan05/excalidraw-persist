Dev Log - 2026-08-20

🎯 Goals
- Restore local persist after E2E knock-down (login 502 was a separate Nuxt/IPv6 issue)

✅ Completed
- [22:45] Persist was **not** a Portainer/compose stack on this machine (no project in `docker compose ls`, no containers, no volumes, no `cosl-excalidraw-persist` image). It had been host Node: ts-node `:4001` (hung, health timeout) + Vite `:4002`. Killed those processes and restarted: API `http://127.0.0.1:4001/api/health` **200**, SPA `:4002` **200**, existing `packages/server/data/excalidraw.db` kept. `docker compose -p excalidraw-persist up -d --build` failed: pnpm 11 lockfile overrides, then sqlite3 native build `ENOTFOUND github.com`. Pinned Dockerfile corepack to pnpm 10.29.3 for a later retry. Did not compose down other stacks. No commit.
- [23:45] Proved from **inside** `cosl-backend-dev` (not host loopback): `curl http://host.docker.internal:4001/api/health` **200 in 12ms**; authenticated `GET /api/service/boards/{id}/scene` **200 in 7ms**; missing board **404 in 6ms** (not a hang). Host bind was already **`0.0.0.0:4001`** (PID ts-node since 22:42, log `Server is running on http://0.0.0.0:4001`); SPA remains `127.0.0.1:4002`. Did **not** restart persist (not hung; no sqlite deadlock in logs; existing `excalidraw.db` kept). Same-second Go `context deadline exceeded` on many `/scene` URLs is the 4-minute worker ctx expiring after **Seaweed S3 `:8333` hangs** (container and host both 5s timeout, 0 bytes) — persist never saw those GETs. Documented `HOST=0.0.0.0` in `.env.example` + README. No Portainer/compose down. No commit.

🔨 In Progress

🐛 Issues & Solutions
- Portainer “missing Excalidraw”: compose project was never present today; whiteboard used host persist. Docker image cannot build while GitHub is unreachable for sqlite3 prebuilds.
- [23:45] Go `Get host.docker.internal:4001/.../scene: context deadline exceeded` while persist answers in milliseconds: not loopback bind (already `0.0.0.0`). Worker lists all 33 `.excalidraw` documents, GetScene then PutObject to Seaweed; S3 `:8333` hangs, job ctx expires, remaining GetScene fail immediately with persist URLs in the error. MCP `excalidraw` health hits `/` (404) even when `/api/health` is 200.

📝 Notes
- COSL Go `excalidraw.api_url` for Docker backend is `http://host.docker.internal:4001`; browser SPA is `http://127.0.0.1:4002`.
