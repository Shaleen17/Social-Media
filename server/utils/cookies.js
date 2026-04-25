const crypto = require("crypto");

const AUTH_COOKIE_NAME = "ts_auth";
const CSRF_COOKIE_NAME = "ts_csrf";

function parseCookies(header = "") {
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const separatorIndex = entry.indexOf("=");
      const key =
        separatorIndex >= 0 ? entry.slice(0, separatorIndex).trim() : entry.trim();
      const value =
        separatorIndex >= 0 ? entry.slice(separatorIndex + 1).trim() : "";
      if (key) {
        acc[key] = decodeURIComponent(value || "");
      }
      return acc;
    }, {});
}

function serializeCookie(name, value, options = {}) {
  const pairs = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) {
    pairs.push(`Max-Age=${Math.max(0, Math.floor(Number(options.maxAge) || 0))}`);
  }
  if (options.expires instanceof Date) {
    pairs.push(`Expires=${options.expires.toUTCString()}`);
  }
  pairs.push(`Path=${options.path || "/"}`);
  if (options.httpOnly) pairs.push("HttpOnly");
  if (options.secure) pairs.push("Secure");
  if (options.sameSite) pairs.push(`SameSite=${options.sameSite}`);
  return pairs.join("; ");
}

function shouldUseSecureCookies(req) {
  if (process.env.NODE_ENV === "production") return true;
  const forwardedProto = req?.get?.("x-forwarded-proto");
  if (String(forwardedProto || "").toLowerCase().includes("https")) return true;
  return String(req?.protocol || "").toLowerCase() === "https";
}

function determineSameSite(req) {
  const secure = shouldUseSecureCookies(req);
  const frontendOrigin = String(
    process.env.FRONTEND_URL || process.env.CLIENT_URL || ""
  ).trim();
  const serverOrigin = String(
    process.env.SERVER_URL || process.env.RENDER_EXTERNAL_URL || ""
  ).trim();

  if (!secure) return "Lax";
  if (!frontendOrigin || !serverOrigin) return "Lax";

  try {
    const frontendUrl = new URL(frontendOrigin);
    const serverUrl = new URL(serverOrigin);
    return frontendUrl.origin === serverUrl.origin ? "Lax" : "None";
  } catch {
    return "Lax";
  }
}

function buildAuthCookieOptions(req) {
  const secure = shouldUseSecureCookies(req);
  return {
    httpOnly: true,
    secure,
    sameSite: determineSameSite(req),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

function buildCsrfCookieOptions(req) {
  const secure = shouldUseSecureCookies(req);
  return {
    httpOnly: false,
    secure,
    sameSite: determineSameSite(req),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

function appendSetCookie(res, cookieValue) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", [cookieValue]);
    return;
  }

  const next = Array.isArray(current) ? current.concat(cookieValue) : [current, cookieValue];
  res.setHeader("Set-Cookie", next);
}

function makeCsrfToken() {
  return crypto.randomBytes(24).toString("hex");
}

function ensureCsrfCookie(req, res) {
  const cookies = parseCookies(req?.headers?.cookie || "");
  let token = cookies[CSRF_COOKIE_NAME] || "";

  if (!token) {
    token = makeCsrfToken();
    appendSetCookie(
      res,
      serializeCookie(CSRF_COOKIE_NAME, token, buildCsrfCookieOptions(req))
    );
  }

  res.setHeader("x-csrf-token", token);
  return token;
}

function setAuthCookies(req, res, token) {
  if (!token) return ensureCsrfCookie(req, res);
  appendSetCookie(
    res,
    serializeCookie(AUTH_COOKIE_NAME, token, buildAuthCookieOptions(req))
  );
  return ensureCsrfCookie(req, res);
}

function clearAuthCookies(req, res) {
  const clearOptions = {
    path: "/",
    secure: shouldUseSecureCookies(req),
    sameSite: determineSameSite(req),
    expires: new Date(0),
    maxAge: 0,
  };
  appendSetCookie(res, serializeCookie(AUTH_COOKIE_NAME, "", { ...clearOptions, httpOnly: true }));
  appendSetCookie(res, serializeCookie(CSRF_COOKIE_NAME, "", { ...clearOptions, httpOnly: false }));
}

module.exports = {
  AUTH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  buildAuthCookieOptions,
  clearAuthCookies,
  ensureCsrfCookie,
  parseCookies,
  setAuthCookies,
};
