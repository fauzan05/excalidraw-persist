import crypto from 'crypto';
import { getDb } from '../lib/database';
import { Board, BoardStatus, EnsureBoardInput, UpdateBoardInput } from '../types';

export class BoardModel {
  public static async create(name?: string): Promise<Board> {
    const db = await getDb();
    const id = crypto.randomUUID();
    const result = await db.get<Board>(
      "INSERT INTO boards (id, name) VALUES (?, COALESCE(?, strftime('%Y-%m-%d %H:%M:%S','now'))) RETURNING *",
      [id, name ?? null]
    );

    if (!result) {
      throw new Error('Failed to create board');
    }

    return result;
  }

  public static async ensureByExternalKey(
    input: EnsureBoardInput
  ): Promise<{ board: Board; created: boolean }> {
    const externalKey = input.external_key.trim();
    if (!externalKey) {
      throw new Error('external_key is required');
    }

    const existing = await this.findByExternalKey(externalKey);
    if (existing) {
      if (input.name && input.name.trim() && input.name.trim() !== existing.name) {
        const updated = await this.update(existing.id, { name: input.name.trim() });
        return { board: updated ?? existing, created: false };
      }
      return { board: existing, created: false };
    }

    const db = await getDb();
    const id = crypto.randomUUID();
    const name = input.name?.trim() || externalKey;
    const resourceType = input.resource_type ?? null;

    try {
      const created = await db.get<Board>(
        `INSERT INTO boards (id, name, external_key, resource_type)
         VALUES (?, ?, ?, ?)
         RETURNING *`,
        [id, name, externalKey, resourceType]
      );
      if (!created) {
        throw new Error('Failed to create board');
      }
      return { board: created, created: true };
    } catch (error) {
      const raced = await this.findByExternalKey(externalKey);
      if (raced) {
        return { board: raced, created: false };
      }
      throw error;
    }
  }

  public static async findById(id: string): Promise<Board | undefined> {
    const db = await getDb();
    return db.get<Board>('SELECT * FROM boards WHERE id = ?', [id]);
  }

  public static async findByExternalKey(externalKey: string): Promise<Board | undefined> {
    const db = await getDb();
    return db.get<Board>('SELECT * FROM boards WHERE external_key = ?', [externalKey]);
  }

  public static async findAllActive(): Promise<Board[]> {
    const db = await getDb();
    const result = await db.all<Board[]>(
      'SELECT * FROM boards WHERE status = ? ORDER BY created_at ASC',
      [BoardStatus.ACTIVE]
    );
    return result;
  }

  public static async findAllDeleted(): Promise<Board[]> {
    const db = await getDb();
    const result = await db.all<Board[]>(
      'SELECT * FROM boards WHERE status = ? ORDER BY updated_at DESC',
      [BoardStatus.DELETED]
    );
    return result;
  }

  public static async update(id: string, input: UpdateBoardInput = {}): Promise<Board | undefined> {
    const db = await getDb();
    const board = await this.findById(id);

    if (!board) {
      return undefined;
    }

    const now = Date.now();
    const updates: Partial<Omit<Board, 'id'>> = {
      updated_at: now,
    };

    if (input.name !== undefined) {
      updates.name = input.name;
    }

    if (input.status !== undefined) {
      updates.status = input.status;
    }

    const setClause = Object.keys(updates)
      .map(key => `${key} = ?`)
      .join(', ');
    const values = [...Object.values(updates), id];

    await db.run(`UPDATE boards SET ${setClause} WHERE id = ?`, values);

    return {
      ...board,
      ...updates,
    };
  }

  public static async moveToTrash(id: string): Promise<Board | undefined> {
    return this.update(id, { status: BoardStatus.DELETED });
  }

  public static async restoreFromTrash(id: string): Promise<Board | undefined> {
    return this.update(id, { status: BoardStatus.ACTIVE });
  }

  public static async permanentlyDelete(id: string): Promise<void> {
    const db = await getDb();
    await db.run('DELETE FROM boards WHERE id = ?', [id]);
  }

  public static async delete(id: string): Promise<void> {
    return this.permanentlyDelete(id);
  }
}
