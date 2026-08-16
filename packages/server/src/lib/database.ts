import sqlite3 from 'sqlite3';
import * as sqlite from 'sqlite';
import type { Database as SqliteDatabase } from 'sqlite';
import fs from 'fs';
import path from 'path';
import { dbConfig } from '../config';
import logger from '../utils/logger';

class Database {
  private static instance: Database;
  private db: sqlite.Database | null = null;

  private constructor() {}

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  public async open(): Promise<sqlite.Database> {
    if (this.db) {
      return this.db;
    }

    try {
      const dbDir = path.dirname(dbConfig.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        logger.info(`Created database directory: ${dbDir}`);
      }

      logger.info(`Opening database at ${dbConfig.dbPath}`);
      const openedDb = await sqlite.open({
        filename: dbConfig.dbPath,
        driver: sqlite3.Database,
      });

      await openedDb.run('PRAGMA foreign_keys = ON');
      logger.info('Foreign key support enabled.');

      this.db = openedDb;
      return this.db;
    } catch (error) {
      logger.error('Error opening database:', error);
      throw error;
    }
  }

  public async initializeSchema(): Promise<void> {
    try {
      const currentDb = await this.getDb();
      await this.migrateIntegerPrimaryKeys(currentDb);
      await this.migrateDropElementsIndexUnique(currentDb);

      const schemaPath = resolveSchemaPath();
      if (!schemaPath) {
        throw new Error(`Schema file not found at ${dbConfig.schemaPath}`);
      }
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await currentDb.exec(schema);
      logger.info('Database schema initialized successfully.');
    } catch (error) {
      logger.error('Error initializing database schema:', error);
      throw error;
    }
  }

  private async migrateIntegerPrimaryKeys(currentDb: SqliteDatabase): Promise<void> {
    const row = await currentDb.get<{ sql: string }>(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'boards'`
    );
    if (!row?.sql) {
      return;
    }
    const usesIntegerPk = /id\s+INTEGER\s+PRIMARY\s+KEY/i.test(row.sql);
    if (!usesIntegerPk) {
      return;
    }
    logger.warn('Migrating boards from integer PK to UUID; existing local boards will be dropped.');
    await currentDb.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS libraries;
      DROP TABLE IF EXISTS files;
      DROP TABLE IF EXISTS elements;
      DROP TABLE IF EXISTS boards;
      PRAGMA foreign_keys = ON;
    `);
  }

  private async migrateDropElementsIndexUnique(currentDb: SqliteDatabase): Promise<void> {
    const row = await currentDb.get<{ sql: string }>(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'elements'`
    );
    if (!row?.sql || !/UNIQUE\s*\(\s*element_index\s*,\s*board_id\s*\)/i.test(row.sql)) {
      return;
    }

    logger.warn('Dropping UNIQUE(element_index, board_id) so multi-element scenes can save.');
    await currentDb.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE elements_new (
        id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        data TEXT NOT NULL,
        element_index TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        is_deleted BOOLEAN NOT NULL DEFAULT 0,
        PRIMARY KEY (id, board_id),
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
      );
      INSERT INTO elements_new (id, board_id, data, element_index, type, created_at, updated_at, is_deleted)
        SELECT id, board_id, data, element_index, type, created_at, updated_at, is_deleted FROM elements;
      DROP TABLE elements;
      ALTER TABLE elements_new RENAME TO elements;
      CREATE INDEX IF NOT EXISTS idx_elements_board_id ON elements(board_id);
      PRAGMA foreign_keys = ON;
    `);
  }

  public async close(): Promise<void> {
    if (!this.db) {
      return;
    }
    try {
      await this.db.close();
      this.db = null;
      logger.info('Database connection closed successfully.');
    } catch (error) {
      logger.error('Error closing database:', error);
      throw error;
    }
  }

  public async getDb(): Promise<sqlite.Database> {
    if (!this.db) {
      await this.open();
    }
    return this.db!;
  }
}

const databaseInstance = Database.getInstance();

const resolveSchemaPath = (): string | null => {
  const candidates = [
    dbConfig.schemaPath,
    path.join(__dirname, 'schema.sql'),
    path.join(__dirname, '..', 'lib', 'schema.sql'),
    path.join(process.cwd(), 'src', 'lib', 'schema.sql'),
    path.join(process.cwd(), 'packages', 'server', 'src', 'lib', 'schema.sql'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
};

export const getDb = (): Promise<sqlite.Database> => databaseInstance.getDb();

export const openDatabase = (): Promise<sqlite.Database> => databaseInstance.open();
export const initializeDatabase = (): Promise<void> => databaseInstance.initializeSchema();
export const closeDatabase = (): Promise<void> => databaseInstance.close();
