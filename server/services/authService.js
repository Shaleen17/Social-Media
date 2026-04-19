const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const PendingSignup = require("../models/PendingSignup");
const AppError = require("../utils/appError");
const {
  sendEmail,
  assertEmailDeliveryConfigured,
} = require("../utils/sendEmail");
const {
  signupOtpEmailTemplate,
  resendSignupOtpEmailTemplate,
} = require("../utils/emailTemplates");
const {
  createEmailOtpCode,
  hashOtpCode,
  compareHashedValues,
  createPendingSignupExpiryDate,
  signAuthToken,
  EMAIL_OTP_TTL_MS,
  EMAIL_OTP_LENGTH,
  OTP_RESEND_COOLDOWN_MS,
  OTP_MAX_VERIFY_ATTEMPTS,
  OTP_MAX_SENDS_PER_SESSION,
} = require("../utils/authTokens");
const { assertRateLimit } = require("../utils/requestLimiter");
const {
  getPublicServerUrl,
  resolveClientUrl,
  buildRedirectWithHash,
  buildRedirectWithQuery,
  getFallbackClientUrl,
  normalizeUrl,
} = require("../utils/publicUrl");
const {
  sanitizeReferralCode,
  generateUniqueReferralCode,
  resolveReferrer,
  attachReferralRelationship,
  ensureUserReferralCode,
} = require("../utils/referrals");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIGNUP_RATE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_RATE_WINDOW_MS = 15 * 60 * 1000;
const RESEND_RATE_WINDOW_MS = 15 * 60 * 1000;

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function sanitizeHandle(handle = "") {
  return String(handle)
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9_]/g, "");
}

function normalizeIp(ip = "") {
  return String(ip || "unknown").trim();
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

function createVerificationDetails(email) {
  return {
    requiresVerification: true,
    verificationMethod: "otp",
    email,
    otpLength: EMAIL_OTP_LENGTH,
    resendAfterSeconds: Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000),
  };
}

function isValidEmail(email) {
  return EMAIL_RE.test(normalizeEmail(email));
}

function isLocalUnverifiedUser(user) {
  return (
    !!user &&
    user.authProvider === "local" &&
    !user.emailVerified
  );
}

function isPendingSignupExpired(pendingSignup) {
  return (
    !pendingSignup?.pendingExpiresAt ||
    new Date(pendingSignup.pendingExpiresAt).getTime() <= Date.now()
  );
}

function clearPendingOtpState(pendingSignup) {
  pendingSignup.otpHash = null;
  pendingSignup.otpExpiresAt = null;
  pendingSignup.otpLastSentAt = null;
  pendingSignup.otpAttemptCount = 0;
  pendingSignup.lastOtpAttemptAt = null;
}

function buildOtpResponse(email, message) {
  return {
    success: true,
    otpRequired: true,
    email,
    message,
    verification: {
      method: "otp",
      otpLength: EMAIL_OTP_LENGTH,
      resendAfterSeconds: Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000),
    },
  };
}

function assertOtpResendAllowed(pendingSignup) {
  if (!pendingSignup?.otpLastSentAt) {
    return;
  }

  const elapsedMs =
    Date.now() - new Date(pendingSignup.otpLastSentAt).getTime();
  if (elapsedMs >= OTP_RESEND_COOLDOWN_MS) {
    return;
  }

  const waitSeconds = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsedMs) / 1000);
  throw new AppError(
    `Please wait ${waitSeconds} seconds before requesting a new OTP.`,
    429,
    { retryAfterSeconds: waitSeconds }
  );
}

async function deleteExpiredPendingSignup(pendingSignup) {
  if (!pendingSignup || !isPendingSignupExpired(pendingSignup)) {
    return false;
  }

  await PendingSignup.deleteOne({ _id: pendingSignup._id });
  return true;
}

async function ensureUniqueHandle(baseHandle) {
  const normalizedBase = sanitizeHandle(baseHandle) || "user";
  let candidate = normalizedBase.slice(0, 24);
  let suffix = 0;

  while (await User.exists({ handle: candidate })) {
    suffix += 1;
    candidate = `${normalizedBase.slice(
      0,
      Math.max(3, 24 - String(suffix).length)
    )}${suffix}`;
  }

  return candidate;
}

