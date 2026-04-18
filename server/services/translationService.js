/**
 * translationService.js
 *
 * Uses MyMemory (https://mymemory.translated.net) — a completely free
 * translation API that requires NO installation and NO API key.
 * Works perfectly on Render, Vercel, Railway, and any cloud host.
 *
 * Free tier limits:
 *   - 5,000 words / day (anonymous)
 *   - 10,000 words / day if you set MYMEMORY_EMAIL in .env (optional)
 *
 * Supports all your app languages:
 *   en, hi, bn, ta, te, mr (and many more)
 */

const AppError = require("../utils/appError");

// ─── Configuration ──────────────────────────────────────────────────────────

const MYMEMORY_BASE_URL = "https://api.mymemory.translated.net";
const TIMEOUT_MS = 15000;

// Optional: set MYMEMORY_EMAIL in .env to double the daily free limit (10k words/day)
function getMyMemoryEmail() {
  return (process.env.MYMEMORY_EMAIL || "").trim();
}

// ─── Supported Languages ─────────────────────────────────────────────────────

// MyMemory supports all standard BCP-47 language codes.
// We hard-code the list your app actually uses, so no network call is needed
// to fetch supported languages — which also removes a failure point.
const SUPPORTED_LANGUAGES = [
  { code: "en",    name: "English" },
  { code: "hi",    name: "Hindi" },
  { code: "bn",    name: "Bengali" },
  { code: "ta",    name: "Tamil" },
  { code: "te",    name: "Telugu" },
  { code: "mr",    name: "Marathi" },
  { code: "gu",    name: "Gujarati" },
  { code: "kn",    name: "Kannada" },
  { code: "ml",    name: "Malayalam" },
  { code: "pa",    name: "Punjabi" },
  { code: "ur",    name: "Urdu" },
  { code: "sa",    name: "Sanskrit" },
  { code: "or",    name: "Odia" },
  { code: "as",    name: "Assamese" },
  { code: "fr",    name: "French" },
  { code: "de",    name: "German" },
  { code: "es",    name: "Spanish" },
  { code: "pt",    name: "Portuguese" },
  { code: "ar",    name: "Arabic" },
  { code: "zh",    name: "Chinese (Simplified)" },
  { code: "ja",    name: "Japanese" },
  { code: "ko",    name: "Korean" },
  { code: "ru",    name: "Russian" },
  { code: "it",    name: "Italian" },
  { code: "nl",    name: "Dutch" },
];

// ─── Validation ───────────────────────────────────────────────────────────────

function normalizeTexts(texts) {
  if (!Array.isArray(texts)) {
    throw new AppError("texts must be an array", 400);
  }

  const normalized = texts.map((text) => String(text ?? ""));

  if (!normalized.length) {
    throw new AppError("texts array cannot be empty", 400);
  }

  if (normalized.length > 100) {
    throw new AppError("Too many texts in one translation request", 400);
  }

  const totalChars = normalized.reduce((sum, text) => sum + text.length, 0);
  if (totalChars > 30000) {
    throw new AppError("Translation request is too large", 400);
  }

  return normalized;
}

function isLanguageSupported(languageCode) {
  if (!languageCode || languageCode === "auto") return true;
  return SUPPORTED_LANGUAGES.some((entry) => entry.code === languageCode);
}

// ─── MyMemory API call (translates ONE text segment) ─────────────────────────

async function translateOneText(text, source, target) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // MyMemory uses "en|hi" format for language pairs
  const langPair = `${source === "auto" ? "en" : source}|${target}`;

  const url = new URL(`${MYMEMORY_BASE_URL}/get`);
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", langPair);

  const email = getMyMemoryEmail();
  if (email) {
    url.searchParams.set("de", email);
  }

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
      },
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
      throw new AppError("MyMemory translation request failed", 502);
    }

    // MyMemory returns responseStatus 200 on success
    if (data.responseStatus !== 200) {
      // 429 = quota exceeded, 403 = language pair unavailable
      if (data.responseStatus === 429) {
        throw new AppError(
          "Translation daily limit reached. Set MYMEMORY_EMAIL in .env to double your quota.",
          429
        );
      }
      throw new AppError(
        data.responseDetails || "MyMemory translation failed",
        502
      );
    }

    return data.responseData?.translatedText || text;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new AppError("Translation request timed out", 504);
    }
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      "Could not reach translation service. Check your internet connection.",
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the list of supported languages.
 * Compatible with the old LibreTranslate format so routes don't change.
 */
async function getSupportedLanguages() {
  return SUPPORTED_LANGUAGES.map((lang) => ({
    code: lang.code,
    name: lang.name,
    targets: SUPPORTED_LANGUAGES
      .filter((l) => l.code !== lang.code)
      .map((l) => l.code),
  }));
}

/**
 * Translates an array of texts to the target language.
 * Compatible with the old LibreTranslate-based translateBatch signature.
 */
async function translateBatch({ texts, source = "auto", target, format = "text" }) {
  const normalizedTexts = normalizeTexts(texts);
  const normalizedSource = String(source || "auto");
  const normalizedTarget = String(target || "").trim();

  if (!normalizedTarget) {
    throw new AppError("target language is required", 400);
  }

  // No translation needed if source == target
  if (normalizedTarget === normalizedSource) {
    return {
      provider: "mymemory",
      source: normalizedSource,
      target: normalizedTarget,
      translatedTexts: normalizedTexts,
      skipped: true,
    };
  }

  // Check if target language is supported
  if (!isLanguageSupported(normalizedTarget)) {
    return {
      provider: "mymemory",
      source: normalizedSource,
      target: normalizedTarget,
      translatedTexts: normalizedTexts,
      unsupportedTarget: true,
    };
  }

  // Translate each text individually (MyMemory doesn't support batch in free tier)
  // We do them in parallel but with a small concurrency limit to avoid rate limiting
  const CONCURRENCY = 3;
  const results = new Array(normalizedTexts.length).fill("");

  for (let i = 0; i < normalizedTexts.length; i += CONCURRENCY) {
    const chunk = normalizedTexts.slice(i, i + CONCURRENCY);
    const translated = await Promise.all(
      chunk.map((text) => {
        // Skip obviously blank or non-translatable text
        if (!text.trim()) return Promise.resolve(text);
        return translateOneText(text, normalizedSource, normalizedTarget).catch(() => text);
      })
    );
    translated.forEach((t, j) => {
      results[i + j] = t;
    });
  }

  return {
    provider: "mymemory",
    source: normalizedSource,
    target: normalizedTarget,
    translatedTexts: results,
  };
}

module.exports = {
  getSupportedLanguages,
  translateBatch,
};
