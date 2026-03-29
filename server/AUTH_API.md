# Authentication API

Base URL: `/api/auth`

## Endpoints

### `POST /signup`
Creates a local email/password account and sends a verification email.

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
  "message": "Account created successfully. Please check your email to verify your account before logging in."
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
  "error": "Please verify your email before logging in.",
  "details": {
    "requiresVerification": true,
    "email": "aarav@example.com"
  }
}
```

### `POST /resend-verification`
Sends a fresh verification email to an existing unverified user.

Request body:

```json
{
  "email": "aarav@example.com"
}
```

### `GET /verify-email/:token`
Validates the email verification token on the server and redirects the browser back to the frontend verification page.

### `POST /verify-email/:token`
Validates the email verification token and returns JSON for programmatic verification.

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
- Email verification tokens are random 32-byte values stored in hashed form.
- Verification links expire after 24 hours.
- Nodemailer supports both Gmail and generic SMTP via environment variables.
- For Google OAuth, add your backend callback URL to Google Cloud Console:
  - `http://localhost:5000/api/auth/google/callback`
  - `https://your-backend-domain/api/auth/google/callback`
