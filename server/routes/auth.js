const express = require("express");
const {
  signup,
  login,
  me,
  verifySignupOtpCode,
  resendSignupOtpCode,
  googleAuth,
  googleStart,
  googleCallback,
} = require("../controllers/authController");
const { auth } = require("../middleware/auth");

const router = express.Router();

router.post("/signup", signup);
router.post("/verify-signup-otp", verifySignupOtpCode);
router.post("/resend-signup-otp", resendSignupOtpCode);
router.post("/login", login);
router.post("/google", googleAuth);
router.get("/google/start", googleStart);
router.get("/google/callback", googleCallback);
router.get("/me", auth, me);

module.exports = router;
