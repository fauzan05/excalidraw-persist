import { useEffect, useRef, useCallback, useState } from 'react';
import { CaptureUpdateAction, reconcileElements } from '@excalidraw/excalidraw';
import type {
  BinaryFileData,
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId,
} from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { collabUrl, readEmbedUser } from '../utils/embed';
import logger from '../utils/logger';

interface UseCollabOptions {
  boardId: string;
  api: ExcalidrawImperativeAPI | null;
  applyingRemoteRef: React.MutableRefObject<boolean>;
}

interface CollabPointer {
  x: number;
  y: number;
  tool: 'pointer' | 'laser';
}

interface CollabMember {
  client_id?: string;
  username?: string;
  avatar_url?: string;
  pointer?: CollabPointer;
  button?: 'up' | 'down';
}

const COLLAB_COLORS: Array<{ background: string; stroke: string }> = [
  { background: '#ff6b6b', stroke: '#c92a2a' },
  { background: '#4dabf7', stroke: '#1864ab' },
  { background: '#69db7c', stroke: '#2b8a3e' },
  { background: '#ffd43b', stroke: '#e67700' },
  { background: '#da77f2', stroke: '#9c36b5' },
  { background: '#66d9e8', stroke: '#0b7285' },
  { background: '#ffa94d', stroke: '#d9480f' },
  { background: '#91a7ff', stroke: '#3b5bdb' },
];

const colorForId = (id: string): { background: string; stroke: string } => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return COLLAB_COLORS[hash % COLLAB_COLORS.length] ?? COLLAB_COLORS[0];
};

/** Avoid Chrome "WebSocket is closed before the connection is established" (React Strict Mode). */
const closeCollabSocket = (socket: WebSocket) => {
  socket.onerror = null;
  socket.onmessage = null;
  socket.onclose = null;
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.onopen = () => {
      socket.onopen = null;
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
    return;
  }
  socket.onopen = null;
  if (socket.readyState === WebSocket.OPEN) {
    socket.close();
  }
};

