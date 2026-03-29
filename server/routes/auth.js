const express = require("express");
const {
  signup,
  login,
  me,
  verifyEmailJson,
  verifyEmailRedirect,
  resendVerification,
  googleAuth,
  googleStart,
  googleCallback,
} = require("../controllers/authController");
const { auth } = require("../middleware/auth");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/resend-verification", resendVerification);
router.post("/google", googleAuth);
router.get("/google/start", googleStart);
router.get("/google/callback", googleCallback);
router.get("/me", auth, me);
router.get("/verify-email/:token", verifyEmailRedirect);
router.post("/verify-email/:token", verifyEmailJson);

module.exports = router;
