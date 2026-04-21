const mongoose = require("mongoose");
const AppError = require("./appError");

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  const normalized = String(value ?? "").replace(/\0/g, "").trim();

  if (required && !normalized) {
    throw new AppError(`${field} is required`, 400);
  }
  if (normalized.length > max) {
    throw new AppError(`${field} is too long`, 400, { max });
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
  cleanHttpUrl,
  cleanMediaUrl,
  cleanString,
  cleanStringArray,
  getPagination,
  validateObjectIdParam,
};
