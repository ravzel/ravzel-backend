import { GoogleGenAI } from '@google/genai';
import { buildSystemPrompt } from './knowledgeBase.js';

// In-memory rate limiting map: ip -> timestamps[]
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 25; // max 25 queries per minute per IP

const DEFAULT_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

// Pre-cached Instant FAQ replies for instantaneous sub-millisecond responses
const INSTANT_FAQS = [
  {
    triggers: ['what is ravzel', 'about ravzel', 'who are you', 'tell me about ravzel'],
    answer: `**RAVZEL** is a digital studio & software solution partner. We bring design, development, and technology together to create purposeful digital experiences for modern businesses.\n\n• **Tagline:** Build Beyond. Evolve Forward.\n• **Motto:** Where Innovation Creates Impact.\n• **Specialty:** Bespoke business websites, high-performance web applications, and digital marketing solutions.`
  },
  {
    triggers: ['what services do you offer', 'services', 'capabilities', 'what do you do', 'offerings'],
    answer: `RAVZEL offers **5 core digital services**:\n\n1. **Website Development:** High-converting commercial websites, landing pages, and portfolio sites.\n2. **Web Application Development:** Custom web apps, admin panels, interactive dashboards, user auth, and APIs.\n3. **Billing & Inventory Management Systems:** Smart POS billing, live stock tracking, and barcode integration.\n4. **Learning Management Systems (LMS):** Course portals, student dashboards, and progress tracking.\n5. **Digital Marketing Creatives:** High-impact social media creatives, ad campaigns, and promotional design.`
  },
  {
    triggers: ['can you build a custom web application', 'custom web application', 'web application', 'web app'],
    answer: `**Yes, absolutely.** We build scalable full-stack web applications tailored to your operational workflows:\n\n• Secure role-based user authentication\n• Custom interactive admin dashboards & business analytics\n• Scalable database architecture (MongoDB, PostgreSQL)\n• Robust REST & GraphQL APIs with third-party integrations`
  },
  {
    triggers: ['do you develop admin dashboards', 'admin dashboard', 'dashboard', 'admin panel'],
    answer: `**Yes!** We develop intuitive, real-time admin panels and operational dashboards.\n\nRecent deployments include the **FA Organics Custom Admin Suite** (live inventory, order tracking, and product controls) and the **SS Auto Spares Billing & POS Engine**.`
  },
  {
    triggers: ['can you build an e-commerce website', 'e-commerce', 'ecommerce', 'online store', 'shopping'],
    answer: `**Yes!** We engineer custom, high-converting e-commerce platforms with automated milestone rewards, dynamic category filtering, fast checkout, and unified admin management.\n\nCheck out our latest deployment: **FA Organics** (https://faaorganics.in) — a full-stack botanical skincare platform.`
  },
  {
    triggers: ['fa organics', 'faaorganics'],
    answer: `**FA Organics** (https://faaorganics.in) is our latest full-stack client deployment:\n\n• **Type:** Botanical Skincare E-Commerce & Custom Admin Suite\n• **Tech Stack:** React, Vite, Tailwind CSS, Node.js, Express, MongoDB\n• **Features:** Dynamic category filtering, cart milestone rewards, customer accounts, and an end-to-end admin dashboard for inventory and orders.`
  },
  {
    triggers: ['browtiful strokes'],
    answer: `**Browtiful Strokes** (https://browtiful-strokes.in) is a client platform built by RAVZEL for a premier Mehndi & Nails Studio and Academy, featuring natural henna catalogs, nail artistry galleries, course details, and appointment booking funnels.`
  },
  {
    triggers: ['nutrisun', 'nutri sun'],
    answer: `**Nutrisun** (https://app.nutrisun.cloud) is a cloud-based SaaS subscription web application built by RAVZEL featuring secure user authentication, personalized meal scheduling, and recurring subscription workflows.`
  },
  {
    triggers: ['do you provide poster and promotional design', 'poster', 'promotional design', 'graphic design', 'marketing creatives'],
    answer: `**Yes!** Through our **Digital Marketing Creatives & Advertising Design** service, we craft:\n\n• High-impact social media creatives & Instagram ads\n• Product launch posters, promotional flyers & festival banners\n• Brand identity systems with crisp visual storytelling`
  },
  {
    triggers: ['can i see your previous projects', 'projects', 'portfolio', 'previous work', 'our work', 'client work'],
    answer: `RAVZEL has delivered **11 verified client deployments**:\n\n1. **FA Organics** (https://faaorganics.in) – E-commerce & custom admin suite\n2. **Nutrisun** (https://app.nutrisun.cloud) – Cloud SaaS subscription platform\n3. **Browtiful Strokes** (https://browtiful-strokes.in) – Studio & academy booking site\n4. **Shas Evergreen Henna** (https://shas-evergreen-henna.netlify.app) – Henna store\n5. **SS Auto Spares Billing** (https://ssautospares.netlify.app) – POS billing engine\n\nScroll to the **Our Work** section to explore all 11 live projects!`
  },
  {
    triggers: ['how does your development process work', 'process', 'workflow', 'how do you work'],
    answer: `Our structured **5-stage development workflow** ensures high quality and timely delivery:\n\n1. **Discover:** Clarify your business goals, target audience, and scope.\n2. **Plan:** Architecture, wireframing, and tech stack roadmap.\n3. **Design & Develop:** Precision UI/UX paired with clean, modern code.\n4. **Test & Refine:** Rigorous mobile, cross-browser, and performance testing.\n5. **Launch:** Production deployment, DNS setup, and seamless handover.`
  },
  {
    triggers: ['how much does a project cost', 'cost', 'pricing', 'price', 'rates', 'quote', 'how much'],
    answer: `Every project is custom scoped based on your specific requirements, feature set, and target timeline. We focus on transparent, value-driven pricing without bloated agency markups.\n\nConnect with our core team for a fast, free estimate:\n• 💬 **WhatsApp:** https://wa.me/919360977952 (+91 93609 77952)\n• ✉️ **Email:** mailto:ravzel26@gmail.com`
  },
  {
    triggers: ['how can i contact ravzel', 'contact', 'email', 'phone', 'whatsapp', 'reach', 'talk'],
    answer: `Connect with the RAVZEL core team directly:\n\n• 💬 **WhatsApp:** https://wa.me/919360977952 (+91 93609 77952)\n• ✉️ **Email:** mailto:ravzel26@gmail.com\n• **Status:** Available for new client projects!`
  }
];

