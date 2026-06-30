/**
 * Unified messaging client — Twilio (SMS) + Resend (email)
 *
 * Sends use the client's sender identity (rep name, from email, Twilio number,
 * booking link) and support per-client merge tags. Outbound emails get a one-click
 * unsubscribe link + List-Unsubscribe headers. Contacts tagged "unsubscribed" are
 * skipped for both SMS and email.
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

function interpolate(template, contact, client = {}) {
  const firstName    = contact.first_name  || ''
  const lastName     = contact.last_name   || ''
  const fullName     = [firstName, lastName].filter(Boolean).join(' ')
  const businessName = client.name || client.business_name || client.business || ''
  const repName      = client.rep_name      || ''
  const offer        = client.offer         || ''
  const bookingLink  = client.booking_link  || ''
  const fromName     = client.from_name     || repName

  return (template || '')
    // snake_case (used in templates)
    .replace(/\{\{first_name\}\}/gi,    firstName)
    .replace(/\{\{last_name\}\}/gi,     lastName)
    .replace(/\{\{full_name\}\}/gi,     fullName)
    .replace(/\{\{business_name\}\}/gi, businessName)
    .replace(/\{\{rep_name\}\}/gi,      repName)
    .replace(/\{\{from_name\}\}/gi,     fromName)
    .replace(/\{\{offer\}\}/gi,         offer)
    .replace(/\{\{booking_link\}\}/gi,  bookingLink)
    .replace(/\{\{email\}\}/gi,         contact.email || '')
    .replace(/\{\{phone\}\}/gi,         contact.phone || '')
    // camelCase (legacy — keep working)
    .replace(/\{\{firstName\}\}/g,      firstName)
    .replace(/\{\{lastName\}\}/g,       lastName)
    .replace(/\{\{fullName\}\}/g,       fullName)
    .replace(/\{\{business\}\}/g,       businessName)
    .replace(/\{\{repName\}\}/g,        repName)
    .replace(/\{\{bookingLink\}\}/g,    bookingLink)
    // fallback: strip any remaining unreplaced {{...}} so they don't ship raw
    .replace(/\{\{[^}]+\}\}/g, '')
}

// ── Unsubscribe helpers ───────────────────────────────────────────────────────

export function baseUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '')
  if (process.env.VERCEL_URL)      return `https://${process.env.VERCEL_URL}`
  return 'https://marketing-hub-ruby.vercel.app'
}

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

export async function sendSMS({ contact, body, client = {}, workflowId, stepIndex }) {
  if (isUnsubscribed(contact)) return { skipped: true, reason: 'unsubscribed' }

  const message = interpolate(body, contact, client)
  const tw      = twilioClient()
  const from    = client.twilio_number || process.env.TWILIO_PHONE_NUMBER

  const result = await tw.messages.create({
    body:   message,
    from,
    to:     contact.phone,
  })

  await logMessage({ contact, type: 'sms', body: message, status: result.status, metadata: { sid: result.sid, workflowId, stepIndex } })
  return result
}

export async function sendEmail({ contact, subject, body, fromName, fromEmail, client = {}, workflowId, stepIndex }) {
  if (isUnsubscribed(contact)) return { skipped: true, reason: 'unsubscribed' }

  const interpolatedSubject = interpolate(subject || '', contact, client)
  const interpolatedBody    = interpolate(body, contact, client)
  const unsubUrl            = unsubscribeUrl(contact.id)
  const html                = withUnsubscribeFooter(interpolatedBody, unsubUrl)
  const resend              = resendClient()

  const name  = fromName  || client.from_name  || client.rep_name
  const email = fromEmail || client.from_email || process.env.RESEND_FROM_EMAIL
  const from  = name && email ? `${name} <${email}>` : (email || process.env.RESEND_FROM_EMAIL || 'noreply@example.com')

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

  await logMessage({ contact, type: 'email', subject: interpolatedSubject, body: interpolatedBody, status: 'sent', metadata: { id: result?.data?.id ?? result?.id, workflowId, stepIndex } })
  return result
}

async function logMessage({ contact, type, subject, body, status, metadata }) {
  try {
    const db = sql()
    await db`
      INSERT INTO messages (client_id, contact_id, type, direction, subject, body, status, metadata)
      VALUES (${contact.client_id ?? null}, ${contact.id}, ${type}, 'outbound', ${subject || null}, ${body}, ${status}, ${JSON.stringify(metadata)})
    `
  } catch (err) {
    console.error('[messaging] Failed to log message:', err.message)
  }
}

export { interpolate }
