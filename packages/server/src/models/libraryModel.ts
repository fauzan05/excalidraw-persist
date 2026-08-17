import type { Database } from 'sqlite';
import { getDb, withTransaction } from '../lib/database';
import type { ExcalidrawLibraryItems, LibraryPersistedData, LibraryRecord } from '../types';
import logger from '../utils/logger';

interface SaveOptions {
  db?: Database;
  useTransaction?: boolean;
}

export class LibraryModel {
  public static async getByBoardId(boardId: string): Promise<LibraryPersistedData | null> {
    const db = await getDb();
    const record = await db.get<LibraryRecord | undefined>(
      'SELECT board_id, data, updated_at FROM libraries WHERE board_id = ?',
      [boardId]
    );

    if (!record) {
      return null;
    }

    try {
      const parsed = JSON.parse(record.data) as unknown;
      if (!Array.isArray(parsed)) {
        logger.warn(
          `Library data for board ${boardId} is not an array. Returning empty library instead.`
        );
        return { libraryItems: [] };
      }

      return { libraryItems: parsed as ExcalidrawLibraryItems };
    } catch (error) {
      logger.error(`Failed to parse library data for board ${boardId}:`, error);
      return { libraryItems: [] };
    }
  }

  public static async save(
    boardId: string,
    libraryItems: ExcalidrawLibraryItems,
    options: SaveOptions = {}
  ): Promise<void> {
    const shouldManageTransaction = options.useTransaction ?? !options.db;
    if (shouldManageTransaction) {
      await withTransaction(async db => {
        await LibraryModel.save(boardId, libraryItems, { db, useTransaction: false });
      });
      return;
    }

    const db = options.db ?? (await getDb());
    const now = Date.now();
    const payload = JSON.stringify(libraryItems ?? []);

    try {
      await db.run(
        `
          INSERT INTO libraries (board_id, data, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(board_id) DO UPDATE SET
            data = excluded.data,
            updated_at = excluded.updated_at
        `,
        [boardId, payload, now]
      );
    } catch (error) {
      logger.error(`Failed to save library for board ${boardId}:`, error);
      throw error;
    }
  }

  public static async deleteByBoardId(boardId: string): Promise<void> {
    const db = await getDb();
    await db.run('DELETE FROM libraries WHERE board_id = ?', [boardId]);
  }
}
