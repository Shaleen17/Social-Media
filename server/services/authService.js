const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const AppError = require("../utils/appError");
const sendEmail = require("../utils/sendEmail");
const {
  verificationEmailTemplate,
  resendVerificationEmailTemplate,
  signupOtpEmailTemplate,
  resendSignupOtpEmailTemplate,
} = require("../utils/emailTemplates");
const {
  createEmailVerificationToken,
  createEmailOtpCode,
  hashVerificationToken,
  hashOtpCode,
  signAuthToken,
  EMAIL_OTP_TTL_MS,
} = require("../utils/authTokens");
const {
  getPublicServerUrl,
  resolveClientUrl,
  buildFrontendFileUrl,
  buildRedirectWithHash,
  buildRedirectWithQuery,
  getFallbackClientUrl,
  normalizeUrl,
} = require("../utils/publicUrl");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function sanitizeHandle(handle = "") {
  return handle.toLowerCase().replace("@", "").replace(/\s+/g, "");
}

function createVerificationUrl(req, rawToken) {
  const serverUrl = getPublicServerUrl(req);
  return `${serverUrl}/api/auth/verify-email/${rawToken}`;
}

function createGoogleCallbackUrl(req) {
  return `${getPublicServerUrl(req)}/api/auth/google/callback`;
}

function signOAuthState(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "10m" });
}

function verifyOAuthState(state) {
  return jwt.verify(state, process.env.JWT_SECRET);
}

function getReturnToFromState(state) {
  if (!state) return null;
  try {
    const decoded = verifyOAuthState(state);
    const parsed = normalizeUrl(decoded.returnTo);
    return parsed ? parsed.toString() : null;
  } catch {
    return null;
  }
}

async function ensureUniqueHandle(baseHandle) {
  const normalizedBase = sanitizeHandle(baseHandle).replace(/[^a-z0-9_]/g, "") || "user";
  let candidate = normalizedBase.slice(0, 24);
  let suffix = 0;

  while (await User.exists({ handle: candidate })) {
    suffix += 1;
    candidate = `${normalizedBase.slice(0, Math.max(3, 24 - String(suffix).length))}${suffix}`;
  }

  return candidate;
}

function clearOtpState(user) {
  user.emailOtpCode = undefined;
  user.emailOtpExpires = undefined;
  user.emailOtpLastSentAt = undefined;
}

function clearVerificationState(user) {
  user.emailVerificationToken = undefined;
  user.emailVerificationTokenExpires = undefined;
  user.emailVerificationRedirectUrl = undefined;
  clearOtpState(user);
}

async function deliverVerificationEmail(user, templateBuilder, { req, clientUrl }) {
  const tokenBundle = createEmailVerificationToken();
  user.emailVerificationToken = tokenBundle.hashedToken;
  user.emailVerificationTokenExpires = tokenBundle.expiresAt;
  user.emailVerificationRedirectUrl = resolveClientUrl(req, clientUrl);
  await user.save({ validateBeforeSave: false });

  const verificationUrl = createVerificationUrl(req, tokenBundle.rawToken);
  const template = templateBuilder({
    name: user.name,
    verificationUrl,
  });

  await sendEmail({
    email: user.email,
    subject: template.subject,
    html: template.html,
  });

  return verificationUrl;
}

async function deliverSignupOtpEmail(user, templateBuilder) {
  const otpBundle = createEmailOtpCode();
  user.emailOtpCode = otpBundle.hashedOtp;
  user.emailOtpExpires = otpBundle.expiresAt;
  user.emailOtpLastSentAt = new Date();
  user.emailVerificationToken = undefined;
  user.emailVerificationTokenExpires = undefined;
  user.emailVerificationRedirectUrl = undefined;
  await user.save({ validateBeforeSave: false });

  const template = templateBuilder({
    name: user.name,
    otpCode: otpBundle.rawOtp,
    otpExpiryMinutes: Math.round(EMAIL_OTP_TTL_MS / 60000),
  });

  await sendEmail({
    email: user.email,
    subject: template.subject,
    html: template.html,
    text: `Your Tirth Sutra OTP is ${otpBundle.rawOtp}. It expires in ${Math.round(
      EMAIL_OTP_TTL_MS / 60000
    )} minutes.`,
  });
}

