Dev Log - 2026-08-18

🎯 Goals
- Pass COSL profile photos into Excalidraw collaborator avatars via embed JWT
- Keep embed compile working (ArchivePopup, not TrashPopup)

✅ Completed
- [11:40] Collaborator avatars are 1:1 circles: persist client CSS on `.Avatar` / `.Avatar-img` (embed + board) forces equal size, `border-radius: 50%`, `overflow: hidden`, and `object-fit: cover` so landscape profile photos no longer render as ellipses. Excalidraw 0.18 Avatar-img had width/height 100% without object-fit.
- [10:40] Embed JWT now carries optional `avatar_url` (absolute http(s) only). Collab WS hello/presence include it; client maps `Collaborator.avatarUrl` and keeps the local user in the collaborator map.
- [10:39] Re-ran `packages/server` `pnpm test` (test-b18) — passed, including JWT `avatar_url` and collab hello. Header still uses ArchivePopup (not TrashPopup).
- [13:40] COSL documents whiteboard nested iframe: Vite `/` and `/embed/:id` returned 404 unless `Accept: text/html` (Playwright health GET failed). API `localhost:4001` hung (listen on `::`, IPv6 timeout) while `127.0.0.1:4001` was slow/spinning. Vite now injects HTML Accept for `/` and `/embed/`, sets `frame-ancestors` for `localhost:3000` / `127.0.0.1:3000`. API listens on `0.0.0.0` (HOST). Restarted :4001 + :4002.
- [14:29] Collab WS `ws://127.0.0.1:4002/collab` closed-before-open was React Strict Mode (`useCollab` cleanup while CONNECTING), not a missing proxy. Vite already proxied `/collab` to API `:4001` (HTTP GET Express 404; upgrade without JWT → 401). `useCollab` no longer `close()` during CONNECTING; remount reconnects. Vite `preview.proxy` matches `server.proxy`. nginx `/collab` already upgrades to the API (no iframe HTML there).
- [14:44] Collaborator map now sets both `id` and `socketId` to the collab `client_id` (skip empty ids). React “unique key” at `ScrollableList` / `FixedSideContainer` / `LayerUI` is still **upstream** `@excalidraw/excalidraw` 0.18.0 `UserList`: overflow menu passes `[unkeyed hint div, mapped avatars]` into `ScrollableList`. Persist has no unkeyed list of our own. Did not patch node_modules.
- [15:16] UserList avatars gone on docs whiteboard (Library still visible; sometimes only `+1`). Two bugs: (1) collab hello landed while Excalidraw Loader was up so `updateScene({ collaborators })` was dropped — flush when the API attaches; keep self in the map with username. (2) Excalidraw 0.18 `maxAvatars = floor(wrapperWidth/38)` then `slice(0, maxAvatars-1)` — a squeezed docs iframe showed overflow-only. CSS: `.UserList__wrapper` `min-width: 8rem`; circle-crop scoped to `.UserList .Avatar` (no `min-width: 0` on img). Collab WS roster now includes self. Did not commit.
- [15:40] Flush-on-API-attach was not enough (docs still empty; meetings needed hard refresh). Root cause: `useCollab` opened `/collab` as soon as `boardId` existed (during Loader). Hello ran before `excalidrawAPI`; `updateScene` was dropped; Excalidraw `initialData` then won. Hard refresh looked fine because cached JS attached the API first. Invert: wait until `apiReady`, seed self from JWT (UserList size ≥ 1), `isCollaborating` true from first editor paint, then open WS / hello / `updateScene`. Keep flush-on-attach + `onChange` recover as safety. CSS: override Excalidraw `.UserList__wrapper { width: 100% }` to `width: auto; min-width: 8rem` (100% of a shrink-to-fit parent is 0 → `maxAvatars=1` → `slice(0,0)`). Import Excalidraw `index.css` before app CSS. Embed `/embed/:id` already uses `ExcalidrawEditor` → `useCollab` (document JWT too). Did not commit.

🔨 In Progress

🐛 Issues & Solutions
- [11:40] Small collaborator photo in the UserList (top-right of the whiteboard) was a wide oval: landscape COSL profile images kept their intrinsic ratio inside Excalidraw's flex `.Avatar`. Override in `ExcalidrawEditor.scss`.
- [14:29] Chrome “WebSocket is closed before the connection is established” at `useCollab.ts` cleanup: React Strict Mode double-invokes the effect and `close()` during CONNECTING. Handshake to persist `/collab` on :4001 via Vite :4002 proxy was already succeeding (401 without JWT).
- [14:44] Excalidraw 0.18 `UserList` overflow `ScrollableList` children array starts with a hint `div` that has no React `key` (node_modules). COSL collab already keyed the Map by unique `client_id`; we now also set `Collaborator.id`.
- [15:16] Docs UserList showed `+1` left of Library with zero `.Avatar`: wrapper `clientWidth` < 76px so `maxAvatars` was 1 and `slice(0, 0)` hid avatars. Meetings iframe was wider so self avatar still showed. Fixed with `min-width: 8rem` plus collaborator flush after API attach.
- [15:40] First-load UserList still empty after flush-on-attach: WS hello raced the Loader/API. Docs nested iframe (Nuxt → BFF HTML → persist `/embed`) made the race + `width: 100%` collapse worse (zero avatars). Meetings one-level iframe often recovered on hard refresh. Connect WS only after the Excalidraw API exists; seed self; override wrapper `width: auto`.

📝 Notes
- Persist iframe cannot fetch cookie-auth COSL `/profile-picture/file`. Avatars must be HMAC tokenized URLs on localhost:3000 `/profile-picture/embed`.