export function findInstantFaq(query) {
  if (!query) return null;
  const normalized = query.toLowerCase().replace(/[?!.,'"]/g, '').trim();
  for (const item of INSTANT_FAQS) {
    if (item.triggers.some(t => normalized === t || normalized.includes(t))) {
      return item.answer;
    }
  }
  return null;
}

/**
 * Sanitizes and resolves the configured Gemini model name
 */
export function getSanitizedModelName() {
  const envModel = process.env.GEMINI_MODEL?.trim();
  if (!envModel || envModel === 'your_supported_gemini_model' || envModel === 'your_gemini_model_here') {
    return DEFAULT_MODEL;
  }
  return envModel;
}

/**
 * Check and apply rate limiting
 */
export function checkRateLimit(ip = 'anonymous') {
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) || [];
  
  // Filter out timestamps outside the active window
  const recentTimestamps = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  
  if (recentTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((recentTimestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000)
    };
  }
  
  recentTimestamps.push(now);
  rateLimitMap.set(ip, recentTimestamps);
  
  // Periodically clean up old IPs
  if (rateLimitMap.size > 2000) {
    for (const [key, list] of rateLimitMap.entries()) {
      if (list.every(t => now - t >= RATE_LIMIT_WINDOW_MS)) {
        rateLimitMap.delete(key);
      }
    }
  }

  return { allowed: true };
}

/**
 * Validates request payload
 */
export function validateChatPayload(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request format. JSON body required.' };
  }

  const { message, history } = body;

  if (!message || typeof message !== 'string') {
    return { valid: false, error: 'A message string is required.' };
  }

  const trimmedMessage = message.trim();
  if (trimmedMessage.length === 0) {
    return { valid: false, error: 'Message cannot be empty.' };
  }

  if (trimmedMessage.length > 1000) {
    return { valid: false, error: 'Message is too long (maximum 1000 characters allowed).' };
  }

  let sanitizedHistory = [];
  if (Array.isArray(history)) {
    // Take at most the last 8 messages to prevent context exhaustion and control API cost
    const recent = history.slice(-8);
    for (const item of recent) {
      if (item && (item.role === 'user' || item.role === 'assistant' || item.role === 'model') && typeof item.content === 'string') {
        sanitizedHistory.push({
          role: item.role === 'assistant' ? 'model' : item.role,
          content: item.content.slice(0, 1000)
        });
      }
    }
  }

  return {
    valid: true,
    message: trimmedMessage,
    history: sanitizedHistory
  };
}

