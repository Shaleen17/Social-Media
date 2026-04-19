/**
 * translationService.js
 *
 * Dual-provider translation system for Tirth Sutra.
 *
 * Provider 1 (PRIMARY):   Self-hosted LibreTranslate
 *   → Used when LIBRETRANSLATE_URL is set to a real public HTTPS domain.
 *   → Free, unlimited, private — runs on your own VPS.
 *   → Setup guide: see libretranslate_self_hosting_guide.md
 *
 * Provider 2 (FALLBACK):  MyMemory
 *   → Used automatically if LibreTranslate is not configured or fails.
 *   → Free, no installation, no API key, works on Render/Vercel as-is.
 *   → Limit: 5,000 words/day (10,000 with MYMEMORY_EMAIL set in .env)
 *
 * Environment variables (server/.env):
 *   LIBRETRANSLATE_URL=https://translate.yourdomain.com   ← your VPS domain
 *   LIBRETRANSLATE_API_KEY=                               ← leave empty for self-hosted
 *   MYMEMORY_EMAIL=tirthsutra@gmail.com                   ← optional, boosts fallback limit
 */

"use strict";

const AppError = require("../utils/appError");

// ─── Configuration helpers ────────────────────────────────────────────────────

const TIMEOUT_MS = 20000;
const TRANSLATION_CACHE_LIMIT = 12000;
const translationMemory = new Map();

function buildCacheKey(source, target, text) {
  return `${source || "auto"}::${target || "en"}::${text}`;
}

function getCachedTranslation(source, target, text) {
  return translationMemory.get(buildCacheKey(source, target, text));
}

function setCachedTranslation(source, target, text, translatedText) {
  const key = buildCacheKey(source, target, text);
  if (translationMemory.has(key)) {
    translationMemory.delete(key);
  }
  translationMemory.set(key, translatedText);
  if (translationMemory.size > TRANSLATION_CACHE_LIMIT) {
    const oldestKey = translationMemory.keys().next().value;
    if (oldestKey) translationMemory.delete(oldestKey);
  }
}

function isLikelyUntranslatedResult(source, translated, target) {
  const original = String(source || "").trim();
  const next = String(translated || "").trim();
  if (!original || !next) return true;
  if (!target || target === "en") return false;
  if (original !== next) return false;
  return /\p{L}/u.test(original);
}

const SCRIPT_LANGUAGE_DETECTORS = [
  { code: "bn", pattern: /[\u0980-\u09FF]/u },
  { code: "ta", pattern: /[\u0B80-\u0BFF]/u },
  { code: "te", pattern: /[\u0C00-\u0C7F]/u },
  { code: "gu", pattern: /[\u0A80-\u0AFF]/u },
  { code: "kn", pattern: /[\u0C80-\u0CFF]/u },
  { code: "ml", pattern: /[\u0D00-\u0D7F]/u },
  { code: "pa", pattern: /[\u0A00-\u0A7F]/u },
  { code: "or", pattern: /[\u0B00-\u0B7F]/u },
  { code: "hi", pattern: /[\u0900-\u097F]/u },
  { code: "ur", pattern: /[\u0600-\u06FF]/u },
];

function detectLikelySourceLanguage(text) {
  const value = String(text || "").trim();
  if (!value) return "en";

  for (const detector of SCRIPT_LANGUAGE_DETECTORS) {
    if (detector.pattern.test(value)) {
      return detector.code;
    }
  }

  if (/[A-Za-z]/.test(value)) {
    return "en";
  }

  return "en";
}

function resolveSourceLanguage(text, source) {
  const normalizedSource = String(source || "auto").trim();
  if (normalizedSource && normalizedSource !== "auto") {
    return normalizedSource;
  }
  return detectLikelySourceLanguage(text);
}

function groupTextsBySource(texts, source) {
  const groups = new Map();
  texts.forEach((text) => {
    const resolvedSource = resolveSourceLanguage(text, source);
    if (!groups.has(resolvedSource)) {
      groups.set(resolvedSource, []);
    }
    groups.get(resolvedSource).push(text);
  });
  return Array.from(groups.entries()).map(([resolvedSource, groupTexts]) => ({
    source: resolvedSource,
    texts: groupTexts,
  }));
}

function getLibreTranslateUrl() {
  return (process.env.LIBRETRANSLATE_URL || "").trim().replace(/\/+$/, "");
}

function getLibreTranslateApiKey() {
  return (process.env.LIBRETRANSLATE_API_KEY || "").trim();
}

function getMyMemoryEmail() {
  return (process.env.MYMEMORY_EMAIL || "").trim();
}

/**
 * Returns true only when LibreTranslate URL is set AND is a real public domain
 * (not localhost/127.0.0.1) — prevents production config mistakes.
 */
