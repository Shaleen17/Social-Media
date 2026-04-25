const User = require("../models/User");
const { parseCookies, AUTH_COOKIE_NAME } = require("../utils/cookies");
const { verifyAuthToken } = require("../utils/authTokens");

function extractToken(req) {
  const header = String(req?.headers?.authorization || "");
  if (header.startsWith("Bearer ")) {
    return {
      token: header.split(" ")[1],
      source: "bearer",
    };
  }

  const cookies = parseCookies(req?.headers?.cookie || "");
  if (cookies[AUTH_COOKIE_NAME]) {
    return {
      token: cookies[AUTH_COOKIE_NAME],
      source: "cookie",
    };
  }

  return {
    token: "",
    source: "",
  };
}

async function resolveUser(req) {
  const { token, source } = extractToken(req);
  if (!token) {
    return null;
  }

  const decoded = verifyAuthToken(token);
  const user = await User.findById(decoded.id);
  if (!user) return null;

  const tokenSessionVersion = Number(decoded.sv) || 0;
  if ((Number(user.sessionVersion) || 0) > tokenSessionVersion) {
    const error = new Error("Session expired");
    error.code = "SESSION_EXPIRED";
    throw error;
  }

  return { user, source };
}

const auth = async (req, res, next) => {
  try {
    const resolved = await resolveUser(req);
    if (!resolved?.user) {
      return res.status(401).json({ error: "No token provided" });
    }
    req.user = resolved.user;
    req.authSource = resolved.source;
    next();
  } catch (error) {
    return res
      .status(401)
      .json({
        error:
          error?.code === "SESSION_EXPIRED"
            ? "Your session has expired. Please sign in again."
            : "Invalid token",
      });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const resolved = await resolveUser(req);
    if (resolved?.user) {
      req.user = resolved.user;
      req.authSource = resolved.source;
    }
  } catch {}
  next();
};

module.exports = { auth, optionalAuth };
