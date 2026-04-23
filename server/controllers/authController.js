const asyncHandler = require("../utils/asyncHandler");
const {
  signupLocalUser,
  loginLocalUser,
  verifySignupOtp,
  resendSignupOtp,
  requestPasswordReset,
  resetPasswordWithOtp,
  createAppwriteGoogleSignupIntent,
  loginWithGoogle,
  loginWithAppwriteGoogle,
  createGoogleAuthUrl,
  exchangeGoogleCode,
  buildGoogleSuccessRedirect,
  buildGoogleErrorRedirect,
  getReturnToFromState,
} = require("../services/authService");
const { ensureUserReferralCode } = require("../utils/referrals");

const signup = asyncHandler(async (req, res) => {
  const result = await signupLocalUser(req.body, {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  res.status(201).json(result);
});

const login = asyncHandler(async (req, res) => {
  const result = await loginLocalUser(req.body, {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  res.json(result);
});

const me = asyncHandler(async (req, res) => {
  await ensureUserReferralCode(req.user);
  res.json({ user: req.user.toJSON() });
});

const verifySignupOtpCode = asyncHandler(async (req, res) => {
  const result = await verifySignupOtp(req.body, {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  res.json({ success: true, user: result.user, token: result.token });
});

const resendSignupOtpCode = asyncHandler(async (req, res) => {
  const result = await resendSignupOtp(req.body, {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  res.json(result);
});

const forgotPassword = asyncHandler(async (req, res) => {
  const result = await requestPasswordReset(req.body, {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  res.json(result);
});

const resetPassword = asyncHandler(async (req, res) => {
  const result = await resetPasswordWithOtp(req.body, {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  res.json(result);
});

const googleAuth = asyncHandler(async (req, res) => {
  const result = await loginWithGoogle(req.body);
  res.json(result);
});

const appwriteGoogleAuth = asyncHandler(async (req, res) => {
  const result = await loginWithAppwriteGoogle(req.body);
  res.json(result);
});

const appwriteGoogleIntent = asyncHandler(async (req, res) => {
  res.json(createAppwriteGoogleSignupIntent());
});

const googleStart = asyncHandler(async (req, res) => {
  const url = createGoogleAuthUrl(req, req.query.returnTo || req.query.clientUrl);
  res.redirect(url);
});

async function googleCallback(req, res) {
  const fallbackReturnTo =
    getReturnToFromState(req.query.state) ||
    req.query.returnTo ||
    req.query.clientUrl;

  if (req.query.error) {
    return res.redirect(
      buildGoogleErrorRedirect(
        req,
        fallbackReturnTo,
        "Google Sign-In was canceled or denied."
      )
    );
  }

  try {
    const result = await exchangeGoogleCode(req, {
      code: req.query.code,
      state: req.query.state,
    });

    return res.redirect(
      buildGoogleSuccessRedirect(req, result.returnTo, result.token)
    );
  } catch (error) {
    return res.redirect(
      buildGoogleErrorRedirect(
        req,
        fallbackReturnTo,
        error.message || "Google Sign-In failed."
      )
    );
  }
}

module.exports = {
  signup,
  login,
  me,
  verifySignupOtpCode,
  resendSignupOtpCode,
  forgotPassword,
  resetPassword,
  googleAuth,
  appwriteGoogleIntent,
  appwriteGoogleAuth,
  googleStart,
  googleCallback,
};
