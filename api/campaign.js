/**
 * POST /api/campaign  (scoped to the active client via x-client-id)
 *
 * Actions:
 *   generate-copy   — Ask Claude to write campaign copy (SMS, email, reactivation)
 *   send-sms        — Send SMS to all contacts with a given tag
 *   send-email      — Send email to all contacts with a given tag
 *   reactivation    — Generate + send reactivation SMS+email to cold leads
 *
 * Sends target the active client's Neon contacts (the same ones shown in the
 * dashboard) via the unified messaging layer, using the client's sender identity.
 * Contacts tagged "unsubscribed" are always excluded.
 */

import Anthropic from '@anthropic-ai/sdk'
import { sql, migrate, activeClientId } from './_db.js'
import { sendSMS, sendEmail } from './_messaging.js'

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function auth(req) {
  const token = req.headers['x-dashboard-token'] || req.body?.token
  return token === process.env.DASHBOARD_PASSWORD
}

// ── Audience ───────────────────────────────────────────────────────────────────

async function contactsForTag(cid, tag) {
  const db = sql()
  if (tag && tag.trim()) {
    return db`
      SELECT * FROM contacts
      WHERE client_id = ${cid} AND ${tag} = ANY(tags) AND NOT ('unsubscribed' = ANY(tags))
      ORDER BY created_at DESC
    `
  }
  return db`
    SELECT * FROM contacts
    WHERE client_id = ${cid} AND NOT ('unsubscribed' = ANY(tags))
    ORDER BY created_at DESC
  `
}

async function bulkSMS({ cid, client, tag, message }) {
  const contacts = await contactsForTag(cid, tag)
  const results = []
  for (const contact of contacts) {
    if (!contact.phone) continue
    try {
      await sendSMS({ contact, body: message, client })
      results.push({ contactId: contact.id, status: 'sent' })
    } catch (err) {
      results.push({ contactId: contact.id, status: 'error', error: err.message })
    }
  }
  return { sent: results.filter(r => r.status === 'sent').length, total: contacts.length, results }
}

async function bulkEmail({ cid, client, tag, subject, html, fromName, fromEmail }) {
  const contacts = await contactsForTag(cid, tag)
  const results = []
  for (const contact of contacts) {
    if (!contact.email) continue
    try {
      await sendEmail({ contact, subject, body: html, fromName, fromEmail, client })
      results.push({ contactId: contact.id, status: 'sent' })
    } catch (err) {
      results.push({ contactId: contact.id, status: 'error', error: err.message })
    }
  }
  return { sent: results.filter(r => r.status === 'sent').length, total: contacts.length, results }
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-token, x-client-id')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).end()

  let body
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body } catch {
    return res.status(400).json({ error: 'Invalid JSON' })
  }

  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' })

  await migrate()
  const cid = await activeClientId(req)
  const [client] = await sql()`SELECT * FROM clients WHERE id = ${cid}`
  const { action } = body

  try {
    // ── Generate AI copy ──────────────────────────────────────────────────
    if (action === 'generate-copy') {
      const { type, businessName, offer, tone, audience } = body
      const copy = await generateCopy({
        type,
        businessName: businessName || client?.name,
        offer: offer || client?.offer,
        tone: tone || client?.tone,
        audience,
      })
      return res.status(200).json({ copy })
    }

    // ── Send SMS campaign ─────────────────────────────────────────────────
    if (action === 'send-sms') {
      const { tag, message } = body
      if (!tag || !message) return res.status(400).json({ error: 'tag and message required' })
      const result = await bulkSMS({ cid, client, tag, message })
      return res.status(200).json({ success: true, ...result })
    }

    // ── Send email campaign ───────────────────────────────────────────────
    if (action === 'send-email') {
      const { tag, subject, html, fromName, fromEmail } = body
      if (!tag || !subject || !html) return res.status(400).json({ error: 'tag, subject, and html required' })
      const result = await bulkEmail({ cid, client, tag, subject, html, fromName, fromEmail })
      return res.status(200).json({ success: true, ...result })
    }

    // ── Reactivation campaign — SMS + email to cold leads ─────────────────
    if (action === 'reactivation') {
      const { businessName, offer, tag = 'meta-lead', fromName, fromEmail } = body
      const biz = businessName || client?.name
      const off = offer || client?.offer

      const [sms, subject, emailHtml] = await Promise.all([
        generateCopy({ type: 'reactivation_sms', businessName: biz, offer: off }),
        generateCopy({ type: 'email_subject', businessName: biz, offer: off }),
        generateCopy({ type: 'reactivation_email', businessName: biz, offer: off }),
      ])

      let parsedSubject = subject
      try {
        const arr = JSON.parse(subject)
        parsedSubject = Array.isArray(arr) ? arr[0] : subject
      } catch {}

      const [smsResult, emailResult] = await Promise.all([
        bulkSMS({ cid, client, tag, message: sms }),
        bulkEmail({ cid, client, tag, subject: parsedSubject, html: emailHtml, fromName, fromEmail }),
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