/**
 * Formats conversation history into Gemini contents payload
 */
export function formatGeminiContents(history, newMessage) {
  const contents = [];

  for (const item of history) {
    const role = item.role === 'model' || item.role === 'assistant' ? 'model' : 'user';
    contents.push({
      role,
      parts: [{ text: item.content }]
    });
  }

  contents.push({
    role: 'user',
    parts: [{ text: newMessage }]
  });

  // Gemini API requires conversation contents to start with 'user'
  while (contents.length > 0 && contents[0].role === 'model') {
    contents.shift();
  }

  // Ensure alternating turns if consecutive messages share the same role
  const collapsed = [];
  for (const turn of contents) {
    if (collapsed.length > 0 && collapsed[collapsed.length - 1].role === turn.role) {
      collapsed[collapsed.length - 1].parts[0].text += `\n\n${turn.parts[0].text}`;
    } else {
      collapsed.push(turn);
    }
  }

  return collapsed;
}

/**
 * Core handler to process chat query with Google Gemini
 */
export async function processChatRequest({ message, history, ip }) {
  // 1. Rate Limiting Check
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return {
      status: 429,
      body: {
        error: 'Too Many Requests',
        message: `You've sent several messages quickly. Please wait ${rateLimit.retryAfterSec}s before sending another message.`
      }
    };
  }

  // 1.5. Instant FAQ Cache Check (Zero-Latency Instant Reply)
  const instantAnswer = findInstantFaq(message);
  if (instantAnswer) {
    return {
      status: 200,
      body: {
        reply: instantAnswer,
        model: 'instant-knowledge-base'
      }
    };
  }

  // 2. Credentials check
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey.includes('your_gemini_api_key_here')) {
    return {
      status: 503,
      body: {
        error: 'Configuration Required',
        message: 'Google Gemini API key is not configured on the server. Please add your valid GEMINI_API_KEY to the .env file to enable live AI responses.',
        needsApiKey: true
      }
    };
  }

  // 3. Model selection
  const configuredModel = getSanitizedModelName();

  // 4. Gemini Client instance
  const ai = new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: { timeout: 25000 }
  });

  // 5. Construct conversation messages & system prompt
  const systemPrompt = buildSystemPrompt();
  const contents = formatGeminiContents(history, message);

  // 6. Execute generateContent with automatic resilient fallback
  const modelsToTry = [configuredModel];
  for (const fallback of FALLBACK_MODELS) {
    if (!modelsToTry.includes(fallback)) {
      modelsToTry.push(fallback);
    }
  }

  let lastError = null;

  for (const modelCandidate of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelCandidate,
        contents,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.7,
          maxOutputTokens: 250
        }
      });

      const aiReply = response.text?.trim();

      if (!aiReply) {
        throw new Error('Received an empty response from the AI model.');
      }

      return {
        status: 200,
        body: {
          reply: aiReply,
          model: modelCandidate,
          usage: {
            promptTokens: response.usageMetadata?.promptTokenCount,
            completionTokens: response.usageMetadata?.candidatesTokenCount,
            totalTokens: response.usageMetadata?.totalTokenCount
          }
        }
      };
    } catch (err) {
      lastError = err;
      const status = err.status || err.code;
      console.warn(`[RAVZEL AI] Attempt with model '${modelCandidate}' failed with status: ${status}. Message: ${err.message?.slice(0, 100)}`);
      
      // If error is 401 (invalid key), do not retry other models as all will fail
      if (status === 401 || err.message?.includes('API_KEY_INVALID') || err.message?.includes('key not valid')) {
        break;
      }
      // If error is 404 (model deprecated/unavailable) or 503/504 (high demand/timeout), continue loop to fallback
    }
  }

  // If we reach here, all attempted models failed
  console.error('[RAVZEL AI] All model attempts failed:', lastError?.message || lastError);

  if (lastError?.status === 401 || lastError?.message?.includes('API_KEY_INVALID')) {
    return {
      status: 401,
      body: {
        error: 'Authentication Error',
        message: 'The server Gemini API key appears to be invalid or unauthorized. Please verify your credentials in .env.'
      }
    };
  }

  if (lastError?.status === 429) {
    return {
      status: 429,
      body: {
        error: 'Rate Limit / Quota Exceeded',
        message: 'The Gemini API request limit has been reached. Please try again in a moment or verify your quota at https://aistudio.google.com/.'
      }
    };
  }

  if (lastError?.status === 503) {
    return {
      status: 503,
      body: {
        error: 'Service Unavailable',
        message: 'Google Gemini is currently experiencing high demand. Please try asking again shortly.'
      }
    };
  }

  if (lastError?.code === 'ETIMEDOUT' || lastError?.message?.includes('timeout') || lastError?.status === 504) {
    return {
      status: 504,
      body: {
        error: 'Gateway Timeout',
        message: 'The AI request timed out. Please try asking again.'
      }
    };
  }

  return {
    status: 500,
    body: {
      error: 'AI Service Error',
      message: 'An error occurred while generating the AI response. Please try again.'
    }
  };
}

