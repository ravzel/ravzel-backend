import { Router } from 'express';
import {
  getHealthStatus,
  getModelsStatus,
  handleChatRequest
} from '../controllers/aiAssistantController.js';

const router = Router();

router.get('/health', getHealthStatus);
router.get('/models', getModelsStatus);
router.post('/chat', handleChatRequest);

export default router;
