# Marketing Hub

GHL + Meta Ads + Claude AI — automated lead capture and campaign management.

## What it does

- **Meta Lead Ads → GHL**: Every lead form submission instantly creates a contact in GoHighLevel
- **Auto-enrollment**: New leads are enrolled in a GHL workflow automatically
- **AI Campaigns**: Claude writes your SMS, email, and reactivation copy
- **Dashboard**: View all leads, build and send campaigns in one place

## Setup

### 1. Deploy to Vercel

Push this repo to GitHub, then import it in [vercel.com](https://vercel.com).

### 2. Set environment variables in Vercel

| Variable | Where to get it |
|---|---|
| `GHL_API_KEY` | GHL → Settings → Integrations → API |
| `GHL_LOCATION_ID` | GHL → Settings → Business Profile |
| `GHL_META_WORKFLOW_ID` | (Optional) GHL workflow ID to auto-enroll new Meta leads |
| `META_WEBHOOK_VERIFY_TOKEN` | Any secret string you choose |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `DASHBOARD_PASSWORD` | Any password you choose |

### 3. Connect Meta Lead Ads webhook

In [Meta Business Manager](https://business.facebook.com) → All Tools → Webhooks:
1. Click **Add Webhook** → Page
2. Callback URL: `https://your-app.vercel.app/api/webhook-meta`
3. Verify token: your `META_WEBHOOK_VERIFY_TOKEN`
4. Subscribe to: **leadgen**

### 4. Open the dashboard

Go to `https://your-app.vercel.app` and enter your `DASHBOARD_PASSWORD`.

## Campaigns

- **SMS**: Send a text to all contacts with a specific tag (default: `meta-lead`)
- **Email**: Send an HTML email to tagged contacts
- **Reactivation**: Claude writes both SMS + email, sent simultaneously to re-engage cold leads
