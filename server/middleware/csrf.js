const AppError = require("../utils/appError");
const {
  AUTH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  ensureCsrfCookie,
  parseCookies,
} = require("../utils/cookies");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function csrfCookieBootstrap(req, res, next) {
  ensureCsrfCookie(req, res);
  next();
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(String(req.method || "GET").toUpperCase())) {
    return next();
  }

  const hasBearerAuth = /^Bearer\s+/i.test(String(req.headers.authorization || ""));
  if (hasBearerAuth) {
    return next();
  }

  const cookies = parseCookies(req.headers.cookie || "");
  if (!cookies[AUTH_COOKIE_NAME]) {
    return next();
  }

  const csrfCookie = cookies[CSRF_COOKIE_NAME] || "";
  const csrfHeader =
    req.get("x-csrf-token") || req.get("x-ts-csrf") || req.body?._csrf || "";

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return next(
      new AppError("Security validation failed. Please refresh and try again.", 403)
    );
  }

  return next();
}

module.exports = {
  csrfCookieBootstrap,
  csrfProtection,
};
