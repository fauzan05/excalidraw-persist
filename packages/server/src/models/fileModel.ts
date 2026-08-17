import type { Database } from 'sqlite';
import { getDb, withTransaction } from '../lib/database';
import { ExcalidrawBinaryFileData, ExcalidrawFilesMap, StoredFile } from '../types';

interface ReplaceAllOptions {
  db?: Database;
  useTransaction?: boolean;
}

export class FileModel {
  public static async replaceAll(
    boardId: string,
    files: ExcalidrawFilesMap = {},
    options: ReplaceAllOptions = {}
  ): Promise<void> {
    const shouldManageTransaction = options.useTransaction ?? !options.db;
    if (shouldManageTransaction) {
      await withTransaction(async db => {
        await FileModel.replaceAll(boardId, files, { db, useTransaction: false });
      });
      return;
    }

    const db = options.db ?? (await getDb());
    const now = Date.now();

    try {
      await db.run('DELETE FROM files WHERE board_id = ?', [boardId]);

      const entries = Object.entries(files);
      if (entries.length > 0) {
        const sql = `INSERT INTO files (id, board_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`;
        const stmt = await db.prepare(sql);

        for (const [id, file] of entries) {
          const fileId = file.id || id;
          const serializedFile = JSON.stringify({ ...file, id: fileId });
          await stmt.run([fileId, boardId, serializedFile, now, now]);
        }

        await stmt.finalize();
      }
    } catch (error) {
      console.error(`Error replacing files for board ${boardId}:`, error);
      throw error;
    }
  }

  public static async upsertMany(boardId: string, files: ExcalidrawFilesMap = {}): Promise<void> {
    const entries = Object.entries(files);
    if (entries.length === 0) {
      return;
    }

    await withTransaction(async db => {
      const now = Date.now();
      const sql = `INSERT INTO files (id, board_id, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id, board_id) DO UPDATE SET
          data = excluded.data,
          updated_at = excluded.updated_at`;
      const stmt = await db.prepare(sql);
      try {
        for (const [id, file] of entries) {
          const fileId = file.id || id;
          const serializedFile = JSON.stringify({ ...file, id: fileId });
          await stmt.run([fileId, boardId, serializedFile, now, now]);
        }
      } finally {
        await stmt.finalize();
      }
    });
  }

  public static async checkExisting(boardId: string, fileIds: string[]): Promise<string[]> {
    if (fileIds.length === 0) {
      return [];
    }
    const db = await getDb();
    const placeholders = fileIds.map(() => '?').join(', ');
    const rows = await db.all<{ id: string }[]>(
      `SELECT id FROM files WHERE board_id = ? AND id IN (${placeholders})`,
      [boardId, ...fileIds]
    );
    return rows.map(row => row.id);
  }

  public static async findAllByBoardId(boardId: string): Promise<StoredFile[]> {
    const db = await getDb();
    return db.all<StoredFile[]>('SELECT * FROM files WHERE board_id = ?', [boardId]);
  }

  public static convertToExcalidrawFiles(files: StoredFile[]): ExcalidrawFilesMap {
    return files.reduce<ExcalidrawFilesMap>((acc, file) => {
      try {
        const parsed = JSON.parse(file.data) as ExcalidrawBinaryFileData;
        if (!parsed.id) {
          parsed.id = file.id;
        }
        acc[file.id] = parsed;
      } catch (error) {
        console.error('Error parsing file data:', error);
      }
      return acc;
    }, {});
  }
}
