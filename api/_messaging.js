/**
 * Unified messaging client — Twilio (SMS) + Resend (email)
 *
 * Outbound emails automatically get a one-click unsubscribe link + the
 * List-Unsubscribe / List-Unsubscribe-Post headers (RFC 8058). Contacts tagged
 * "unsubscribed" are skipped for both SMS and email.
 */

import crypto from 'crypto'
import twilio from 'twilio'
import { Resend } from 'resend'
import { sql } from './_db.js'

function twilioClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set.')
  return twilio(sid, token)
}

function resendClient() {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY not set.')
  return new Resend(key)
}

function interpolate(template, contact) {
  return (template || '')
    .replace(/\{\{firstName\}\}/g, contact.first_name || '')
    .replace(/\{\{lastName\}\}/g,  contact.last_name  || '')
    .replace(/\{\{fullName\}\}/g,  [contact.first_name, contact.last_name].filter(Boolean).join(' '))
    .replace(/\{\{email\}\}/g,     contact.email || '')
    .replace(/\{\{phone\}\}/g,     contact.phone || '')
}

// ── Unsubscribe helpers ───────────────────────────────────────────────────────

export function baseUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '')
  if (process.env.VERCEL_URL)      return `https://${process.env.VERCEL_URL}`
  return 'https://marketing-hub-ruby.vercel.app'
}

// Lightweight signed token so unsubscribe links can't be trivially forged for
// arbitrary contact IDs. Not security-critical, just tamper-resistant.
export function unsubscribeToken(contactId) {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.DASHBOARD_PASSWORD || 'marketing-hub'
  return crypto.createHmac('sha256', secret).update(String(contactId)).digest('hex').slice(0, 24)
}

export function unsubscribeUrl(contactId) {
  return `${baseUrl()}/api/unsubscribe?c=${encodeURIComponent(contactId)}&t=${unsubscribeToken(contactId)}`
}

function withUnsubscribeFooter(html, url) {
  const footer = `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;line-height:1.5;color:#9ca3af;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">`
    + `You're receiving this email because you opted in. `
    + `<a href="${url}" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a>.`
    + `</div>`
  return `${html || ''}${footer}`
}

function isUnsubscribed(contact) {
  return Array.isArray(contact?.tags) && contact.tags.includes('unsubscribed')
}

// ── Send ──────────────────────────────────────────────────────────────────────

export async function sendSMS({ contact, body, workflowId, stepIndex }) {
  if (isUnsubscribed(contact)) return { skipped: true, reason: 'unsubscribed' }

  const message = interpolate(body, contact)
  const client  = twilioClient()

  const result = await client.messages.create({
    body:   message,
    from:   process.env.TWILIO_PHONE_NUMBER,
    to:     contact.phone,
  })

  await logMessage({ contactId: contact.id, type: 'sms', body: message, status: result.status, metadata: { sid: result.sid, workflowId, stepIndex } })
  return result
}

export async function sendEmail({ contact, subject, body, fromName, fromEmail, workflowId, stepIndex }) {
  if (isUnsubscribed(contact)) return { skipped: true, reason: 'unsubscribed' }

  const interpolatedSubject = interpolate(subject || '', contact)
  const interpolatedBody    = interpolate(body, contact)
  const unsubUrl            = unsubscribeUrl(contact.id)
  const html                = withUnsubscribeFooter(interpolatedBody, unsubUrl)
  const resend              = resendClient()

  const from = fromName && fromEmail
    ? `${fromName} <${fromEmail}>`
    : (process.env.RESEND_FROM_EMAIL || 'noreply@example.com')

  const result = await resend.emails.send({
    from,
    to:      contact.email,
    subject: interpolatedSubject,
    html,
    headers: {
      'List-Unsubscribe':      `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  })

  await logMessage({ contactId: contact.id, type: 'email', subject: interpolatedSubject, body: interpolatedBody, status: 'sent', metadata: { id: result?.data?.id ?? result?.id, workflowId, stepIndex } })
  return result
}

async function logMessage({ contactId, type, subject, body, status, metadata }) {
  try {
    const db = sql()
    await db`
      INSERT INTO messages (contact_id, type, direction, subject, body, status, metadata)
      VALUES (${contactId}, ${type}, 'outbound', ${subject || null}, ${body}, ${status}, ${JSON.stringify(metadata)})
    `
  } catch (err) {
    console.error('[messaging] Failed to log message:', err.message)
  }
}

export { interpolate }
