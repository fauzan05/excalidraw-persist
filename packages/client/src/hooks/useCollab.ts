import { useEffect, useRef, useCallback, useState } from 'react';
import { CaptureUpdateAction, reconcileElements } from '@excalidraw/excalidraw';
import type {
  BinaryFileData,
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId,
} from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { collabUrl } from '../utils/embed';
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

const toCollaborator = (member: CollabMember): { id: SocketId; value: Collaborator } | null => {
  const id = member.client_id?.trim();
  if (!id) {
    return null;
  }
  return {
    id: id as SocketId,
    value: {
      username: member.username || 'Guest',
      pointer: member.pointer,
      button: member.button,
      color: colorForId(id),
      socketId: id as SocketId,
    },
  };
};

export const useCollab = ({ boardId, api, applyingRemoteRef }: UseCollabOptions) => {
  const socketRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const collaboratorsRef = useRef(new Map<SocketId, Collaborator>());
  const apiRef = useRef(api);
  const [isCollaborating, setIsCollaborating] = useState(false);
  apiRef.current = api;

  const pushCollaborators = useCallback(() => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }
    currentApi.updateScene({
      collaborators: new Map(collaboratorsRef.current),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, []);

  const replaceCollaborators = useCallback(
    (members: CollabMember[]) => {
      const next = new Map<SocketId, Collaborator>();
      for (const member of members) {
        const mapped = toCollaborator(member);
        if (mapped) {
          next.set(mapped.id, mapped.value);
        }
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
      collaboratorsRef.current.set(mapped.id, { ...existing, ...mapped.value });
      pushCollaborators();
    },
    [pushCollaborators]
  );

  useEffect(() => {
    if (!boardId) {
      return;
    }

    let closed = false;
    let retry: number | undefined;
    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(collabUrl(boardId));
      socketRef.current = ws;
      ws.onopen = () => {
        if (!closed) {
          setIsCollaborating(true);
        }
      };
      ws.onmessage = event => {
        try {
          const payload = JSON.parse(String(event.data)) as {
            type?: string;
            client_id?: string;
            username?: string;
            scene?: { elements?: ExcalidrawElement[]; files?: Record<string, BinaryFileData> };
            collaborators?: CollabMember[];
            pointer?: CollabPointer;
            button?: 'up' | 'down';
          };
          const currentApi = apiRef.current;

          if (payload.type === 'hello' && payload.client_id) {
            clientIdRef.current = payload.client_id;
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
        setIsCollaborating(false);
        if (!closed) {
          retry = window.setTimeout(connect, 1500);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      setIsCollaborating(false);
      if (retry) window.clearTimeout(retry);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [api, applyingRemoteRef, boardId, replaceCollaborators, upsertCollaborator]);

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

  return { publishScene, publishPointer, isCollaborating };
};