async function deliverSignupOtpEmail(pendingSignup, templateBuilder) {
  if ((pendingSignup.otpSendCount || 0) >= OTP_MAX_SENDS_PER_SESSION) {
    throw new AppError(
      "You have requested too many OTPs for this signup. Start signup again after some time.",
      429
    );
  }

  const otpBundle = createEmailOtpCode();
  pendingSignup.otpHash = otpBundle.hashedOtp;
  pendingSignup.otpExpiresAt = otpBundle.expiresAt;
  pendingSignup.otpLastSentAt = new Date();
  pendingSignup.otpAttemptCount = 0;
  pendingSignup.lastOtpAttemptAt = null;
  pendingSignup.pendingExpiresAt = createPendingSignupExpiryDate();
  pendingSignup.otpSendCount = (pendingSignup.otpSendCount || 0) + 1;

  await pendingSignup.save();

  try {
    const template = templateBuilder({
      name: pendingSignup.name,
      otpCode: otpBundle.rawOtp,
      otpExpiryMinutes: Math.round(EMAIL_OTP_TTL_MS / 60000),
    });

    await sendEmail({
      email: pendingSignup.email,
      subject: template.subject,
      html: template.html,
      text: `Your Tirth Sutra OTP is ${otpBundle.rawOtp}. It expires in ${Math.round(
        EMAIL_OTP_TTL_MS / 60000
      )} minutes.`,
    });
  } catch (error) {
    clearPendingOtpState(pendingSignup);
    pendingSignup.otpSendCount = Math.max(0, (pendingSignup.otpSendCount || 1) - 1);
    await pendingSignup.save({ validateBeforeSave: false }).catch(() => {});
    throw error;
  }
}

async function findPendingSignupByEmail(email) {
  const pendingSignup = await PendingSignup.findOne({ email });
  if (!pendingSignup) {
    return null;
  }

  if (await deleteExpiredPendingSignup(pendingSignup)) {
    return null;
  }

  return pendingSignup;
}

async function ensurePendingSignupForLegacyUser(user, context = {}) {
  if (!user?.password) {
    throw new AppError(
      "This signup needs to be restarted. Please sign up again.",
      400
    );
  }

  let pendingSignup = await findPendingSignupByEmail(user.email);
  if (pendingSignup) {
    return pendingSignup;
  }

  pendingSignup = new PendingSignup({
    name: user.name,
    handle: user.handle,
    email: user.email,
    passwordHash: user.password,
    createdFromIp: normalizeIp(context.ip),
    lastRequestIp: normalizeIp(context.ip),
    userAgent: context.userAgent || null,
    pendingExpiresAt: createPendingSignupExpiryDate(),
  });

  await pendingSignup.save();
  return pendingSignup;
}

async function ensureSignupInputIsAvailable({ email, handle, legacyUserId }) {
  const existingHandleUser = await User.findOne({ handle });
  if (
    existingHandleUser &&
    String(existingHandleUser._id) !== String(legacyUserId || "")
  ) {
    throw new AppError("Username is already taken.", 409);
  }

  const pendingHandleOwner = await PendingSignup.findOne({ handle });
  if (
    pendingHandleOwner &&
    pendingHandleOwner.email !== email &&
    !isPendingSignupExpired(pendingHandleOwner)
  ) {
    throw new AppError(
      "Username is already reserved for another signup. Try a different one.",
      409
    );
  }

  if (pendingHandleOwner && isPendingSignupExpired(pendingHandleOwner)) {
    await PendingSignup.deleteOne({ _id: pendingHandleOwner._id });
  }
}

