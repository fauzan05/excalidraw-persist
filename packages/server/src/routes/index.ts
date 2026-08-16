import { Router } from 'express';
import boardRoutes from './boardRoutes';
import serviceRoutes from './serviceRoutes';

const router = Router();

router.use('/service', serviceRoutes);
router.use('/boards', boardRoutes);

router.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

export default router;
