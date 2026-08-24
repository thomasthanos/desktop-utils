const { buildResponseSchema, SYSTEM_PROMPT } = require('./schema');
const log = require('../utils/logger')('ai');

const TIMEOUT_MS = 15000;

const PROVIDERS = {
  gemini: {
    model: () => process.env.AI_MODEL || 'gemini-flash-lite-latest',
    keyEnv: 'GEMINI_API_KEY',

    buildRequest(key, model, messages, contextText) {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: {
          systemInstruction: {
            parts: contextText ? [{ text: SYSTEM_PROMPT }, { text: contextText }] : [{ text: SYSTEM_PROMPT }]
          },
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: buildResponseSchema(),
            temperature: 0.6,
            maxOutputTokens: 500
          }
        }
      };
    },

    extract(data) {
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      return typeof text === 'string' ? text : null;
    }
  },

  groq: {
    model: () => process.env.AI_MODEL || 'llama-3.3-70b-versatile',
    keyEnv: 'GROQ_API_KEY',

    buildRequest(key, model, messages, contextText) {
      return {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: {
          model,
          response_format: { type: 'json_object' },
          temperature: 0.6,
          max_tokens: 500,
          messages: [
            { role: 'system', content: `${SYSTEM_PROMPT}\n\nΑπάντησε ΜΟΝΟ με JSON: {"reply": "...", "action": "...", "query": "...", "value": 0}` },
            ...(contextText ? [{ role: 'system', content: contextText }] : []),
            ...messages
          ]
        }
      };
    },

    extract(data) {
      const text = data?.choices?.[0]?.message?.content;
      return typeof text === 'string' ? text : null;
    }
  }
};

function defaultModel() {
  const provider = PROVIDERS[activeProviderName()];
  return provider ? provider.model() : null;
}

function activeProviderName() {
  return String(process.env.AI_PROVIDER || 'gemini').toLowerCase();
}

function getApiKey() {
  const provider = PROVIDERS[activeProviderName()];
  if (!provider) return null;
  const key = process.env[provider.keyEnv];
  return key && String(key).trim() ? String(key).trim() : null;
}

function isEnabled() {
  return getApiKey() !== null;
}

async function callProvider(messages, deps = {}, contextText = '') {
  const doFetch = deps.fetch || globalThis.fetch;
  const key = deps.apiKey ?? getApiKey();
  if (!key) return null;

  const provider = PROVIDERS[activeProviderName()];
  if (!provider) {
    log.warn(`Unknown AI_PROVIDER "${activeProviderName()}" — AI disabled.`);
    return null;
  }

  const { url, headers, body } = provider.buildRequest(key, provider.model(), messages, contextText);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text?.().catch(() => '') || '';

      const flat = String(detail).replace(/\s+/g, ' ').trim();
      log.warn(`AI provider returned ${response.status}: ${flat.slice(0, 400)}`);

      if (response.status === 404) {
        log.warn(
          `Model "${provider.model()}" was not found. Run "npm run diag:ai" to list the models `
          + 'this key can actually use, then set AI_MODEL to one of them.'
        );
      }
      return null;
    }

    const raw = provider.extract(await response.json());
    if (!raw) {
      log.warn('AI provider returned no text.');
      return null;
    }

    return parseModelOutput(raw);
  } catch (error) {
    if (error.name === 'AbortError') log.warn(`AI request timed out after ${TIMEOUT_MS}ms.`);
    else log.warn('AI request failed:', error.message || error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseModelOutput(raw) {
  const text = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      reply: typeof parsed.reply === 'string' ? parsed.reply : '',
      action: typeof parsed.action === 'string' ? parsed.action : 'none',
      query: typeof parsed.query === 'string' ? parsed.query : '',
      value: Number.isFinite(Number(parsed.value)) ? Number(parsed.value) : 0
    };
  } catch {
    return { reply: text.slice(0, 500), action: 'none', query: '', value: 0 };
  }
}

module.exports = { callProvider, parseModelOutput, isEnabled, getApiKey, activeProviderName, defaultModel, PROVIDERS, TIMEOUT_MS };
