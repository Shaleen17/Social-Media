# Tirth Sutra

Tirth Sutra is a full-stack spiritual social platform built around mandirs, saints, pilgrimages, live media, and devotional community interaction.

It combines a rich single-page frontend with a Node.js backend, MongoDB persistence, real-time chat, browser push notifications, and WebRTC voice/video calling.

## Highlights

- Devotional social feed with posts, comments, likes, reposts, bookmarks, polls, and YouTube embeds
- Stories and short-form video surfaces
- Mandir Community pages with featured temples, discussions, and mandir-specific posting
- Real-time chat powered by Socket.io
- Browser push notifications for chat messages
- WebRTC voice and video calling
- Email/password auth with email verification
- Google sign-in support
- Cloudinary media uploads
- Responsive mobile-first UI served directly from the backend

## Tech Stack

### Frontend

- Vanilla HTML, CSS, and JavaScript
- App entry: `public/index.html`
- Main UI logic: `public/Script.js`
- Backend integration layer: `public/backend-adapter.js`
- Socket client: `public/socket-client.js`
- WebRTC client: `public/webrtc-client.js`
- Service worker for push notifications: `public/sw.js`

### Backend

- Node.js
- Express
- Socket.io
- MongoDB with Mongoose
- JWT authentication
- Nodemailer for email verification
- Cloudinary for media storage
- Web Push for background notifications

## Architecture

This project runs as a single server application:

1. Express serves the SPA from `public/`
2. The same server exposes REST APIs under `/api/*`
3. Socket.io handles chat presence, messaging, typing, read receipts, and call signaling
4. MongoDB stores users, posts, stories, videos, mandir posts, conversations, notifications, and push subscriptions

One important detail: the frontend still keeps a large UI layer in `public/Script.js`, while `public/backend-adapter.js` patches the original local/demo behavior to use real backend APIs and real-time features.

## Project Structure

```text
.
├─ public/
│  ├─ index.html
│  ├─ Script.js
│  ├─ Style.css
│  ├─ api.js
│  ├─ backend-adapter.js
│  ├─ socket-client.js
│  ├─ webrtc-client.js
│  ├─ sw.js
│  └─ images/
├─ server/
│  ├─ config/
│  ├─ controllers/
│  ├─ middleware/
│  ├─ models/
│  ├─ routes/
│  ├─ services/
│  ├─ socket/
│  ├─ utils/
│  ├─ server.js
│  ├─ seed.js
│  └─ .env.example
├─ SETUP.md
└─ README.md
```

## Core Features

### Social

- Home feed
- Posts with text, media, polls, and YouTube embeds
- Likes, comments, reposts, bookmarks
- Profiles, follow/unfollow, followers/following
- Search and discovery

### Devotional Community

- Featured mandirs
- Mandir-specific community pages
- Sant profiles
- Event listings
- Pilgrimage-focused content and media

### Real-Time

- Socket-based chat
- Presence and online indicators
- Typing indicators
- Read receipts
- Browser push notifications for new messages
- WebRTC voice/video calling

### Auth and Media

- Email/password signup
- Email verification
- Google authentication
- Cloudinary uploads for avatars, banners, posts, and chat media

## Quick Start

### 1. Install dependencies

```bash
cd server
npm install
```

### 2. Create the environment file

Copy:

```bash
cp .env.example .env
```

On Windows PowerShell, you can use:

```powershell
Copy-Item .env.example .env
```

### 3. Fill in `server/.env`

Minimum required values:

- `MONGODB_URI`
- `JWT_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Recommended for a complete local setup:

- `FRONTEND_URL`
- `CLIENT_URL`
- `SERVER_URL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_FROM`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

### 4. Seed sample data

```bash
npm run seed
```

### 5. Start the app

```bash
npm run dev
```

Then open:

- `http://localhost:5000`

## Available Scripts

From the `server/` directory:

- `npm start` - start the production server
- `npm run dev` - start with nodemon
- `npm run seed` - seed demo users and content

## Environment Variables

Use `server/.env.example` as the source of truth. The most important groups are:

### App and URLs

- `PORT`
- `CLIENT_URL`
- `FRONTEND_URL`
- `SERVER_URL`

### Database and auth

- `MONGODB_URI`
- `JWT_SECRET`

### Email verification

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_FROM`

### Google auth

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

### Media

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

### Push notifications

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

If VAPID keys are missing, the server can generate temporary keys in memory, but browser subscriptions will not remain stable across restarts. For deployed environments, set fixed keys.

## Deployment Notes

### Real-time chat

Socket.io is used for:

- online/offline presence
- chat delivery
- typing status
- read receipts
- call signaling

Make sure your deployed frontend can connect to the correct backend URL in `public/config.js`.

### Push notifications

Background message notifications require:

- HTTPS in production
- browser notification permission
- service worker support
- valid VAPID keys

### WebRTC calling

Voice and video calling require:

- HTTPS in production, or `localhost` in development
- mic/camera permissions on both sides
- a working Socket.io signaling connection
- STUN/TURN reachability on the user network

### Google OAuth

Add your backend callback URL to Google Cloud Console:

- `http://localhost:5000/api/auth/google/callback`
- `https://your-backend-domain/api/auth/google/callback`

## Main API Areas

The backend currently exposes routes for:

- `/api/auth`
- `/api/posts`
- `/api/users`
- `/api/messages`
- `/api/stories`
- `/api/videos`
- `/api/notifications`
- `/api/push-subscriptions`
- `/api/upload`
- `/api/mandir`

## Important Files

- `server/server.js` - Express app, static serving, Socket.io wiring, route registration
- `server/socket/chat.js` - real-time event handling and call signaling
- `server/routes/messages.js` - conversations, messages, push trigger path
- `server/routes/auth.js` - auth route definitions
- `public/backend-adapter.js` - bridges legacy frontend behavior to real APIs
- `public/webrtc-client.js` - WebRTC call logic
- `public/sw.js` - service worker for push notifications

## Troubleshooting

### App fails to start

Check for missing values in `server/.env`. The server validates required environment variables at boot.

### Email verification is not sending

Verify your SMTP credentials and sender configuration.

### Push notifications are not showing

Check:

- the site is running on `https://` or `localhost`
- notification permission is granted
- VAPID keys are configured
- service worker registration succeeds

### Voice/video call shows calling but does not connect

Check:

- both users are online
- both browsers granted camera/microphone access
- the app is served over `https://` or `localhost`
- deployed backend Socket.io connection is reachable
- restrictive networks are not blocking STUN/TURN traffic

## Additional Docs

- Setup guide: [SETUP.md](./SETUP.md)
- Auth API details: [server/AUTH_API.md](./server/AUTH_API.md)

## Status

This project already includes real backend persistence, real-time messaging, push notifications, and WebRTC calling support, while still carrying a legacy UI layer that is progressively adapted through `public/backend-adapter.js`.

That makes it a strong base for continued product work such as feed ranking, moderation tools, verified mandir flows, analytics, and richer pilgrimage features.
