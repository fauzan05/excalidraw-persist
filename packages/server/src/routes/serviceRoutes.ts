import { Router } from 'express';
import { serviceController } from '../controllers/serviceController';
import { requireServiceApiKey } from '../middleware/auth';

const router = Router();

router.use(requireServiceApiKey);
router.post('/boards/ensure', serviceController.ensureBoard);
router.get('/boards/:id/scene', serviceController.getScene);
router.put('/boards/:id/scene', serviceController.putScene);

export default router;
