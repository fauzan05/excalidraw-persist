const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isBoardUUID = (id: string | undefined | null): id is string => {
  return typeof id === 'string' && UUID_RE.test(id.trim());
};

export const normalizeBoardId = (id: string | undefined | null): string | null => {
  if (!isBoardUUID(id)) {
    return null;
  }
  return id.trim().toLowerCase();
};
