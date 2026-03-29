const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function resolveUserFromHeader(header) {
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.split(" ")[1];
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  return User.findById(decoded.id);
}

const auth = async (req, res, next) => {
  try {
    const user = await resolveUserFromHeader(req.headers.authorization);
    if (!user) {
      return res.status(401).json({ error: "No token provided" });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const user = await resolveUserFromHeader(req.headers.authorization);
    if (user) {
      req.user = user;
    }
  } catch {}
  next();
};

module.exports = { auth, optionalAuth };
