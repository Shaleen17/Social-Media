const asyncHandler = require("../utils/asyncHandler");
const {
  signupLocalUser,
  loginLocalUser,
  verifyEmailToken,
  verifySignupOtp,
  resendVerificationEmail,
  loginWithGoogle,
  createGoogleAuthUrl,
  exchangeGoogleCode,
  buildVerificationSuccessRedirect,
  buildVerificationErrorRedirect,
  buildGoogleSuccessRedirect,
  buildGoogleErrorRedirect,
  getReturnToFromState,
} = require("../services/authService");

const signup = asyncHandler(async (req, res) => {
  const result = await signupLocalUser(req.body, req);
  res.status(201).json(result);
});

const login = asyncHandler(async (req, res) => {
  const result = await loginLocalUser(req.body);
  res.json(result);
});

const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toJSON() });
});

const verifyEmailJson = asyncHandler(async (req, res) => {
  const result = await verifyEmailToken(req.params.token);
  res.json({ success: true, user: result.user, token: result.token });
});

const verifySignupOtpCode = asyncHandler(async (req, res) => {
  const result = await verifySignupOtp(req.body);
  res.json({ success: true, user: result.user, token: result.token });
});

async function verifyEmailRedirect(req, res) {
  try {
    const result = await verifyEmailToken(req.params.token);
    return res.redirect(
      buildVerificationSuccessRedirect(req, result.redirectUrl, result.token)
    );
  } catch (error) {
    return res.redirect(
      buildVerificationErrorRedirect(
        req,
        error.message || "Verification failed."
      )
    );
  }
}

const resendVerification = asyncHandler(async (req, res) => {
  const result = await resendVerificationEmail(req.body, req);
  res.json(result);
});

const googleAuth = asyncHandler(async (req, res) => {
  const result = await loginWithGoogle(req.body);
  res.json(result);
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
  verifyEmailJson,
  verifySignupOtpCode,
  verifyEmailRedirect,
  resendVerification,
  googleAuth,
  googleStart,
  googleCallback,
};
