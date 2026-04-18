const AppError = require("../utils/appError");

const SUPPORTED_LANGUAGE_CACHE_TTL_MS = 5 * 60 * 1000;

let supportedLanguagesCache = null;
let supportedLanguagesFetchedAt = 0;

function getLibreTranslateBaseUrl() {
  return String(process.env.LIBRETRANSLATE_URL || "http://127.0.0.1:5001").replace(
    /\/+$/,
    ""
  );
}

function getLibreTranslateApiKey() {
  return String(process.env.LIBRETRANSLATE_API_KEY || "").trim();
}

function getLibreTranslateTimeoutMs() {
  const timeout = Number(process.env.LIBRETRANSLATE_TIMEOUT_MS || 20000);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 20000;
}

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

async function fetchLibreTranslateJson(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getLibreTranslateTimeoutMs());

  try {
    const response = await fetch(getLibreTranslateBaseUrl() + path, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();

    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text || "Invalid LibreTranslate response" };
    }

    if (!response.ok) {
      throw new AppError(
        data.error || "LibreTranslate request failed",
        response.status >= 400 && response.status < 500 ? response.status : 502
      );
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new AppError("LibreTranslate request timed out", 504);
    }
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      "Could not reach LibreTranslate. Check LIBRETRANSLATE_URL on the server.",
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function getSupportedLanguages(forceRefresh = false) {
  const now = Date.now();
  if (
    !forceRefresh &&
    supportedLanguagesCache &&
    now - supportedLanguagesFetchedAt < SUPPORTED_LANGUAGE_CACHE_TTL_MS
  ) {
    return supportedLanguagesCache;
  }

  const data = await fetchLibreTranslateJson("/languages");
  const languages = Array.isArray(data)
    ? data
        .filter((entry) => entry && entry.code)
        .map((entry) => ({
          code: String(entry.code),
          name: String(entry.name || entry.code),
          targets: Array.isArray(entry.targets)
            ? entry.targets.map((target) => String(target))
            : [],
        }))
    : [];

  supportedLanguagesCache = languages;
  supportedLanguagesFetchedAt = now;
  return languages;
}

function isLanguageSupported(languages, languageCode) {
  if (!languageCode || languageCode === "auto") return true;
  return languages.some((entry) => entry.code === languageCode);
}

async function translateBatch({ texts, source = "auto", target, format = "text" }) {
  const normalizedTexts = normalizeTexts(texts);
  const normalizedSource = String(source || "auto");
  const normalizedTarget = String(target || "").trim();
  const normalizedFormat = format === "html" ? "html" : "text";

  if (!normalizedTarget) {
    throw new AppError("target language is required", 400);
  }

  if (normalizedTarget === normalizedSource) {
    return {
      provider: "libretranslate",
      source: normalizedSource,
      target: normalizedTarget,
      translatedTexts: normalizedTexts,
      skipped: true,
    };
  }

  const supportedLanguages = await getSupportedLanguages();
  const unsupportedTarget = !isLanguageSupported(
    supportedLanguages,
    normalizedTarget
  );
  const unsupportedSource = !isLanguageSupported(
    supportedLanguages,
    normalizedSource
  );

  if (unsupportedTarget || unsupportedSource) {
    return {
      provider: "libretranslate",
      source: normalizedSource,
      target: normalizedTarget,
      translatedTexts: normalizedTexts,
      unsupportedTarget,
      unsupportedSource,
    };
  }

  const payload = {
    q: normalizedTexts,
    source: normalizedSource,
    target: normalizedTarget,
    format: normalizedFormat,
  };

  const apiKey = getLibreTranslateApiKey();
  if (apiKey) {
    payload.api_key = apiKey;
  }

  const data = await fetchLibreTranslateJson("/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const translated = Array.isArray(data.translatedText)
    ? data.translatedText
    : [data.translatedText];

  return {
    provider: "libretranslate",
    source: normalizedSource,
    target: normalizedTarget,
    translatedTexts: normalizedTexts.map((text, index) =>
      typeof translated[index] === "string" ? translated[index] : text
    ),
    detectedLanguage: data.detectedLanguage || null,
  };
}

module.exports = {
  getSupportedLanguages,
  translateBatch,
};
