function normalizeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function isLocalUrl(value) {
  const url = value instanceof URL ? value : normalizeUrl(value);
  if (!url) return false;
  return ["localhost", "127.0.0.1"].includes(url.hostname);
}

function getRequestBaseUrl(req) {
  const protocol =
    req.headers["x-forwarded-proto"] ||
    req.protocol ||
    "http";

  return `${protocol}://${req.get("host")}`;
}

function getPublicServerUrl(req) {
  const requestBase = normalizeUrl(getRequestBaseUrl(req));
  const explicit =
    process.env.SERVER_URL ||
    process.env.BACKEND_URL ||
    process.env.RENDER_EXTERNAL_URL;

  const explicitUrl = normalizeUrl(explicit);
  const shouldPreferRequestBase =
    requestBase &&
    !isLocalUrl(requestBase) &&
    (!explicitUrl || isLocalUrl(explicitUrl));

  const parsed = shouldPreferRequestBase
    ? requestBase
    : explicitUrl || requestBase;

  return parsed ? parsed.toString().replace(/\/$/, "") : getRequestBaseUrl(req);
}

function getFallbackClientUrl(req) {
  const requestOrigin = normalizeUrl(req.get("origin") || req.get("referer"));
  const requestBase = normalizeUrl(getRequestBaseUrl(req));
  const explicit = normalizeUrl(process.env.FRONTEND_URL || process.env.CLIENT_URL);

  const preferPublicRequestOrigin = requestOrigin && !isLocalUrl(requestOrigin);
  const preferPublicExplicit = explicit && !isLocalUrl(explicit);
  const preferLocalRequestBase = requestBase && isLocalUrl(requestBase);

  const parsed =
    (preferPublicRequestOrigin && requestOrigin) ||
    (preferPublicExplicit && explicit) ||
    (preferLocalRequestBase && requestBase) ||
    explicit ||
    requestOrigin ||
    requestBase;

  return parsed ? parsed.toString() : getRequestBaseUrl(req);
}

function isTrustedClientUrl(req, candidate) {
  const target = normalizeUrl(candidate);
  if (!target || !["http:", "https:"].includes(target.protocol)) {
    return false;
  }

  const allowed = [
    req.get("origin"),
    req.get("referer"),
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:3000",
  ]
    .map((entry) => normalizeUrl(entry))
    .filter(Boolean);

  return allowed.some((entry) => entry.origin === target.origin);
}

function resolveClientUrl(req, candidate) {
  if (candidate && isTrustedClientUrl(req, candidate)) {
    return normalizeUrl(candidate).toString();
  }

  return getFallbackClientUrl(req);
}

function buildFrontendFileUrl(baseUrl, fileName) {
  const base = normalizeUrl(baseUrl);
  if (!base) return null;
  return new URL(fileName, base).toString();
}

function buildRedirectWithHash(baseUrl, hashParams = {}) {
  const target = normalizeUrl(baseUrl);
  if (!target) return null;

  const hash = new URLSearchParams();
  Object.entries(hashParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      hash.set(key, String(value));
    }
  });

  target.hash = hash.toString();
  return target.toString();
}

function buildRedirectWithQuery(baseUrl, queryParams = {}) {
  const target = normalizeUrl(baseUrl);
  if (!target) return null;

  Object.entries(queryParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      target.searchParams.set(key, String(value));
    }
  });

  return target.toString();
}

module.exports = {
  normalizeUrl,
  isLocalUrl,
  getPublicServerUrl,
  resolveClientUrl,
  buildFrontendFileUrl,
  buildRedirectWithHash,
  buildRedirectWithQuery,
  getFallbackClientUrl,
};