async function signupLocalUser({ name, handle, email, password, clientUrl }, req) {
  if (!name || !handle || !email || !password) {
    throw new AppError("All fields are required.", 400);
  }

  if (password.length < 6) {
    throw new AppError("Password must be at least 6 characters.", 400);
  }

  const cleanHandle = sanitizeHandle(handle);
  if (cleanHandle.length < 3) {
    throw new AppError("Username must be at least 3 characters.", 400);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existingEmail = await User.findOne({ email: normalizedEmail }).select("+password");
  const existingHandle = await User.findOne({ handle: cleanHandle });

  let user = existingEmail;

  if (existingEmail && (existingEmail.emailVerified || existingEmail.verified || existingEmail.authProvider !== "local")) {
    throw new AppError("Email already registered.", 409);
  }

  if (existingHandle && (!existingEmail || String(existingHandle._id) !== String(existingEmail._id))) {
    throw new AppError("Username is already taken.", 409);
  }

  if (user) {
    user.name = name.trim();
    user.handle = cleanHandle;
    user.email = normalizedEmail;
    user.password = password;
    user.authProvider = "local";
    user.emailVerified = false;
    clearVerificationState(user);
    await user.save();
  } else {
    user = await User.create({
      name: name.trim(),
      handle: cleanHandle,
      email: normalizedEmail,
      password,
      authProvider: "local",
      emailVerified: false,
    });
  }

  try {
    await deliverSignupOtpEmail(user, signupOtpEmailTemplate);
  } catch (error) {
    if (!existingEmail) {
      await User.findByIdAndDelete(user._id);
    }
    throw error;
  }

  return {
    success: true,
    otpRequired: true,
    email: user.email,
    message:
      "We sent a 6-digit OTP to your email. Enter it to finish creating your account.",
  };
}

async function loginLocalUser({ email, password }) {
  if (!email || !password) {
    throw new AppError("Email and password are required.", 400);
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password");
  if (!user) {
    throw new AppError("Invalid email or password.", 401);
  }

  if (!(user.emailVerified || user.verified)) {
    throw new AppError("Please verify your email with the OTP before logging in.", 403, {
      requiresVerification: true,
      verificationMethod: "otp",
      email: user.email,
    });
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new AppError("Invalid email or password.", 401);
  }

  const safeUser = await User.findById(user._id);
  return {
    user: safeUser.toJSON(),
    token: signAuthToken(user._id),
  };
}

async function verifyEmailToken(rawToken) {
  if (!rawToken) {
    throw new AppError("Verification token is required.", 400);
  }

  const hashedToken = hashVerificationToken(rawToken);
  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationTokenExpires: { $gt: new Date() },
  });

  if (!user) {
    throw new AppError("This verification link is invalid or has expired.", 400);
  }

  user.emailVerified = true;
  const redirectUrl = user.emailVerificationRedirectUrl;
  clearVerificationState(user);
  await user.save({ validateBeforeSave: false });

  return {
    user: user.toJSON(),
    token: signAuthToken(user._id),
    redirectUrl,
  };
}