async function createOrUpdatePendingSignup(
  { name, handle, email, password, referralCode },
  context = {}
) {
  const existingUser = await User.findOne({ email }).select("+password");
  const legacyUser = isLocalUnverifiedUser(existingUser) ? existingUser : null;

  if (existingUser && !legacyUser) {
    throw new AppError("Email already registered.", 409);
  }

  await ensureSignupInputIsAvailable({
    email,
    handle,
    legacyUserId: legacyUser?._id,
  });

  let pendingSignup = await findPendingSignupByEmail(email);
  if (!pendingSignup) {
    pendingSignup = new PendingSignup({
      name,
      handle,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      createdFromIp: normalizeIp(context.ip),
      lastRequestIp: normalizeIp(context.ip),
      userAgent: context.userAgent || null,
      pendingExpiresAt: createPendingSignupExpiryDate(),
    });
  } else {
    if ((pendingSignup.otpSendCount || 0) >= OTP_MAX_SENDS_PER_SESSION) {
      clearPendingOtpState(pendingSignup);
      pendingSignup.otpSendCount = 0;
    }

    pendingSignup.name = name;
    pendingSignup.handle = handle;
    pendingSignup.email = email;
    pendingSignup.passwordHash = await bcrypt.hash(password, 12);
    pendingSignup.lastRequestIp = normalizeIp(context.ip);
    pendingSignup.userAgent = context.userAgent || pendingSignup.userAgent;
    pendingSignup.pendingExpiresAt = createPendingSignupExpiryDate();
  }

  const normalizedReferralCode = sanitizeReferralCode(referralCode);
  const referrer = normalizedReferralCode
    ? await resolveReferrer(normalizedReferralCode)
    : null;
  pendingSignup.referralCodeUsed = referrer ? referrer.referralCode : null;
  pendingSignup.referredBy = referrer ? referrer._id : null;

  const otpStillFresh =
    pendingSignup.otpHash &&
    pendingSignup.otpExpiresAt &&
    new Date(pendingSignup.otpExpiresAt).getTime() > Date.now() &&
    pendingSignup.otpLastSentAt &&
    Date.now() - new Date(pendingSignup.otpLastSentAt).getTime() <
      OTP_RESEND_COOLDOWN_MS;

  await pendingSignup.save();

  if (otpStillFresh) {
    return buildOtpResponse(
      pendingSignup.email,
      "An OTP was already sent recently. Check your inbox and enter it to finish signup."
    );
  }

  await deliverSignupOtpEmail(pendingSignup, signupOtpEmailTemplate);

  return buildOtpResponse(
    pendingSignup.email,
    "We sent a 6-digit OTP to your email. Enter it to finish creating your account."
  );
}

async function upsertVerifiedUserFromPendingSignup(pendingSignup) {
  const existingUser = await User.findOne({ email: pendingSignup.email }).select(
    "+password"
  );
  const legacyUser = isLocalUnverifiedUser(existingUser) ? existingUser : null;

  if (existingUser && !legacyUser) {
    throw new AppError("Email already registered.", 409);
  }

  const conflictingHandleUser = await User.findOne({ handle: pendingSignup.handle });
  if (
    conflictingHandleUser &&
    String(conflictingHandleUser._id) !== String(legacyUser?._id || "")
  ) {
    throw new AppError("Username is already taken.", 409);
  }

  const user = legacyUser || new User();
  user.name = pendingSignup.name;
  user.handle = pendingSignup.handle;
  user.email = pendingSignup.email;
  user.password = pendingSignup.passwordHash;
  user.authProvider = "local";
  user.emailVerified = true;
  user.referralCode =
    user.referralCode ||
    (await generateUniqueReferralCode(
      pendingSignup.handle || pendingSignup.name || pendingSignup.email,
    ));
  if (!user.referredBy && pendingSignup.referredBy) {
    user.referredBy = pendingSignup.referredBy;
  }

  await user.save();
  if (pendingSignup.referralCodeUsed) {
    await attachReferralRelationship(user, pendingSignup.referralCodeUsed);
  }
  return user;
}

async function signupLocalUser(payload = {}, context = {}) {
  const name = String(payload.name || "").trim();
  const handle = sanitizeHandle(payload.handle);
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const ip = normalizeIp(context.ip);

  assertRateLimit({
    key: `auth:signup:ip:${ip}`,
    limit: 10,
    windowMs: SIGNUP_RATE_WINDOW_MS,
    message: "Too many signup attempts. Please wait a few minutes and try again.",
  });
  assertRateLimit({
    key: `auth:signup:email:${email}`,
    limit: 5,
    windowMs: SIGNUP_RATE_WINDOW_MS,
    message:
      "Too many signup attempts for this email. Please wait a few minutes and try again.",
  });

  if (!name || !handle || !email || !password) {
    throw new AppError("All fields are required.", 400);
  }

  if (!isValidEmail(email)) {
    throw new AppError("Please enter a valid email address.", 400);
  }

  if (password.length < 6) {
    throw new AppError("Password must be at least 6 characters.", 400);
  }

  if (handle.length < 3) {
    throw new AppError("Username must be at least 3 characters.", 400);
  }

  assertEmailDeliveryConfigured();

  return createOrUpdatePendingSignup(
    {
      name,
      handle,
      email,
      password,
      referralCode: payload.referralCode,
    },
    context
  );
}

