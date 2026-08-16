import { Router } from 'express';
import { boardController } from '../controllers/boardController';
import elementRoutes from './elementRoutes';
import libraryRoutes from './libraryRoutes';
import { requireBoardJwtMatch, requireEmbedJwt } from '../middleware/auth';
import { env } from '../config/env';
import { Request, Response, NextFunction } from 'express';

const router = Router();

const denyAnonymousCreate = (_req: Request, res: Response, next: NextFunction) => {
  if (env.JWT_SECRET) {
    return res.status(403).json({
      success: false,
      message: 'anonymous_create_disabled',
    });
  }
  return next();
};

router.get('/', requireEmbedJwt, boardController.listActive);
router.get('/trash', requireEmbedJwt, boardController.listTrash);
router.post('/', requireEmbedJwt, denyAnonymousCreate, boardController.create);
router.put('/:id', requireEmbedJwt, requireBoardJwtMatch, boardController.update);
router.delete('/:id', requireEmbedJwt, requireBoardJwtMatch, boardController.moveToTrash);
router.post(
  '/:id/restore',
  requireEmbedJwt,
  requireBoardJwtMatch,
  boardController.restoreFromTrash
);
router.delete(
  '/:id/permanent',
  requireEmbedJwt,
  requireBoardJwtMatch,
  boardController.permanentDelete
);
router.use('/:boardId/elements', requireEmbedJwt, requireBoardJwtMatch, elementRoutes);
router.use('/:boardId/library', requireEmbedJwt, requireBoardJwtMatch, libraryRoutes);

export default router;