/**
 * Inspect model availability with Gemini
 */
export async function checkModelAvailability() {
  const apiKey = process.env.GEMINI_API_KEY;
  const configuredModel = getSanitizedModelName();

  if (!apiKey || apiKey.trim() === '' || apiKey.includes('your_gemini_api_key_here')) {
    return {
      status: 200,
      body: {
        configuredModel,
        provider: 'Google Gemini',
        apiKeyConfigured: false,
        verificationStatus: 'API_KEY_REQUIRED',
        instruction: 'Add your GEMINI_API_KEY to the .env file to verify model availability live against your Gemini account, or visit https://aistudio.google.com/app/apikey.',
        commonSupportedModels: [
          'gemini-3.5-flash',
          'gemini-3.5-flash-lite',
          'gemini-3.8-flash'
        ]
      }
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: apiKey.trim(), httpOptions: { timeout: 10000 } });
    const pager = await ai.models.list();
    const modelIds = [];
    for await (const m of pager) {
      if (m.name) {
        modelIds.push(m.name.replace(/^models\//, ''));
      }
    }
    const isAvailable = modelIds.includes(configuredModel);

    return {
      status: 200,
      body: {
        configuredModel,
        provider: 'Google Gemini',
        apiKeyConfigured: true,
        isConfiguredModelAvailable: isAvailable,
        verificationStatus: isAvailable ? 'AVAILABLE' : 'NOT_FOUND_IN_ACCOUNT_TIER',
        recommendedFallback: isAvailable ? null : 'gemini-3.5-flash',
        matchingModels: modelIds.filter(id => id.includes('gemini') || id.includes('flash')).slice(0, 20)
      }
    };
  } catch (err) {
    return {
      status: err.status || 500,
      body: {
        configuredModel,
        provider: 'Google Gemini',
        apiKeyConfigured: true,
        verificationStatus: 'VERIFICATION_ERROR',
        error: err.message || 'Failed to list models with the provided Gemini API key.'
      }
    };
  }
}