function isLibreTranslateConfigured() {
  const url = getLibreTranslateUrl();
  if (!url) return false;
  if (url.includes("127.0.0.1") || url.includes("localhost")) {
    console.warn(
      "[Translation] LIBRETRANSLATE_URL is set to localhost — this will NOT work in production.\n" +
      "             Set it to your public VPS domain, e.g. https://translate.yourdomain.com"
    );
    return false;
  }
  return true;
}

// ─── Supported languages (static list, no network call needed) ───────────────

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "pa", name: "Punjabi" },
  { code: "ur", name: "Urdu" },
  { code: "sa", name: "Sanskrit" },
  { code: "or", name: "Odia" },
  { code: "as", name: "Assamese" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "es", name: "Spanish" },
  { code: "pt", name: "Portuguese" },
  { code: "ar", name: "Arabic" },
  { code: "zh", name: "Chinese (Simplified)" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "ru", name: "Russian" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
];

// ─── Validation ───────────────────────────────────────────────────────────────

function normalizeTexts(texts) {
  if (!Array.isArray(texts)) {
    throw new AppError("texts must be an array", 400);
  }
  const normalized = texts.map((t) => String(t ?? ""));
  if (!normalized.length) {
    throw new AppError("texts array cannot be empty", 400);
  }
  if (normalized.length > 100) {
    throw new AppError("Too many texts in one translation request", 400);
  }
  const totalChars = normalized.reduce((s, t) => s + t.length, 0);
  if (totalChars > 30000) {
    throw new AppError("Translation request is too large", 400);
  }
  return normalized;
}

function isLanguageSupported(code) {
  if (!code || code === "auto") return true;
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

// ─── Provider 1: Self-hosted LibreTranslate ───────────────────────────────────

async function translateWithLibreTranslate(texts, source, target) {
  const baseUrl = getLibreTranslateUrl();
  const apiKey = getLibreTranslateApiKey();

  const payload = {
    q: texts,
    source: source === "auto" ? "en" : source,
    target,
    format: "text",
  };
  if (apiKey) {
    payload.api_key = apiKey;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
      throw new AppError(data?.error || "LibreTranslate request failed", 502);
    }

    // LibreTranslate returns translatedText as array when q is array
    const translated = Array.isArray(data.translatedText)
      ? data.translatedText
      : [data.translatedText];

    return {
      provider: "libretranslate",
      source,
      target,
      translatedTexts: texts.map((t, i) =>
        typeof translated[i] === "string" ? translated[i] : t
      ),
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new AppError("LibreTranslate timed out", 504);
    }
    if (err instanceof AppError) throw err;
    throw new AppError("Could not reach LibreTranslate at " + baseUrl, 502);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Provider 2: MyMemory (fallback) ─────────────────────────────────────────

async function translateOneWithMyMemory(text, source, target) {
  const langPair = `${source === "auto" ? "en" : source}|${target}`;
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", langPair);

  const email = getMyMemoryEmail();
  if (email) url.searchParams.set("de", email);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => null);
    if (!data || data.responseStatus !== 200) return text;
    return data.responseData?.translatedText || text;
  } catch {
    return text; // Return original on any failure
  } finally {
    clearTimeout(timer);
  }
}

async function translateWithMyMemory(texts, source, target) {
  const CONCURRENCY = 3; // MyMemory rate limit protection
  const results = new Array(texts.length).fill("");

  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const chunk = texts.slice(i, i + CONCURRENCY);
    const translated = await Promise.all(
      chunk.map((t) =>
        t.trim()
          ? translateOneWithMyMemory(t, source, target).catch(() => t)
          : Promise.resolve(t)
      )
    );
    translated.forEach((t, j) => {
      results[i + j] = t;
    });
  }

  return {
    provider: "mymemory",
    source,
    target,
    translatedTexts: results,
  };
}

// ─── Public API (used by routes/translation.js) ───────────────────────────────

/**
 * Returns supported language list.
 * If LibreTranslate is live, fetches from it (live language list).
 * Otherwise returns the static built-in list.
 */
