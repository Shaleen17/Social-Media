# 1-Year Email Drip Campaign

This backend now supports a consent-based Tirth Sutra lifecycle email journey.

## Flow

1. User signs up and optionally ticks the marketing checkbox.
2. Signup OTP is sent as usual.
3. After OTP verification, the user is enrolled only if consent was given.
4. The server creates 156 scheduled email records:
   - 52 weeks
   - 3 emails per week
   - unique random weekdays inside each week
   - sequence: Inspiration, Knowledge, Action
5. The worker sends due emails through the existing Nodemailer SMTP setup.
6. Open, click, unsubscribe, and campaign status are stored in MongoDB.

## Required Production Env

Set the existing SMTP variables first:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_sender@example.com
SMTP_PASS=your_app_password
EMAIL_FROM=your_sender@example.com
```

Then set campaign variables:

```env
EMAIL_CAMPAIGN_ENABLED=true
EMAIL_CAMPAIGN_PUBLIC_URL=https://your-backend-domain.com
EMAIL_CAMPAIGN_CLIENT_URL=https://your-frontend-domain.com
EMAIL_CAMPAIGN_DEFAULT_CTA_URL=https://shaleen17.github.io/Tirth-Sutra/
EMAIL_CAMPAIGN_CRON_SECRET=replace_with_long_random_secret
EMAIL_CAMPAIGN_ADMIN_KEY=replace_with_long_random_secret
```

For deliverability, authenticate the sender domain with SPF, DKIM, and DMARC in DNS.

## Worker and Cron

On a persistent server such as Render, the in-process worker runs every 5 minutes by default.

For serverless or extra reliability, schedule a cron request:

```http
POST /api/email-campaign/run-due
Authorization: Bearer EMAIL_CAMPAIGN_CRON_SECRET
```

## Useful Routes

- `GET /api/email-campaign/unsubscribe/:token`
- `POST /api/email-campaign/unsubscribe/:token`
- `GET /api/email-campaign/preferences/:token`
- `GET /api/email-campaign/admin/stats?key=EMAIL_CAMPAIGN_ADMIN_KEY`
- `POST /api/email-campaign/run-due`

## Content

The journey content lives in:

```text
server/data/emailJourneyContent.js
```

The first weeks use the provided Tirth Sutra themes and sample emails. The remaining year is filled with matching Tirth Sutra topics so the system has all 156 emails ready. Replace or edit that file when final blog URLs and copy are available.
