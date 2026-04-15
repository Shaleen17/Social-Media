# Authentication API

Base URL: `/api/auth`

## Endpoints

### `POST /signup`
Creates a local email/password account and sends a 6-digit OTP email.

Request body:

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
Verifies the OTP for a local signup and immediately signs the user in.

Request body:

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

### `POST /login`
Signs in a verified email/password user.

Request body:

```json
{
  "email": "aarav@example.com",
  "password": "strongpassword"
}
```

Response:

```json
{
  "user": {
    "id": "..."
  },
  "token": "jwt-token"
}
```

If the account is not verified, the API returns `403` and:

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

### `POST /resend-verification`
Sends a fresh OTP email to an existing unverified local user.

Request body:

```json
{
  "email": "aarav@example.com"
}
```

### `GET /verify-email/:token`
Legacy verification-link endpoint kept for backwards compatibility with older verification emails.

### `POST /verify-email/:token`
Legacy verification-link JSON endpoint kept for backwards compatibility.

### `POST /google`
Signs in with Google OAuth.

Request body:

```json
{
  "token": "google-access-or-id-token",
  "tokenType": "access_token"
}
```

Supported `tokenType` values:

- `access_token`
- `id_token`

Google users are automatically treated as verified.

### `GET /google/start`
Starts the server-side Google OAuth flow and redirects the browser to Google.

Query params:

- `returnTo`: absolute frontend URL to redirect back to after Google authentication

### `GET /google/callback`
Google OAuth callback endpoint. Exchanges the code on the server, creates/signs in the user, then redirects back to the frontend with an auth token in the URL hash.

### `GET /me`
Returns the authenticated user for the bearer token.

## Notes

- Passwords are hashed with `bcryptjs`.
- Signup OTPs are 6-digit codes stored in hashed form and expire after 10 minutes.
- Legacy verification links remain supported for older emails.
- Nodemailer supports both Gmail and generic SMTP via environment variables.
- For Google OAuth, add your backend callback URL to Google Cloud Console:
  - `http://localhost:5000/api/auth/google/callback`
  - `https://your-backend-domain/api/auth/google/callback`