async function loginLocalUser(payload = {}, context = {}) {
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");

  assertRateLimit({
    key: `auth:login:ip:${normalizeIp(context.ip)}`,
    limit: 25,
    windowMs: LOGIN_RATE_WINDOW_MS,
    message: "Too many login attempts. Please wait a bit and try again.",
  });

  if (!email || !password) {
    throw new AppError("Email and password are required.", 400);
  }

  const user = await User.findOne({ email }).select("+password");
  if (!user) {
    const pendingSignup = await findPendingSignupByEmail(email);
    if (pendingSignup) {
      throw new AppError(
        "Please verify your email with the OTP before logging in.",
        403,
        createVerificationDetails(email)
      );
    }

    throw new AppError("Invalid email or password.", 401);
  }

  if (!user.emailVerified) {
    throw new AppError(
      "Please verify your email with the OTP before logging in.",
      403,
      createVerificationDetails(user.email)
    );
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new AppError("Invalid email or password.", 401);
  }

  const safeUser = await User.findById(user._id);
  await ensureUserReferralCode(safeUser);
  return {
    user: safeUser.toJSON(),
    token: signAuthToken(user._id),
  };
}

async function verifySignupOtp(payload = {}, context = {}) {
  const email = normalizeEmail(payload.email);
  const otp = String(payload.otp || "").trim();

  assertRateLimit({
    key: `auth:verify:ip:${normalizeIp(context.ip)}`,
    limit: 25,
    windowMs: VERIFY_RATE_WINDOW_MS,
    message:
      "Too many OTP verification attempts. Please wait a bit before trying again.",
  });
  assertRateLimit({
    key: `auth:verify:email:${email}`,
    limit: 15,
    windowMs: VERIFY_RATE_WINDOW_MS,
    message:
      "Too many OTP verification attempts for this email. Please wait a bit before trying again.",
  });

  if (!email || !otp) {
    throw new AppError("Email and OTP are required.", 400);
  }

  if (!isValidEmail(email)) {
    throw new AppError("Please enter a valid email address.", 400);
  }

  if (!new RegExp(`^\\d{${EMAIL_OTP_LENGTH}}$`).test(otp)) {
    throw new AppError(`OTP must be a ${EMAIL_OTP_LENGTH}-digit code.`, 400);
  }

  const pendingSignup = await findPendingSignupByEmail(email);
  if (!pendingSignup) {
    throw new AppError(
      "No pending signup was found for this email. Start signup again.",
      404
    );
  }

  if (!pendingSignup.otpHash || !pendingSignup.otpExpiresAt) {
    throw new AppError("No active OTP was found. Request a new OTP.", 400);
  }

  if ((pendingSignup.otpAttemptCount || 0) >= OTP_MAX_VERIFY_ATTEMPTS) {
    throw new AppError(
      "Maximum OTP attempts reached. Request a new OTP.",
      429,
      { requiresResend: true }
    );
  }

  if (new Date(pendingSignup.otpExpiresAt).getTime() <= Date.now()) {
    throw new AppError("This OTP has expired. Request a new OTP.", 400, {
      requiresResend: true,
    });
  }

  const otpHash = hashOtpCode(otp);
  const matches = compareHashedValues(pendingSignup.otpHash, otpHash);

  if (!matches) {
    pendingSignup.otpAttemptCount = (pendingSignup.otpAttemptCount || 0) + 1;
    pendingSignup.lastOtpAttemptAt = new Date();

    const attemptsRemaining = Math.max(
      0,
      OTP_MAX_VERIFY_ATTEMPTS - pendingSignup.otpAttemptCount
    );

    if (attemptsRemaining === 0) {
      clearPendingOtpState(pendingSignup);
    }

    await pendingSignup.save({ validateBeforeSave: false });

    if (attemptsRemaining === 0) {
      throw new AppError(
        "Maximum OTP attempts reached. Request a new OTP.",
        429,
        { requiresResend: true }
      );
    }

    throw new AppError("The OTP you entered is incorrect.", 400, {
      attemptsRemaining,
    });
  }

  const user = await upsertVerifiedUserFromPendingSignup(pendingSignup);
  await PendingSignup.deleteOne({ _id: pendingSignup._id });

  const safeUser = await User.findById(user._id);
  await ensureUserReferralCode(safeUser);
  return {
    user: safeUser.toJSON(),
    token: signAuthToken(user._id),
  };
}

