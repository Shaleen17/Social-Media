const AnalyticsEvent = require("../models/AnalyticsEvent");
const { cleanString } = require("../utils/validation");

const ALLOWED_ANALYTICS_TYPES = new Set([
  "page_view",
  "interaction",
  "error",
  "performance",
  "consent",
]);

function detectDeviceType(userAgent = "") {
  const ua = String(userAgent || "").toLowerCase();
  if (/ipad|tablet|playbook|silk/i.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android/i.test(ua)) return "mobile";
  return "desktop";
}

function detectBrowser(userAgent = "") {
  const ua = String(userAgent || "");
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\//i.test(ua) || /opera/i.test(ua)) return "Opera";
  if (/chrome\//i.test(ua) && !/edg\//i.test(ua) && !/opr\//i.test(ua)) return "Chrome";
  if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) return "Safari";
  if (/firefox\//i.test(ua)) return "Firefox";
  if (/msie|trident/i.test(ua)) return "Internet Explorer";
  return "Unknown";
}

function detectOperatingSystem(userAgent = "") {
  const ua = String(userAgent || "");
  if (/windows/i.test(ua)) return "Windows";
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/mac os x/i.test(ua)) return "macOS";
  if (/linux/i.test(ua)) return "Linux";
  return "Unknown";
}

function sanitizeAnalyticsMeta(value, depth = 0) {
  if (depth > 4) return undefined;
  if (value == null) return value;

  if (typeof value === "string") {
    return cleanString(value, {
      field: "Analytics meta",
      max: 500,
      preserveNewlines: false,
    });
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 24).map((item) => sanitizeAnalyticsMeta(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .slice(0, 32)
      .reduce((acc, [key, entry]) => {
        const safeKey = cleanString(key, { field: "Analytics meta key", max: 80 });
        if (!safeKey) return acc;
        acc[safeKey] = sanitizeAnalyticsMeta(entry, depth + 1);
        return acc;
      }, {});
  }

  return undefined;
}

function buildRequestContext(req, meta = {}, user = null) {
  const userAgent = String(req?.get?.("user-agent") || "").trim();
  const baseContext =
    meta && typeof meta.context === "object" && meta.context ? meta.context : {};

  const country =
    cleanString(
      req?.get?.("x-vercel-ip-country") ||
        req?.get?.("cf-ipcountry") ||
        baseContext.country ||
        "",
      { field: "Country", max: 40 }
    ) || "Unknown";

  const region =
    cleanString(
      req?.get?.("x-vercel-ip-country-region") ||
        req?.get?.("cf-region-code") ||
        baseContext.region ||
        "",
      { field: "Region", max: 40 }
    ) || "";

  const locale =
    cleanString(
      baseContext.locale ||
        String(req?.get?.("accept-language") || "").split(",")[0] ||
        "",
      { field: "Locale", max: 40 }
    ) || "";

  const timezone =
    cleanString(baseContext.timezone || meta.timezone || "", {
      field: "Timezone",
      max: 80,
    }) || "";

  return {
    ...baseContext,
    deviceType:
      cleanString(baseContext.deviceType || "", { field: "Device type", max: 24 }) ||
      detectDeviceType(userAgent),
    browser:
      cleanString(baseContext.browser || "", { field: "Browser", max: 40 }) ||
      detectBrowser(userAgent),
    os:
      cleanString(baseContext.os || "", { field: "Operating system", max: 40 }) ||
      detectOperatingSystem(userAgent),
    country,
    region,
    locale,
    timezone,
    referrer:
      cleanString(baseContext.referrer || req?.get?.("referer") || "", {
        field: "Referrer",
        max: 240,
      }) || "",
    userAgent: cleanString(userAgent, { field: "User agent", max: 220 }) || "",
    authenticated: !!(user?._id || user),
  };
}

async function recordAnalyticsEvent({
  req = null,
  type,
  name,
  page = "",
  path = "",
  sessionId = "",
  anonymousId = "",
  user = null,
  meta = {},
}) {
  const safeType = cleanString(type, {
    field: "Analytics event type",
    max: 40,
    required: true,
  });
  const safeName = cleanString(name, {
    field: "Analytics event name",
    max: 120,
    required: true,
  });

  if (!ALLOWED_ANALYTICS_TYPES.has(safeType)) {
    throw new Error("Unsupported analytics event type");
  }

  const safeMeta = sanitizeAnalyticsMeta(meta || {}) || {};
  const safeContext = buildRequestContext(req, safeMeta, user);

  return AnalyticsEvent.create({
    type: safeType,
    name: safeName,
    page: cleanString(page, { field: "Analytics page", max: 80 }),
    path: cleanString(path, { field: "Analytics path", max: 180 }),
    sessionId: cleanString(sessionId, {
      field: "Analytics session id",
      max: 120,
    }),
    anonymousId: cleanString(anonymousId, {
      field: "Analytics anonymous id",
      max: 120,
    }),
    user: user?._id || user || null,
    meta: {
      ...safeMeta,
      context: safeContext,
    },
  });
}

async function recordAnalyticsEventSafe(payload) {
  try {
    return await recordAnalyticsEvent(payload);
  } catch {
    return null;
  }
}

module.exports = {
  ALLOWED_ANALYTICS_TYPES,
  buildRequestContext,
  detectBrowser,
  detectDeviceType,
  detectOperatingSystem,
  recordAnalyticsEvent,
  recordAnalyticsEventSafe,
  sanitizeAnalyticsMeta,
};