/** Excalidraw UserList filters out collaborators whose username is empty. */
const toCollaborator = (
  member: CollabMember,
  options?: { isCurrentUser?: boolean }
): { id: SocketId; value: Collaborator } | null => {
  const id = member.client_id?.trim();
  if (!id) {
    return null;
  }
  const avatarUrl = member.avatar_url?.trim();
  const httpAvatar =
    avatarUrl && (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://'))
      ? avatarUrl
      : undefined;
  const embedUser = options?.isCurrentUser ? readEmbedUser() : null;
  const stableUserId = embedUser?.userId?.trim();
  return {
    id: id as SocketId,
    value: {
      id: stableUserId || id,
      username: member.username?.trim() || 'Guest',
      pointer: member.pointer,
      button: member.button,
      color: colorForId(id),
      socketId: id as SocketId,
      ...(options?.isCurrentUser ? { isCurrentUser: true } : {}),
      ...(httpAvatar ? { avatarUrl: httpAvatar } : {}),
    },
  };
};

const selfMember = (clientId: string, extra?: CollabMember): CollabMember => {
  const embedUser = readEmbedUser();
  return {
    client_id: clientId,
    username: extra?.username?.trim() || embedUser?.username?.trim() || 'Guest',
    avatar_url: extra?.avatar_url?.trim() || embedUser?.avatarUrl,
    pointer: extra?.pointer,
    button: extra?.button,
  };
};

const seedClientId = (): string => {
  const embedUser = readEmbedUser();
  return embedUser?.userId?.trim() || 'self';
};

export const useCollab = ({ boardId, api, applyingRemoteRef }: UseCollabOptions) => {
  const socketRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const collaboratorsRef = useRef(new Map<SocketId, Collaborator>());
  const apiRef = useRef(api);
  const recoverAttemptsRef = useRef(0);
  // True from first Excalidraw paint so UserList is allowed before WS hello.
  const [isCollaborating, setIsCollaborating] = useState(true);
  apiRef.current = api;
  const apiReady = Boolean(api);

  const rememberSelf = useCallback((clientId: string, extra?: CollabMember) => {
    const mapped = toCollaborator(selfMember(clientId, extra), { isCurrentUser: true });
    if (!mapped) {
      return;
    }
    const existing = collaboratorsRef.current.get(mapped.id);
    collaboratorsRef.current.set(mapped.id, { ...existing, ...mapped.value, isCurrentUser: true });
  }, []);

  const pushCollaborators = useCallback(() => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }
    const selfId = clientIdRef.current?.trim();
    if (selfId && !collaboratorsRef.current.has(selfId as SocketId)) {
      rememberSelf(selfId);
    }
    if (collaboratorsRef.current.size === 0) {
      return;
    }
    currentApi.updateScene({
      collaborators: new Map(collaboratorsRef.current),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [rememberSelf]);

  const seedSelfFromEmbed = useCallback(() => {
    if (!clientIdRef.current) {
      clientIdRef.current = seedClientId();
    }
    rememberSelf(clientIdRef.current);
  }, [rememberSelf]);

  // Safety: API attached after a roster arrived (should not happen once WS waits for API).
  useEffect(() => {
    if (!apiReady) {
      return;
    }
    seedSelfFromEmbed();
    pushCollaborators();
  }, [apiReady, pushCollaborators, seedSelfFromEmbed]);

  const replaceCollaborators = useCallback(
    (members: CollabMember[]) => {
      const next = new Map<SocketId, Collaborator>();
      for (const member of members) {
        const mapped = toCollaborator(member);
        if (mapped) {
          next.set(mapped.id, mapped.value);
        }
      }
      const selfId = clientIdRef.current?.trim();
      if (selfId) {
        const existingSelf = collaboratorsRef.current.get(selfId as SocketId);
        const incomingSelf = next.get(selfId as SocketId);
        const seeded = toCollaborator(selfMember(selfId), { isCurrentUser: true });
        next.set(selfId as SocketId, {
          ...seeded?.value,
          ...existingSelf,
          ...incomingSelf,
          id: seeded?.value.id || selfId,
          socketId: selfId as SocketId,
          isCurrentUser: true,
          username:
            incomingSelf?.username?.trim() ||
            existingSelf?.username?.trim() ||
            seeded?.value.username ||
            'Guest',
        });
      }
      collaboratorsRef.current = next;
      pushCollaborators();
    },
    [pushCollaborators]
  );

  const upsertCollaborator = useCallback(
    (member: CollabMember) => {
      const mapped = toCollaborator(member);
      if (!mapped) {
        return;
      }
      const existing = collaboratorsRef.current.get(mapped.id);
      const isSelf = mapped.id === clientIdRef.current;
      collaboratorsRef.current.set(mapped.id, {
        ...existing,
        ...mapped.value,
        ...(isSelf ? { isCurrentUser: true } : {}),
        username: mapped.value.username?.trim() || existing?.username?.trim() || 'Guest',
        avatarUrl: mapped.value.avatarUrl || existing?.avatarUrl,
      });
      pushCollaborators();
    },
    [pushCollaborators]
  );

  /**
   * Do not open collab WS until Excalidraw's imperative API exists.
   * Hello-before-API drops updateScene; Excalidraw then applies initialData and
   * UserList stays empty until a hard refresh (cached JS attaches API first).
   * Embed `/embed/:id` and full `/board/:id` both use this hook via ExcalidrawEditor.
   */
  useEffect(() => {
    if (!boardId || !apiReady) {
      return;
    }

    setIsCollaborating(true);
    seedSelfFromEmbed();
    pushCollaborators();

    let disposed = false;
    let retry: number | undefined;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(collabUrl(boardId));
      socket = ws;
      socketRef.current = ws;
      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        setIsCollaborating(true);
        pushCollaborators();
      };
      ws.onerror = () => {
        // Strict Mode abort + proxied handshake failures are handled in onclose / remount.
        if (disposed) return;
      };
      ws.onmessage = event => {
        try {
          const payload = JSON.parse(String(event.data)) as {
            type?: string;
            client_id?: string;
            username?: string;
            avatar_url?: string;
            scene?: { elements?: ExcalidrawElement[]; files?: Record<string, BinaryFileData> };
            collaborators?: CollabMember[];
            pointer?: CollabPointer;
            button?: 'up' | 'down';
          };
          const currentApi = apiRef.current;

          if (payload.type === 'hello' && payload.client_id) {
            const previous = clientIdRef.current;
            clientIdRef.current = payload.client_id;
            if (previous && previous !== payload.client_id) {
              collaboratorsRef.current.delete(previous as SocketId);
            }
            rememberSelf(payload.client_id, {
              client_id: payload.client_id,
              username: payload.username,
              avatar_url: payload.avatar_url,
            });
            pushCollaborators();
            return;
          }

          if (payload.type === 'collaborators' && Array.isArray(payload.collaborators)) {
            replaceCollaborators(payload.collaborators);
            return;
          }

          if (payload.type === 'pointer' && payload.client_id) {
            upsertCollaborator({
              client_id: payload.client_id,
              username: payload.username,
              avatar_url: payload.avatar_url,
              pointer: payload.pointer,
              button: payload.button,
            });
            return;
          }

          if (payload.type !== 'scene' || !payload.scene || !currentApi) {
            return;
          }
          if (payload.client_id && payload.client_id === clientIdRef.current) {
            return;
          }

          const remote = (payload.scene.elements ?? []) as unknown as Parameters<
            typeof reconcileElements
          >[1];
          const local = currentApi.getSceneElementsIncludingDeleted();
          const reconciled = reconcileElements(local, remote, currentApi.getAppState());
          applyingRemoteRef.current = true;
          try {
            currentApi.updateScene({
              elements: reconciled,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
            const files = payload.scene.files;
            if (files) {
              currentApi.addFiles(Object.values(files));
            }
          } finally {
            window.setTimeout(() => {
              applyingRemoteRef.current = false;
            }, 0);
          }
        } catch (error) {
          logger.error('Failed to apply collab scene', error);
          applyingRemoteRef.current = false;
        }
      };
      ws.onclose = () => {
        if (socketRef.current === ws) {
          socketRef.current = null;
        }
        if (!disposed) {
          retry = window.setTimeout(connect, 1500);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retry) window.clearTimeout(retry);
      const current = socket;
      if (socketRef.current === current) {
        socketRef.current = null;
      }
      if (current) {
        closeCollabSocket(current);
      }
    };
  }, [
    apiReady,
    applyingRemoteRef,
    boardId,
    pushCollaborators,
    rememberSelf,
    replaceCollaborators,
    seedSelfFromEmbed,
    upsertCollaborator,
  ]);

  const publishScene = useCallback((scene: { elements: readonly ExcalidrawElement[]; files: unknown }) => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify({ type: 'scene', scene, client_id: clientIdRef.current }));
  }, []);

  const lastPointerSentRef = useRef(0);
  const publishPointer = useCallback(
    (payload: { pointer: CollabPointer; button: 'up' | 'down' }) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      const now = Date.now();
      if (payload.button === 'up' || now - lastPointerSentRef.current >= 50) {
        lastPointerSentRef.current = now;
        ws.send(JSON.stringify({ type: 'pointer', pointer: payload.pointer, button: payload.button }));
      }
    },
    []
  );

  /** Recover if Excalidraw initialData restore wiped collaborators after the first push. */
  const ensureCollaboratorsOnScene = useCallback(
    (sceneCollaborators?: Map<SocketId, Collaborator>) => {
      if (!apiRef.current || collaboratorsRef.current.size === 0) {
        return;
      }
      const selfId = clientIdRef.current;
      const sceneMap = sceneCollaborators;
      const sceneHasRoster = Boolean(
        sceneMap && sceneMap.size > 0 && (!selfId || sceneMap.has(selfId as SocketId))
      );
      if (sceneHasRoster) {
        recoverAttemptsRef.current = 0;
        return;
      }
      if (recoverAttemptsRef.current >= 8) {
        return;
      }
      recoverAttemptsRef.current += 1;
      pushCollaborators();
    },
    [pushCollaborators]
  );

  return { publishScene, publishPointer, isCollaborating, ensureCollaboratorsOnScene };
};
