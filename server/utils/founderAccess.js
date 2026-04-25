const AppError = require("./appError");

const DEFAULT_FOUNDER_OWNER_EMAILS = [
  "tirthsutra@gmail.com",
  "tirthsutra@gemail.com",
];
const DEFAULT_FOUNDER_OWNER_HANDLES = ["tirthsutra"];

function getFounderOwnerEmails() {
  const configured = String(
    process.env.FOUNDER_OWNER_EMAILS || process.env.FOUNDER_OWNER_EMAIL || ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_FOUNDER_OWNER_EMAILS;
}

function getFounderOwnerHandles() {
  const configured = String(process.env.FOUNDER_OWNER_HANDLES || "")
    .split(",")
    .map((value) => value.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_FOUNDER_OWNER_HANDLES;
}

function isFounderUser(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  const handle = String(user?.handle || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  return (
    (!!email && getFounderOwnerEmails().includes(email)) ||
    (!!handle && getFounderOwnerHandles().includes(handle))
  );
}

function requireFounder(req, res, next) {
  if (!isFounderUser(req.user)) {
    return next(new AppError("Founder access only", 403));
  }
  next();
}

module.exports = {
  getFounderOwnerHandles,
  getFounderOwnerEmails,
  isFounderUser,
  requireFounder,
};
