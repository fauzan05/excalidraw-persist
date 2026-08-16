import { Request, Response } from 'express';
import { BoardModel } from '../models/boardModel';
import { loadScene, saveScene } from './elementController';
import { isBoardUUID } from '../lib/boardId';
import { ExcalidrawSceneData } from '../types';
import logger from '../utils/logger';

const EXTERNAL_KEY_RE = /^(meeting|document):.+/;

export const serviceController = {
  async ensureBoard(req: Request, res: Response) {
    try {
      const externalKey =
        typeof req.body?.external_key === 'string' ? req.body.external_key.trim() : '';
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
      const resourceType =
        req.body?.resource_type === 'meeting' || req.body?.resource_type === 'document'
          ? req.body.resource_type
          : undefined;

      if (!externalKey || !EXTERNAL_KEY_RE.test(externalKey)) {
        return res.status(400).json({
          success: false,
          message: 'external_key must start with meeting: or document:',
        });
      }

      const result = await BoardModel.ensureByExternalKey({
        external_key: externalKey,
        name,
        resource_type: resourceType,
      });

      return res.status(result.created ? 201 : 200).json({
        success: true,
        data: {
          id: result.board.id,
          external_key: result.board.external_key,
          name: result.board.name,
          resource_type: result.board.resource_type,
          created: result.created,
        },
      });
    } catch (error) {
      logger.error('EnsureBoard failed:', error);
      return res.status(500).json({ success: false, message: 'Failed to ensure board' });
    }
  },

  async getScene(req: Request, res: Response) {
    try {
      const { id } = req.params;
      if (!isBoardUUID(id)) {
        return res.status(400).json({ success: false, message: 'Invalid board ID format' });
      }
      const board = await BoardModel.findById(id);
      if (!board) {
        return res.status(404).json({ success: false, message: 'Board not found' });
      }
      const data = await loadScene(id);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      logger.error(`GetScene failed for ${req.params.id}:`, error);
      return res.status(500).json({ success: false, message: 'Failed to get scene' });
    }
  },

  async putScene(req: Request, res: Response) {
    try {
      const { id } = req.params;
      if (!isBoardUUID(id)) {
        return res.status(400).json({ success: false, message: 'Invalid board ID format' });
      }
      const board = await BoardModel.findById(id);
      if (!board) {
        return res.status(404).json({ success: false, message: 'Board not found' });
      }
      const body = req.body as Partial<ExcalidrawSceneData>;
      if (!body || !Array.isArray(body.elements)) {
        return res.status(400).json({ success: false, message: 'elements must be an array' });
      }
      const scene: ExcalidrawSceneData = {
        elements: body.elements,
        files: body.files && typeof body.files === 'object' ? body.files : {},
      };
      await saveScene(id, scene);
      return res.status(200).json({ success: true, data: { id } });
    } catch (error) {
      logger.error(`PutScene failed for ${req.params.id}:`, error);
      return res.status(500).json({ success: false, message: 'Failed to put scene' });
    }
  },
};
