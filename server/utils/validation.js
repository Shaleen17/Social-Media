const mongoose = require("mongoose");
const AppError = require("./appError");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stripHtmlTags(value = "") {
  return String(value || "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ");
}

function normalizeWhitespace(value = "", options = {}) {
  const preserveNewlines = !!options.preserveNewlines;
  const normalized = String(value || "").replace(/\0/g, "");
  if (!preserveNewlines) {
    return normalized.replace(/\s+/g, " ").trim();
  }

  return normalized
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizePlainText(value = "", options = {}) {
  const allowHtml = !!options.allowHtml;
  const raw = allowHtml ? String(value || "") : stripHtmlTags(value);
  return normalizeWhitespace(raw, options);
}

function getPagination(query = {}, options = {}) {
  const defaultLimit = options.defaultLimit || 20;
  const maxLimit = options.maxLimit || 50;
  const page = Math.max(1, toPositiveInt(query.page, 1));
  const requestedLimit = toPositiveInt(query.limit, defaultLimit);
  const limit = Math.min(Math.max(1, requestedLimit), maxLimit);
  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

function cleanString(value = "", options = {}) {
  const field = options.field || "Value";
  const max = options.max || 5000;
  const required = !!options.required;
  const normalized = sanitizePlainText(value, options);

  if (required && !normalized) {
    throw new AppError(`${field} is required`, 400);
  }
  if (normalized.length > max) {
    throw new AppError(`${field} is too long`, 400, { max });
  }
  return normalized;
}

function cleanEmail(value = "", options = {}) {
  const field = options.field || "Email";
  const raw = cleanString(value, {
    field,
    max: options.max || 180,
    required: !!options.required,
  }).toLowerCase();

  if (!raw) return "";
  if (!EMAIL_RE.test(raw)) {
    throw new AppError(`${field} must be a valid email address`, 400);
  }
  return raw;
}

function cleanHandle(value = "", options = {}) {
  const field = options.field || "Handle";
  const normalized = cleanString(value, {
    field,
    max: options.max || 40,
    required: !!options.required,
  })
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9_]/g, "");

  if (options.required && !normalized) {
    throw new AppError(`${field} is required`, 400);
  }
  if (normalized && normalized.length < (options.min || 3)) {
    throw new AppError(`${field} is too short`, 400, {
      min: options.min || 3,
    });
  }
  return normalized;
}

function cleanEnum(value, allowedValues, fallback) {
  const normalized = String(value || "").trim();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

function assertObjectId(value, field = "id") {
  if (!mongoose.Types.ObjectId.isValid(String(value || ""))) {
    throw new AppError(`Invalid ${field}`, 400);
  }
  return value;
}

function validateObjectIdParam(paramName) {
  return (req, res, next) => {
    try {
      assertObjectId(req.params[paramName], paramName);
      next();
    } catch (error) {
      next(error);
    }
  };
}

function cleanHttpUrl(value = "", options = {}) {
  const field = options.field || "URL";
  const required = !!options.required;
  const max = options.max || 2048;
  const raw = cleanString(value, { field, max, required });
  if (!raw) return "";

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new AppError(`${field} must be a valid URL`, 400);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new AppError(`${field} must start with http:// or https://`, 400);
  }
  return parsed.href;
}

function cleanMediaUrl(value = "", options = {}) {
  const field = options.field || "Media URL";
  const allowData = options.allowData !== false;
  const max = options.max || 500000;
  const raw = cleanString(value, { field, max, required: !!options.required });
  if (!raw) return "";

  if (allowData && /^data:(image|video|audio)\//i.test(raw)) {
    return raw;
  }

  if (/^(blob:|filesystem:)/i.test(raw)) {
    throw new AppError(`${field} must be uploaded before saving`, 400);
  }

  return cleanHttpUrl(raw, { field, max: Math.min(max, 4096), required: true });
}

function cleanStringArray(values, options = {}) {
  if (!Array.isArray(values)) return [];
  const maxItems = options.maxItems || 20;
  const maxLength = options.maxLength || 120;
  return Array.from(
    new Set(
      values
        .slice(0, maxItems)
        .map((value) => cleanString(value, { max: maxLength }))
        .filter(Boolean)
    )
  );
}

module.exports = {
  assertObjectId,
  cleanEnum,
  cleanEmail,
  cleanHandle,
  cleanHttpUrl,
  cleanMediaUrl,
  cleanString,
  cleanStringArray,
  getPagination,
  sanitizePlainText,
  stripHtmlTags,
  validateObjectIdParam,
};
