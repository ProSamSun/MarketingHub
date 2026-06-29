/**
 * Unified messaging client — Twilio (SMS) + Resend (email)
 */

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
  return template
    .replace(/\{\{firstName\}\}/g, contact.first_name || '')
    .replace(/\{\{lastName\}\}/g,  contact.last_name  || '')
    .replace(/\{\{fullName\}\}/g,  [contact.first_name, contact.last_name].filter(Boolean).join(' '))
    .replace(/\{\{email\}\}/g,     contact.email || '')
    .replace(/\{\{phone\}\}/g,     contact.phone || '')
}

export async function sendSMS({ contact, body, workflowId, stepIndex }) {
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
  const interpolatedSubject = interpolate(subject || '', contact)
  const interpolatedBody    = interpolate(body, contact)
  const resend = resendClient()

  const from = fromName && fromEmail
    ? `${fromName} <${fromEmail}>`
    : (process.env.RESEND_FROM_EMAIL || 'noreply@example.com')

  const result = await resend.emails.send({
    from,
    to:      contact.email,
    subject: interpolatedSubject,
    html:    interpolatedBody,
  })

  await logMessage({ contactId: contact.id, type: 'email', subject: interpolatedSubject, body: interpolatedBody, status: 'sent', metadata: { id: result.id, workflowId, stepIndex } })
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