async function resendSignupOtp(payload = {}, context = {}) {
  const email = normalizeEmail(payload.email);
  const ip = normalizeIp(context.ip);

  assertEmailDeliveryConfigured();

  assertRateLimit({
    key: `auth:resend:ip:${ip}`,
    limit: 10,
    windowMs: RESEND_RATE_WINDOW_MS,
    message:
      "Too many OTP resend requests. Please wait a few minutes and try again.",
  });
  assertRateLimit({
    key: `auth:resend:email:${email}`,
    limit: 10,
    windowMs: RESEND_RATE_WINDOW_MS,
    message:
      "Too many OTP resend requests for this email. Please wait a few minutes and try again.",
  });

  if (!email) {
    throw new AppError("Email is required.", 400);
  }

  if (!isValidEmail(email)) {
    throw new AppError("Please enter a valid email address.", 400);
  }

  let pendingSignup = await findPendingSignupByEmail(email);

  if (!pendingSignup) {
    const existingUser = await User.findOne({ email }).select("+password");
    if (!existingUser) {
      throw new AppError(
        "No pending signup was found for that email. Start signup again.",
        404
      );
    }

    if (!isLocalUnverifiedUser(existingUser)) {
      throw new AppError("This email is already verified. You can sign in now.", 400);
    }

    pendingSignup = await ensurePendingSignupForLegacyUser(existingUser, context);
  }

  assertOtpResendAllowed(pendingSignup);
  pendingSignup.lastRequestIp = ip;
  pendingSignup.userAgent = context.userAgent || pendingSignup.userAgent;

  await deliverSignupOtpEmail(pendingSignup, resendSignupOtpEmailTemplate);

  return buildOtpResponse(
    pendingSignup.email,
    "A fresh OTP has been sent to your email."
  );
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

async function loginWithGoogle({ token, tokenType, referralCode }) {
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

  const normalizedEmail = normalizeEmail(email);
  const normalizedReferralCode = sanitizeReferralCode(referralCode);
  const referrer = normalizedReferralCode
    ? await resolveReferrer(normalizedReferralCode)
    : null;
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
      referralCode: await generateUniqueReferralCode(handle || normalizedEmail),
      referredBy: referrer ? referrer._id : null,
    });
  } else {
    user.authProvider = user.authProvider || "google";
    user.googleId = user.googleId || sub;
    user.emailVerified = true;
    user.referralCode =
      user.referralCode ||
      (await generateUniqueReferralCode(user.handle || user.name || normalizedEmail));
    if (
      referrer &&
      !user.referredBy &&
      String(referrer._id) !== String(user._id)
    ) {
      user.referredBy = referrer._id;
    }
    if (picture && !user.avatar) {
      user.avatar = picture;
    }
    await user.save({ validateBeforeSave: false });
  }

  await PendingSignup.deleteOne({ email: normalizedEmail }).catch(() => {});
  if (referrer) {
    await attachReferralRelationship(user, referrer.referralCode);
  }

  const safeUser = await User.findById(user._id);
  await ensureUserReferralCode(safeUser);
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
    referralCode: parsedReturnTo?.searchParams?.get("ref"),
  });

  return {
    ...authResult,
    returnTo,
  };
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
  verifySignupOtp,
  resendSignupOtp,
  loginWithGoogle,
  createGoogleAuthUrl,
  exchangeGoogleCode,
  buildGoogleSuccessRedirect,
  buildGoogleErrorRedirect,
  getReturnToFromState,
};
