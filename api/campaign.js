/**
 * POST /api/campaign
 *
 * Actions:
 *   generate-copy   — Ask Claude to write campaign copy (SMS, email, reactivation)
 *   send-sms        — Send SMS to all contacts with a given tag
 *   send-email      — Send email to all contacts with a given tag
 *   reactivation    — Send reactivation SMS+email to cold leads
 */

import Anthropic from '@anthropic-ai/sdk'
import { sendBulkSMS, sendBulkEmail, getContacts } from './_ghl.js'

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function auth(req) {
  const token = req.headers['x-dashboard-token'] || req.body?.token
  return token === process.env.DASHBOARD_PASSWORD
}

// ── Claude copy generation ───────────────────────────────────────────────────

async function generateCopy({ type, businessName, offer, tone = 'friendly', audience = 'leads' }) {
  const prompts = {
    sms: `Write a concise SMS marketing message (max 160 characters) for ${businessName}.
Offer: ${offer}
Tone: ${tone}
Audience: ${audience}
Include a clear call to action. No emojis unless very fitting. Return ONLY the message text.`,

    email_subject: `Write 3 compelling email subject lines for ${businessName}.
Offer: ${offer}
Tone: ${tone}
Return ONLY a JSON array of 3 strings, no other text.`,

    email_body: `Write a short, high-converting marketing email for ${businessName}.
Offer: ${offer}
Tone: ${tone}
Audience: ${audience}
Format: HTML with inline styles. Keep it under 200 words. Clear CTA button.
Return ONLY the HTML.`,

    reactivation_sms: `Write a reactivation SMS (max 160 characters) for ${businessName} to win back cold leads who haven't responded.
Offer: ${offer}
Make it feel personal and create urgency. Return ONLY the message text.`,

    reactivation_email: `Write a "we miss you" reactivation email for ${businessName}.
Offer: ${offer}
Audience: leads who haven't engaged in 30+ days.
Format: HTML with inline styles. Short, personal, urgent. Clear CTA.
Return ONLY the HTML.`,
  }

  const prompt = prompts[type]
  if (!prompt) throw new Error(`Unknown copy type: ${type}`)

  const msg = await claude.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  return msg.content[0]?.text ?? ''
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-token')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).end()

  let body
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body } catch {
    return res.status(400).json({ error: 'Invalid JSON' })
  }

  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' })

  const { action } = body

  try {
    // ── Generate AI copy ──────────────────────────────────────────────────
    if (action === 'generate-copy') {
      const { type, businessName, offer, tone, audience } = body
      const copy = await generateCopy({ type, businessName, offer, tone, audience })
      return res.status(200).json({ copy })
    }

    // ── Send SMS campaign ─────────────────────────────────────────────────
    if (action === 'send-sms') {
      const { tag, message } = body
      if (!tag || !message) return res.status(400).json({ error: 'tag and message required' })
      const result = await sendBulkSMS({ tag, message })
      return res.status(200).json({ success: true, ...result })
    }

    // ── Send email campaign ───────────────────────────────────────────────
    if (action === 'send-email') {
      const { tag, subject, html, fromName, fromEmail } = body
      if (!tag || !subject || !html) return res.status(400).json({ error: 'tag, subject, and html required' })
      const result = await sendBulkEmail({ tag, subject, html, fromName, fromEmail })
      return res.status(200).json({ success: true, ...result })
    }

    // ── Reactivation campaign — SMS + email to cold leads ─────────────────
    if (action === 'reactivation') {
      const { businessName, offer, tag = 'meta-lead', fromName, fromEmail } = body

      // Generate copy with Claude
      const [sms, subject, emailHtml] = await Promise.all([
        generateCopy({ type: 'reactivation_sms', businessName, offer }),
        generateCopy({ type: 'email_subject', businessName, offer }),
        generateCopy({ type: 'reactivation_email', businessName, offer }),
      ])

      // Parse subject (Claude returns a JSON array of 3 options — take the first)
      let parsedSubject = subject
      try {
        const arr = JSON.parse(subject)
        parsedSubject = Array.isArray(arr) ? arr[0] : subject
      } catch {}

      // Send both in parallel
      const [smsResult, emailResult] = await Promise.all([
        sendBulkSMS({ tag, message: sms }),
        sendBulkEmail({ tag, subject: parsedSubject, html: emailHtml, fromName, fromEmail }),
      ])

      return res.status(200).json({
        success: true,
        sms: { copy: sms, ...smsResult },
        email: { subject: parsedSubject, ...emailResult },
      })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err) {
    console.error('[api/campaign]', err)
    return res.status(500).json({ error: err.message })
  }
}
