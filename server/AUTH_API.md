# OTP Signup Flow

This project now uses email OTP signup instead of email-link verification.

The backend is built with:

- Express
- MongoDB + Mongoose
- Nodemailer
- JWT for session tokens

## What the flow does

1. User enters `name`, `handle`, `email`, and `password`.
2. Server validates the input.
3. Server checks duplicate email and duplicate username.
4. Server hashes the password immediately.
5. Server generates a secure 6-digit OTP with `crypto.randomInt`.
6. Server hashes the OTP before storing it.
7. Server stores everything in a `PendingSignup` document with expiry time.
8. Server sends the OTP by email using Nodemailer.
9. User submits the OTP.
10. Server verifies the hashed OTP, checks expiry, checks max attempts, and only then creates the real `User` account.

The important change is this:

- `User` is created only after successful OTP verification.
- Before that, signup data lives in `PendingSignup`.

## Database fields

### `User`

Used for the real account after verification.

- `name`
- `handle`
- `email`
- `password`
- `authProvider`
- `googleId`
- `emailVerified`
- profile fields like `avatar`, `banner`, `bio`, `location`, `website`

### `PendingSignup`

Used only during OTP signup.

- `name`
- `handle`
- `email`
- `passwordHash`
- `otpHash`
- `otpExpiresAt`
- `otpLastSentAt`
- `otpSendCount`
- `otpAttemptCount`
- `lastOtpAttemptAt`
- `createdFromIp`
- `lastRequestIp`
- `userAgent`
- `pendingExpiresAt`

## API endpoints

Base URL: `/api/auth`

### `POST /signup`

Starts signup and sends OTP.

Request:

```json
{
  "name": "Aarav Sharma",
  "handle": "aarav",
  "email": "aarav@example.com",
  "password": "strongpassword"
}
```

Response:

```json
{
  "success": true,
  "otpRequired": true,
  "email": "aarav@example.com",
  "message": "We sent a 6-digit OTP to your email. Enter it to finish creating your account."
}
```

### `POST /verify-signup-otp`

Verifies OTP and creates the real user account.

Request:

```json
{
  "email": "aarav@example.com",
  "otp": "123456"
}
```

Response:

```json
{
  "success": true,
  "user": {
    "id": "..."
  },
  "token": "jwt-token"
}
```

### `POST /resend-signup-otp`

Generates a fresh OTP for an existing pending signup.

Request:

```json
{
  "email": "aarav@example.com"
}
```

Response:

```json
{
  "success": true,
  "otpRequired": true,
  "email": "aarav@example.com",
  "message": "A fresh OTP has been sent to your email."
}
```

### `POST /login`

Allows login only for verified users.

If the email is still pending verification, the API returns:

```json
{
  "error": "Please verify your email with the OTP before logging in.",
  "details": {
    "requiresVerification": true,
    "verificationMethod": "otp",
    "email": "aarav@example.com"
  }
}
```

## Example request/response flow

### 1. Signup request

Frontend:

```js
await fetch("/api/auth/signup", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Aarav Sharma",
    handle: "aarav",
    email: "aarav@example.com",
    password: "strongpassword"
  })
});
```

Server result:

- validates input
- hashes password
- creates or updates `PendingSignup`
- stores hashed OTP + expiry
- sends OTP email

### 2. OTP verify request

Frontend:

```js
await fetch("/api/auth/verify-signup-otp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "aarav@example.com",
    otp: "123456"
  })
});
```

Server result:

- finds pending signup by email
- checks OTP expiry
- hashes incoming OTP
- compares hash with stored hash
- creates verified `User`
- deletes `PendingSignup`
- returns JWT

## Clean backend example

This repo already contains the real implementation, but this is the core pattern:

