# Tirth Sutra — Setup Guide

## Prerequisites

- **Node.js** v16+ and **npm**
- **MongoDB Atlas** account (free tier works)
- **Cloudinary** account (free tier works)

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/tirth-sutra.git
cd tirth-sutra
```

### 2. Install Dependencies

```bash
cd server
npm install
```

### 3. Configure Environment Variables

Copy the example file and fill in your credentials:

```bash
cp .env.example .env
```

Open `server/.env` and replace the placeholder values:

| Variable | Where to Get It |
|---|---|
| `MONGODB_URI` | [MongoDB Atlas](https://cloud.mongodb.com) → Connect → Drivers |
| `JWT_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CLOUDINARY_CLOUD_NAME` | [Cloudinary Console](https://cloudinary.com/console) → Dashboard |
| `CLOUDINARY_API_KEY` | Cloudinary Console → Dashboard |
| `CLOUDINARY_API_SECRET` | Cloudinary Console → Dashboard |
| `PORT` | Optional (default: 5000) |
| `SEED_PASSWORD` | Optional — override default seed user password |

> ⚠️ **Never commit your `.env` file.** It is already in `.gitignore`.

### 4. Seed the Database

```bash
node seed.js
```

This creates sample users, posts, stories, and the 6 Mandir Community admin accounts.

### 5. Start the Server

```bash
node server.js
```

The app will be available at `http://localhost:5000`.

If any required environment variables are missing, the server will print a clear error and exit.

## Mandir Community Accounts

After seeding, these accounts are available for testing:

| Email | Mandir |
|---|---|
| kedarnath@tirthsutra.com | Kedarnath |
| kashi@tirthsutra.com | Kashi Vishwanath |
| tirupati@tirthsutra.com | Tirupati Balaji |
| somnath@tirthsutra.com | Somnath |
| meenakshi@tirthsutra.com | Meenakshi Amman |
| ramji@tirthsutra.com | Ram Mandir Ayodhya |

Default password: the value of `SEED_PASSWORD` env var (or `password123` if not set).

## Security Notes

- All secrets are stored in `.env` only — never hardcoded in source code
- `.env` is excluded from Git via `.gitignore`
- The server validates all required env vars at startup
- Cloning this repo without a configured `.env` will **not** start the server
- Mandir community posting is restricted to assigned admin accounts only
