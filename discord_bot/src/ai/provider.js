const { buildResponseSchema, SYSTEM_PROMPT } = require('./schema');
const log = require('../utils/logger')('ai');

/**
 * Κλήση του παρόχου AI με σκέτο `fetch`, χωρίς SDK — όπως ήδη κάνει το play.js
 * για το oEmbed του Spotify. Ένα SDK εδώ θα ήταν άλλη μια εξάρτηση με δικό της
 * κύκλο ενημερώσεων για ένα POST με JSON.
 *
 * Προεπιλογή: Google Gemini `gemini-2.5-flash-lite`. Χωρίς κάρτα, με διαφορά το
 * γενναιόδωρο δωρεάν tier. Δύο λόγοι πέρα από τα όρια: υποστηρίζει **δομημένη
 * έξοδο με σχήμα** (χωρίς αυτό η ασφάλεια του schema.js δεν επιβάλλεται) και
 * τα ελληνικά του είναι αισθητά καλύτερα από τα δωρεάν μοντέλα Llama.
 *
 * ΙΔΙΩΤΙΚΟΤΗΤΑ: το δωρεάν tier της Google επιτρέπεται να χρησιμοποιεί τα
 * δεδομένα για εκπαίδευση. Ό,τι φεύγει από εδώ πρέπει να το έχεις γράψει εσύ ή
 * να είναι συγκεντρωτικό. Ποτέ αρχειοθετημένα μηνύματα άλλων ανθρώπων.
 */

const TIMEOUT_MS = 15000;

const PROVIDERS = {
  gemini: {
    // Ψευδώνυμο, όχι καρφωμένη έκδοση. Η προεπιλογή ήταν
    // `gemini-2.5-flash-lite` και η Google το απέσυρε για νέα κλειδιά: το
    // ListModels συνεχίζει να το δείχνει, αλλά η κλήση απαντάει 404. Ένα
    // καρφωμένο όνομα ξαναφέρνει το ίδιο σε λίγους μήνες, σε κάθε καινούρια
    // εγκατάσταση, και το σύμπτωμα είναι σιωπηλό — το bot πέφτει στον εφεδρικό
    // router και απαντάει κανονικά.
    model: () => process.env.AI_MODEL || 'gemini-flash-lite-latest',
    keyEnv: 'GEMINI_API_KEY',

    buildRequest(key, model, messages) {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: {
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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

    buildRequest(key, model, messages) {
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

function activeProviderName() {
  return String(process.env.AI_PROVIDER || 'gemini').toLowerCase();
}

/** Το κλειδί του ενεργού παρόχου, ή null. Ο μόνος διακόπτης ον/off. */
function getApiKey() {
  const provider = PROVIDERS[activeProviderName()];
  if (!provider) return null;
  const key = process.env[provider.keyEnv];
  return key && String(key).trim() ? String(key).trim() : null;
}

function isEnabled() {
  return getApiKey() !== null;
}

/**
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} [deps] `fetch` ενίεται ώστε τα τεστ να τρέχουν χωρίς δίκτυο
 * @returns {Promise<{reply: string, action: string, query?: string, value?: number}|null>}
 */
async function callProvider(messages, deps = {}) {
  const doFetch = deps.fetch || globalThis.fetch;
  const key = deps.apiKey ?? getApiKey();
  if (!key) return null;

  const provider = PROVIDERS[activeProviderName()];
  if (!provider) {
    log.warn(`Unknown AI_PROVIDER "${activeProviderName()}" — AI disabled.`);
    return null;
  }

  const { url, headers, body } = provider.buildRequest(key, provider.model(), messages);

  // Μια κλήση AI δεν πρέπει ΠΟΤΕ να μπλοκάρει τον ήχο. Ο ήχος τρέχει στο ίδιο
  // event loop και ένα αίτημα που κρέμεται είναι χειρότερο από ένα που αποτυγχάνει.
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

      // Οι πάροχοι απαντούν με μορφοποιημένο JSON σε πολλές γραμμές. Το
      // journalctl δείχνει την πρώτη — που είναι το `{`. Το μήνυμα, δηλαδή ο
      // λόγος της αποτυχίας, μένει αόρατο ακριβώς όταν το χρειάζεσαι.
      const flat = String(detail).replace(/\s+/g, ' ').trim();
      log.warn(`AI provider returned ${response.status}: ${flat.slice(0, 400)}`);

      // Το 404 δεν σημαίνει «λάθος κλειδί» — σημαίνει «αυτό το μοντέλο δεν
      // υπάρχει για αυτό το κλειδί». Είναι ρύθμιση, όχι βλάβη, και έχει
      // συγκεκριμένη απάντηση.
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
    // Το abort είναι αναμενόμενο στα 15 δευτερόλεπτα, όχι σφάλμα προς αναφορά.
    if (error.name === 'AbortError') log.warn(`AI request timed out after ${TIMEOUT_MS}ms.`);
    else log.warn('AI request failed:', error.message || error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Το μοντέλο υποτίθεται ότι επιστρέφει JSON. Το «υποτίθεται» είναι ο λόγος που
 * αυτό υπάρχει: ένα μοντέλο που τυλίγει το JSON σε ```json ... ``` δεν είναι
 * σφάλμα, είναι Τρίτη.
 */
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
    // Καθόλου JSON: το κείμενο είναι ακόμα χρήσιμο ως απάντηση κουβέντας.
    return { reply: text.slice(0, 500), action: 'none', query: '', value: 0 };
  }
}

module.exports = { callProvider, parseModelOutput, isEnabled, getApiKey, activeProviderName, PROVIDERS, TIMEOUT_MS };
