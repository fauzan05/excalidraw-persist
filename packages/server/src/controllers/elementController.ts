import { Request, Response } from 'express';
import { ElementModel } from '../models/elementModel';
import { BoardModel } from '../models/boardModel';
import { FileModel } from '../models/fileModel';
import { withTransaction } from '../lib/database';
import { isBoardUUID } from '../lib/boardId';
import { ExcalidrawElement, ExcalidrawFilesMap, ExcalidrawSceneData } from '../types';
import logger from '../utils/logger';

const failMessage = (prefix: string, error: unknown): string => {
  if (error instanceof Error && error.message) {
    return `${prefix}: ${error.message}`;
  }
  return prefix;
};

const invalidId = (res: Response) =>
  res.status(400).json({ success: false, message: 'Invalid board ID format' });

export const loadScene = async (boardId: string) => {
  const elements = await ElementModel.findAllByBoardId(boardId);
  const files = await FileModel.findAllByBoardId(boardId);
  return {
    elements: ElementModel.convertToExcalidrawElements(elements),
    files: FileModel.convertToExcalidrawFiles(files),
  };
};

export const saveScene = async (boardId: string, scene: ExcalidrawSceneData) => {
  await withTransaction(async db => {
    await ElementModel.replaceAll(boardId, scene.elements, { db, useTransaction: false });
    await FileModel.replaceAll(boardId, scene.files || {}, { db, useTransaction: false });
    await BoardModel.update(boardId, {});
  });
};

const parseSceneBody = (
  body: ExcalidrawSceneData | ExcalidrawElement[]
): { ok: true; scene: ExcalidrawSceneData } | { ok: false; message: string } => {
  if (Array.isArray(body)) {
    return { ok: true, scene: { elements: body, files: {} } };
  }
  if (body && typeof body === 'object') {
    const scenePayload = body as Partial<ExcalidrawSceneData>;
    if (!scenePayload.elements || !Array.isArray(scenePayload.elements)) {
      return { ok: false, message: 'Invalid scene payload: elements must be an array' };
    }
    let files: ExcalidrawFilesMap = {};
    if (
      scenePayload.files &&
      typeof scenePayload.files === 'object' &&
      !Array.isArray(scenePayload.files)
    ) {
      files = { ...scenePayload.files } as ExcalidrawFilesMap;
    }
    return { ok: true, scene: { elements: scenePayload.elements, files } };
  }
  return { ok: false, message: 'Invalid request payload' };
};

export const elementController = {
  async getByBoardId(req: Request<{ boardId: string }>, res: Response) {
    try {
      const { boardId } = req.params;
      if (!isBoardUUID(boardId)) {
        return invalidId(res);
      }

      const board = await BoardModel.findById(boardId);
      if (!board) {
        return res.status(404).json({
          success: false,
          message: 'Board not found',
        });
      }

      const data = await loadScene(boardId);
      return res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error(`Error getting elements for board ${req.params.boardId}:`, error);
      return res.status(500).json({
        success: false,
        message: 'Failed to get elements',
      });
    }
  },

  async replaceAll(
    req: Request<{ boardId: string }, unknown, ExcalidrawSceneData | ExcalidrawElement[]>,
    res: Response
  ) {
    try {
      const { boardId } = req.params;
      if (!isBoardUUID(boardId)) {
        return invalidId(res);
      }

      const parsed = parseSceneBody(req.body);
      if (!parsed.ok) {
        return res.status(400).json({ success: false, message: parsed.message });
      }

      const board = await BoardModel.findById(boardId);
      if (!board) {
        return res.status(404).json({
          success: false,
          message: 'Board not found',
        });
      }

      await saveScene(boardId, parsed.scene);

      return res.status(200).json({
        success: true,
        message: `Elements replaced for board ${boardId}`,
      });
    } catch (error) {
      logger.error(`Error replacing elements for board ${req.params.boardId}:`, error);
      return res.status(500).json({
        success: false,
        message: failMessage('Failed to replace elements', error),
      });
    }
  },

  async applyDelta(
    req: Request<
      { boardId: string },
      unknown,
      { upserted?: ExcalidrawElement[]; deleted?: string[] }
    >,
    res: Response
  ) {
    try {
      const { boardId } = req.params;
      if (!isBoardUUID(boardId)) {
        return invalidId(res);
      }

      const board = await BoardModel.findById(boardId);
      if (!board) {
        return res.status(404).json({
          success: false,
          message: 'Board not found',
        });
      }

      const upserted = Array.isArray(req.body?.upserted) ? req.body.upserted : [];
      const deleted = Array.isArray(req.body?.deleted) ? req.body.deleted : [];
      const deletedSet = new Set(deleted.filter(id => typeof id === 'string' && id.trim()));
      const current = await loadScene(boardId);
      const byId = new Map(
        current.elements.filter(element => !deletedSet.has(element.id)).map(element => [element.id, element])
      );
      for (const element of upserted) {
        if (element?.id) {
          byId.set(element.id, element);
        }
      }
      await saveScene(boardId, { elements: [...byId.values()], files: current.files });

      return res.status(200).json({
        success: true,
        message: `Delta applied for board ${boardId}`,
      });
    } catch (error) {
      logger.error(`Error applying delta for board ${req.params.boardId}:`, error);
      return res.status(500).json({
        success: false,
        message: failMessage('Failed to apply delta', error),
      });
    }
  },
};
