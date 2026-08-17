Dev Log - 2026-08-17

🎯 Goals
- Fix meeting whiteboard toast `Error saving scene data: Failed to replace elements`.

✅ Completed
- [21:20] Toast maps persist client `logger.error('Error saving scene data:', error)` to the PUT 500 body `Failed to replace elements` from `elementController.replaceAll`. Live API log: `SQLITE_ERROR: cannot start a transaction within a transaction` on `PUT /api/boards/59afee2a-…/elements`. Cause: one SQLite connection + overlapping `BEGIN` from concurrent replace-all (stroke onChange + collab). Not UNIQUE(element_index), JWT, or missing applyDelta.
- [21:20] Serialized writes with `withTransaction` / `runExclusive`, WAL + busy_timeout, dedupe element ids on replace-all, share applyDelta now uses loadScene/saveScene (upsertMany/deleteMany were missing). Client coalesces in-flight PUT; collab keeps `applyingRemoteRef` until the next macrotask.
- [21:20] `pnpm test` in persist server (temp SQLite, does not touch host :4001): PUT then GET round-trip + 8 concurrent PUTs all 200.
- [21:22] Restarted host persist on :4001 with nodemon (`pnpm run dev`, transpile-only). Same board `59afee2a-…` that was 500 now PUTs 200 (no nested-transaction errors). Vite SPA on :4002 left running.

🔨 In Progress

🐛 Issues & Solutions
- [21:20] Nested SQLite transactions on the shared connection. Solution: exclusive write queue around BEGIN IMMEDIATE.

📝 Notes
- MCP `excalidraw` health hits `http://127.0.0.1:4001/` (404) even when `/api/health` is 200.
- Host persist on :4001 must be restarted to pick up the server fix (ts-node was not watching). Vite :4002 HMR covers the client coalescing.
- No commit.
