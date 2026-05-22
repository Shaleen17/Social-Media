function normalizePolicyOrigin(value = "") {
  const normalized = String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  return normalized ? `https://${normalized}` : "";
}

function getFrameSources() {
  const sources = [
    "'self'",
    "https://www.youtube.com",
    "https://www.youtube-nocookie.com",
    "https://accounts.google.com",
    "https://www.google.com",
  ];
  const dailyOrigin = normalizePolicyOrigin(process.env.DAILY_DOMAIN || "");
  if (dailyOrigin) sources.push(dailyOrigin);
  return sources;
}

function getPermissionsPolicy() {
  const dailyOrigin = normalizePolicyOrigin(process.env.DAILY_DOMAIN || "");
  const mediaAllowList = dailyOrigin ? `self "${dailyOrigin}"` : "self";
  return [
    `camera=(${mediaAllowList})`,
    `microphone=(${mediaAllowList})`,
    "geolocation=(self)",
    "payment=(self)",
    "interest-cohort=()",
  ].join(", ");
}

function securityHeaders(req, res, next) {
  const isProduction = process.env.NODE_ENV === "production";

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Permissions-Policy", getPermissionsPolicy());

  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }

  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "connect-src 'self' http: https: ws: wss:",
      `frame-src ${getFrameSources().join(" ")}`,
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; ")
  );

  next();
}

module.exports = securityHeaders;
