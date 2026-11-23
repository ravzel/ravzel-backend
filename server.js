import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import aiAssistantRoutes from './src/routes/aiAssistantRoutes.js';
import { getSanitizedModelName } from './src/services/chatService.js';

const app = express();
const PORT = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

// CORS Configuration
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser callers (curl, postman, mobile) or matching frontend origins
    if (!origin) return callback(null, true);
    if (
      origin === CORS_ORIGIN ||
      origin === 'http://localhost:3000' ||
      origin === 'http://127.0.0.1:3000' ||
      origin.startsWith('http://localhost:')
    ) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing middleware
app.use(express.json({ limit: '50kb' }));

// Mount API routes
app.use('/api/ai-assistant', aiAssistantRoutes);

// Root health probe
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'RAVZEL Backend API',
    timestamp: new Date().toISOString()
  });
});

// Start listening
app.listen(PORT, () => {
  console.log(`======================================================`);
  console.log(`🤖 RAVZEL AI Backend running on http://localhost:${PORT}`);
  console.log(`📡 Health endpoint: http://localhost:${PORT}/api/ai-assistant/health`);
  console.log(`💬 Chat endpoint:   http://localhost:${PORT}/api/ai-assistant/chat`);
  console.log(`🌐 CORS allowed for: ${CORS_ORIGIN}`);
  console.log(`⚙️  Model configured: ${getSanitizedModelName()}`);
  
  const hasKey = Boolean(
    process.env.GEMINI_API_KEY &&
    !process.env.GEMINI_API_KEY.includes('your_gemini_api_key_here')
  );
  if (!hasKey) {
    console.warn(`⚠️  NOTICE: GEMINI_API_KEY is not configured in backend/.env.`);
  } else {
    console.log(`✅ Google Gemini API Key loaded securely on backend.`);
  }
  console.log(`======================================================`);
});