```js
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const PendingSignup = require("./models/PendingSignup");
const User = require("./models/User");

function hashOtp(otp) {
  return crypto.createHash("sha256").update(String(otp)).digest("hex");
}

function generateOtp() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

async function startSignup({ name, handle, email, password }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const otp = generateOtp();

  await PendingSignup.findOneAndUpdate(
    { email },
    {
      name,
      handle,
      email,
      passwordHash,
      otpHash: hashOtp(otp),
      otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      pendingExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return otp;
}

async function completeSignup({ email, otp }) {
  const pending = await PendingSignup.findOne({ email });
  if (!pending) throw new Error("No pending signup found");
  if (pending.otpExpiresAt < new Date()) throw new Error("OTP expired");
  if (pending.otpHash !== hashOtp(otp)) throw new Error("Invalid OTP");

  const user = await User.create({
    name: pending.name,
    handle: pending.handle,
    email: pending.email,
    password: pending.passwordHash,
    emailVerified: true
  });

  await PendingSignup.deleteOne({ _id: pending._id });
  return user;
}
```

## Nodemailer setup

Install:

```bash
npm install nodemailer
```

Create transporter:

```js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});
```

Send OTP:

```js
await transporter.sendMail({
  from: process.env.EMAIL_FROM,
  to: email,
  subject: "Your signup OTP",
  text: `Your OTP is ${otp}`
});
```

## When to use `transporter.verify()` and `sendMail()`

### `transporter.verify()`

Use it when you want to check SMTP configuration before real traffic starts.

Good times to use it:

- once on server startup
- during deployment checks
- when debugging email configuration

In this repo:

- `SMTP_VERIFY_ON_STARTUP=true` will verify SMTP once when the Node server starts
- `SMTP_VERIFY_BEFORE_SEND=true` will verify before each send, which is okay for debugging but not ideal for production

### `sendMail()`

Use it for actual email delivery.

This is what sends the OTP email to the user.

## Security cases handled

The current backend now covers these cases:

- duplicate verified email
- duplicate username
- hashed password before account creation
- hashed OTP storage
- OTP expiry
- resend cooldown
- max OTP resend count per pending signup
- max OTP verification attempts
- IP-based rate limiting
- email-based rate limiting
- pending signup expiry cleanup
- login blocked until OTP verification is complete

## Production best practices

- Use a real transactional provider like SES, Postmark, Resend, SendGrid, or Mailgun instead of a personal Gmail account.
- Keep OTP expiry short, usually 5 to 10 minutes.
- Store only OTP hashes, never plain OTPs.
- Use Redis for distributed rate limiting if you run multiple servers.
- Add monitoring for OTP send failures and bounce rates.
- Do not log OTPs in production.
- Use HTTPS everywhere.
- Add background cleanup for stale pending signups if you do not use Mongo TTL indexes.
- Keep `JWT_SECRET`, SMTP credentials, and OAuth secrets only in environment variables.

## What you still need to add yourself

These are the manual setup steps you must complete:

1. Copy `server/.env.example` to `server/.env`
2. Fill in:
   - `MONGODB_URI`
   - `JWT_SECRET`
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_SECURE`
   - `SMTP_USER`
   - `SMTP_PASS`
   - `EMAIL_FROM`
3. If you use Gmail:
   - enable 2-step verification
   - create an App Password
   - use that App Password as `SMTP_PASS`
4. Set Google OAuth values if you want Google Sign-In
5. Keep `SMTP_VERIFY_ON_STARTUP=true` while testing, then turn it off if you do not want startup verification in production
6. In production, replace Gmail with a transactional email provider

## Files changed for this flow

- `server/models/PendingSignup.js`
- `server/models/User.js`
- `server/services/authService.js`
- `server/utils/authTokens.js`
- `server/utils/sendEmail.js`
- `server/utils/emailTemplates.js`
- `server/controllers/authController.js`

## Quick summary

Old flow:

- user record was created first
- email verification came after

New flow:

- signup data is stored in `PendingSignup`
- OTP is hashed and time-limited
- user verifies OTP
- only then the real `User` account is created
