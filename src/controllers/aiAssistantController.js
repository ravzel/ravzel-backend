import {
  validateChatPayload,
  processChatRequest,
  checkModelAvailability,
  getSanitizedModelName
} from '../services/chatService.js';

/**
 * Controller: Health status check
 */
export async function getHealthStatus(req, res) {
  const hasKey = Boolean(
    process.env.GEMINI_API_KEY &&
    !process.env.GEMINI_API_KEY.includes('your_gemini_api_key_here')
  );

  return res.status(200).json({
    status: 'ok',
    service: 'RAVZEL AI Assistant Backend',
    provider: 'Google Gemini',
    model: getSanitizedModelName(),
    apiKeyConfigured: hasKey,
    timestamp: new Date().toISOString()
  });
}

/**
 * Controller: Models verification
 */
export async function getModelsStatus(req, res) {
  try {
    const result = await checkModelAvailability();
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('Error verifying Gemini models:', err);
    return res.status(500).json({
      error: 'Model verification failed',
      message: err.message
    });
  }
}

/**
 * Controller: Chat endpoint
 */
export async function handleChatRequest(req, res) {
  const validation = validateChatPayload(req.body);
  if (!validation.valid) {
    return res.status(400).json({
      error: 'Validation Error',
      message: validation.error
    });
  }

  const clientIp =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    '127.0.0.1';

  try {
    const result = await processChatRequest({
      message: validation.message,
      history: validation.history,
      ip: clientIp
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('Unhandled controller error in handleChatRequest:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected server error occurred.'
    });
  }
}
