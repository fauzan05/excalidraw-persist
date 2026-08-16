import { Request, Response } from 'express';
import { BoardModel } from '../models/boardModel';
import { LibraryModel } from '../models/libraryModel';
import type { LibraryPersistedData } from '../types';
import { isBoardUUID } from '../lib/boardId';
import logger from '../utils/logger';

const invalidId = (res: Response) =>
  res.status(400).json({ success: false, message: 'Invalid board ID format' });

export const libraryController = {
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

      const libraryData = await LibraryModel.getByBoardId(boardId);

      return res.status(200).json({
        success: true,
        data: libraryData ?? { libraryItems: [] },
      });
    } catch (error) {
      logger.error(`Error getting library for board ${req.params.boardId}:`, error);
      return res.status(500).json({
        success: false,
        message: 'Failed to get library data',
      });
    }
  },

  async save(req: Request<{ boardId: string }, unknown, LibraryPersistedData>, res: Response) {
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

      const libraryItems = Array.isArray(req.body?.libraryItems) ? req.body.libraryItems : [];
      await LibraryModel.save(boardId, libraryItems);

      return res.status(200).json({
        success: true,
        message: 'Library saved',
      });
    } catch (error) {
      logger.error(`Error saving library for board ${req.params.boardId}:`, error);
      return res.status(500).json({
        success: false,
        message: 'Failed to save library data',
      });
    }
  },
};
