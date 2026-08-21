Dev Log - 2026-08-21

🎯 Goals
- Dockerize persist on cosl-network (replace host ts-node/Vite)
- E2E B18/B18b green against nginx SPA + API :4001/:4002

✅ Completed
- [08:26] Started Dockerize Excalidraw persist plan: bookworm Dockerfile, compose cosl-network + healthcheck
- [08:32] Docker image `cosl-excalidraw-persist:local` built (bookworm, vite prod client); container healthy on :4001/:4002 + cosl-network
- [08:34] Go config.json excalidraw.api_url=http://excalidraw:4000, public_url=http://localhost:4002; backend restarted
- [08:40] E2E B18/B18b gate: 23 Playwright specs passed (persist health, meetings whiteboard API/UI/durable, documents create/UI/durable). No commit.

🔨 In Progress

🐛 Issues & Solutions
- Alpine sqlite3 build failed (GitHub ENOTFOUND) → switched Dockerfile to node:22-bookworm-slim
- Client `tsc && vite build` failed on fork TS errors → Docker uses `vite build` only for client bundle
- shareController.ts implicit any fixed for server tsc build

📝 Notes
- Host ts-node on :4001 replaced by Docker; ports owned by wslrelay/com.docker.backend
