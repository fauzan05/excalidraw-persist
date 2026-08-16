export interface Board {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DELETED';
  external_key?: string | null;
  resource_type?: string | null;
  created_at: number;
  updated_at: number;
}

export interface TrashBoard extends Board {
  status: 'DELETED';
}

export const isEmbedPath = (pathname: string): boolean => pathname.startsWith('/embed/');