async function verifySignupOtp({ email, otp }) {
  if (!email || !otp) {
    throw new AppError("Email and OTP are required.", 400);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const hashedOtp = hashOtpCode(otp.trim());
  const user = await User.findOne({
    email: normalizedEmail,
    emailOtpCode: hashedOtp,
    emailOtpExpires: { $gt: new Date() },
  });

  if (!user) {
    throw new AppError("This OTP is invalid or has expired.", 400);
  }

  user.emailVerified = true;
  clearVerificationState(user);
  await user.save({ validateBeforeSave: false });

  return {
    user: user.toJSON(),
    token: signAuthToken(user._id),
  };
}

async function resendVerificationEmail({ email, clientUrl }, req) {
  if (!email) {
    throw new AppError("Email is required.", 400);
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) {
    throw new AppError("No account was found for that email address.", 404);
  }

  if (user.emailVerified || user.verified) {
    throw new AppError("This email is already verified. You can sign in now.", 400);
  }

  await deliverSignupOtpEmail(user, resendSignupOtpEmailTemplate);

  return {
    success: true,
    otpRequired: true,
    email: user.email,
    message: "A fresh OTP has been sent to your email.",
  };
}

async function getGoogleProfile({ token, tokenType }) {
  if (!token) {
    throw new AppError("Google token is required.", 400);
  }

  if (tokenType === "access_token") {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new AppError("Unable to verify the Google access token.", 401);
    }

    const payload = await response.json();
    if (!payload.email || !payload.sub) {
      throw new AppError("Google did not return a valid user profile.", 401);
    }

    return payload;
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  return ticket.getPayload();
}

async function loginWithGoogle({ token, tokenType }) {
  const profile = await getGoogleProfile({ token, tokenType });
  const {
    email,
    email_verified: emailVerified,
    name,
    picture,
    sub,
  } = profile;

  if (!email || !emailVerified) {
    throw new AppError("Your Google account email could not be verified.", 401);
  }

  const normalizedEmail = email.toLowerCase().trim();
  let user = await User.findOne({
    $or: [{ email: normalizedEmail }, { googleId: sub }],
  }).select("+password");

  if (!user) {
    const handle = await ensureUniqueHandle(name || normalizedEmail.split("@")[0]);
    user = await User.create({
      name: name || normalizedEmail.split("@")[0],
      handle,
      email: normalizedEmail,
      password: crypto.randomBytes(24).toString("hex"),
      authProvider: "google",
      googleId: sub,
      avatar: picture || null,
      emailVerified: true,
    });
  } else {
    user.authProvider = user.authProvider || "google";
    user.googleId = user.googleId || sub;
    user.emailVerified = true;
    clearVerificationState(user);
    if (picture && !user.avatar) {
      user.avatar = picture;
    }
    await user.save({ validateBeforeSave: false });
  }

  const safeUser = await User.findById(user._id);
  return {
    user: safeUser.toJSON(),
    token: signAuthToken(user._id),
  };
}

function createGoogleAuthUrl(req, returnTo) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new AppError("Google Sign-In is not configured on the server.", 500);
  }

  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    createGoogleCallbackUrl(req)
  );

  const safeReturnTo = resolveClientUrl(req, returnTo);
  const state = signOAuthState({ returnTo: safeReturnTo });

  return client.generateAuthUrl({
    access_type: "online",
    prompt: "select_account",
    scope: ["openid", "email", "profile"],
    state,
  });
}

async function exchangeGoogleCode(req, { code, state }) {
  if (!code) {
    throw new AppError("Google did not return an authorization code.", 400);
  }

  const decodedState = verifyOAuthState(state);
  const parsedReturnTo = normalizeUrl(decodedState.returnTo);
  const returnTo = parsedReturnTo
    ? parsedReturnTo.toString()
    : getFallbackClientUrl(req);

  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    createGoogleCallbackUrl(req)
  );

  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) {
    throw new AppError("Google did not return an ID token.", 401);
  }

  const authResult = await loginWithGoogle({
    token: tokens.id_token,
    tokenType: "id_token",
  });

  return {
    ...authResult,
    returnTo,
  };
}

function buildVerificationSuccessRedirect(req, redirectUrl, token) {
  const clientUrl = redirectUrl || getFallbackClientUrl(req);
  const target =
    buildFrontendFileUrl(clientUrl, "verify.html") ||
    buildFrontendFileUrl(getFallbackClientUrl(req), "verify.html");

  return buildRedirectWithHash(target, {
    status: "success",
    verified: "1",
    authToken: token,
  });
}

function buildVerificationErrorRedirect(req, message) {
  const target = buildFrontendFileUrl(getFallbackClientUrl(req), "verify.html");
  return buildRedirectWithQuery(target, {
    status: "error",
    message,
  });
}

function buildGoogleSuccessRedirect(req, returnTo, token) {
  const parsedReturnTo = normalizeUrl(returnTo);
  const target = parsedReturnTo
    ? parsedReturnTo.toString()
    : getFallbackClientUrl(req);
  return buildRedirectWithHash(target, {
    authToken: token,
    authSource: "google",
    status: "success",
  });
}

function buildGoogleErrorRedirect(req, returnTo, message) {
  const parsedReturnTo = normalizeUrl(returnTo);
  const target = parsedReturnTo
    ? parsedReturnTo.toString()
    : getFallbackClientUrl(req);
  return buildRedirectWithQuery(target, {
    authError: message,
    authSource: "google",
  });
}

module.exports = {
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
};