async function getSupportedLanguages() {
  if (isLibreTranslateConfigured()) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${getLibreTranslateUrl()}/languages`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      const langs = await res.json();
      if (Array.isArray(langs) && langs.length > 0) return langs;
    } catch {
      // Fall through to static list
    }
  }

  // Return static list (compatible with LibreTranslate format)
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
 * Uses LibreTranslate if configured, falls back to MyMemory.
 */
async function translateBatch({ texts, source = "auto", target, format = "text" }) {
  const normalizedTexts = normalizeTexts(texts);
  const normalizedSource = String(source || "auto");
  const normalizedTarget = String(target || "").trim();

  if (!normalizedTarget) {
    throw new AppError("target language is required", 400);
  }

  // Skip translation when source == target
  if (normalizedTarget === normalizedSource) {
    return {
      provider: "none",
      source: normalizedSource,
      target: normalizedTarget,
      translatedTexts: normalizedTexts,
      skipped: true,
    };
  }

  // Language not in our supported list
  if (!isLanguageSupported(normalizedTarget)) {
    return {
      provider: "none",
      source: normalizedSource,
      target: normalizedTarget,
      translatedTexts: normalizedTexts,
      unsupportedTarget: true,
    };
  }

  // ── Try LibreTranslate first ─────────────────────────────────────────────
  if (isLibreTranslateConfigured()) {
    try {
      const result = await translateWithLibreTranslate(
        normalizedTexts,
        normalizedSource,
        normalizedTarget
      );
      return result;
    } catch (err) {
      // Log the failure and fall through to MyMemory
      console.warn(
        "[Translation] LibreTranslate failed — falling back to MyMemory.",
        err.message
      );
    }
  }

  // ── Fall back to MyMemory ────────────────────────────────────────────────
  return translateWithMyMemory(normalizedTexts, normalizedSource, normalizedTarget);
}

async function translateBatchCached(options) {
  const normalizedTexts = normalizeTexts(options?.texts);
  const normalizedSource = String(options?.source || "auto");
  const normalizedTarget = String(options?.target || "").trim();

  if (!normalizedTarget) {
    throw new AppError("target language is required", 400);
  }

  if (normalizedTarget === normalizedSource) {
    return {
      provider: "none",
      source: normalizedSource,
      target: normalizedTarget,
      translatedTexts: normalizedTexts,
      skipped: true,
    };
  }

  if (!isLanguageSupported(normalizedTarget)) {
    return {
      provider: "none",
      source: normalizedSource,
      target: normalizedTarget,
      translatedTexts: normalizedTexts,
      unsupportedTarget: true,
    };
  }

  const translatedTexts = new Array(normalizedTexts.length);
  const missingIndexesByText = new Map();
  normalizedTexts.forEach((text, index) => {
    const resolvedSource = resolveSourceLanguage(text, normalizedSource);
    const cached = getCachedTranslation(resolvedSource, normalizedTarget, text);
    if (typeof cached === "string") {
      translatedTexts[index] = cached;
      return;
    }

    if (!missingIndexesByText.has(text)) {
      missingIndexesByText.set(text, []);
    }
    missingIndexesByText.get(text).push(index);
  });

  const missingTexts = Array.from(missingIndexesByText.keys());
  if (!missingTexts.length) {
    return {
      provider: "cache",
      source: normalizedSource,
      target: normalizedTarget,
      translatedTexts,
      cacheHits: normalizedTexts.length,
    };
  }

  const providersUsed = new Set();

  const mergeTranslatedResults = (providerName, sourceLanguage, sourceTexts, result) => {
    const providerTexts = Array.isArray(result?.translatedTexts)
      ? result.translatedTexts
      : [];

    providersUsed.add(providerName);

    sourceTexts.forEach((text, index) => {
      const translated =
        typeof providerTexts[index] === "string" && providerTexts[index].trim()
          ? providerTexts[index]
          : text;
      if (!isLikelyUntranslatedResult(text, translated, normalizedTarget)) {
        setCachedTranslation(sourceLanguage, normalizedTarget, text, translated);
      }
      const indexes = missingIndexesByText.get(text) || [];
      indexes.forEach((targetIndex) => {
        translatedTexts[targetIndex] = translated;
      });
    });
  };

  const missingGroups = groupTextsBySource(missingTexts, normalizedSource);

  for (const group of missingGroups) {
    if (group.source === normalizedTarget) {
      providersUsed.add("identity");
      group.texts.forEach((text) => {
        setCachedTranslation(group.source, normalizedTarget, text, text);
        const indexes = missingIndexesByText.get(text) || [];
        indexes.forEach((targetIndex) => {
          translatedTexts[targetIndex] = text;
        });
      });
      continue;
    }

    if (isLibreTranslateConfigured()) {
      try {
        const result = await translateWithLibreTranslate(
          group.texts,
          group.source,
          normalizedTarget
        );
        mergeTranslatedResults("libretranslate", group.source, group.texts, result);
        continue;
      } catch (err) {
        console.warn(
          "[Translation] LibreTranslate failed - falling back to MyMemory.",
          err.message
        );
      }
    }

    const fallbackResult = await translateWithMyMemory(
      group.texts,
      group.source,
      normalizedTarget
    );
    mergeTranslatedResults("mymemory", group.source, group.texts, fallbackResult);
  }

  return {
    provider:
      providersUsed.size === 1
        ? Array.from(providersUsed)[0]
        : "mixed",
    source: normalizedSource,
    target: normalizedTarget,
    translatedTexts: translatedTexts.map((text, index) =>
      typeof text === "string" ? text : normalizedTexts[index]
    ),
    cacheHits: normalizedTexts.length - missingTexts.length,
  };
}

module.exports = {
  getSupportedLanguages,
  translateBatch: translateBatchCached,
};
