/**
 * Automation engine
 *
 * Workflow step types:
 *   send_sms    { body }
 *   send_email  { subject, body, fromName, fromEmail }
 *   add_tag     { tag }
 *   remove_tag  { tag }
 *   wait        { days, hours }   — just advances next_run_at
 *
 * - enrollContact() fires the first step synchronously (speed-to-lead) and drains
 *   any immediately-due steps in one pass.
 * - The cron (every few minutes via an external scheduler) processes all due
 *   enrollments, each drained to completion of its currently-ready steps.
 */

import { sql } from './_db.js'
import { sendSMS, sendEmail } from './_messaging.js'

// Joined, "due"-shaped row for a single enrollment (or null if not currently due).
async function fetchDueEnrollment(enrollmentId) {
  const db = sql()
  const [row] = await db`
    SELECT e.id, e.contact_id, e.workflow_id, e.current_step,
           c.first_name, c.last_name, c.email, c.phone, c.tags, c.metadata, c.client_id,
           w.steps,
           cl.name AS client_name, cl.rep_name, cl.from_name, cl.from_email,
           cl.twilio_number, cl.booking_link, cl.offer
    FROM   enrollments e
    JOIN   contacts    c  ON c.id  = e.contact_id
    JOIN   workflows   w  ON w.id  = e.workflow_id
    LEFT JOIN clients  cl ON cl.id = c.client_id
    WHERE  e.id = ${enrollmentId}
      AND  e.status = 'active'
      AND  e.next_run_at <= now()
      AND  w.active = true
  `
  return row || null
}

// Process steps for one enrollment until it hits a wait, completes, or errors.
async function runEnrollment(enrollmentId) {
  for (let guard = 0; guard < 50; guard++) {
    const row = await fetchDueEnrollment(enrollmentId)
    if (!row) break // waiting (future next_run_at) or no longer active
    const result = await processEnrollmentStep(row)
    if (result.status !== 'advanced') break // completed or error
    // If it advanced into a wait, the next fetch's `next_run_at <= now()` is false → loop ends.
  }
}

export async function enrollContact(contactId, workflowId, clientId) {
  const db = sql()

  // Upsert — re-enroll resets progress. client_id falls back to the contact's.
  await db`
    INSERT INTO enrollments (contact_id, workflow_id, client_id, current_step, status, next_run_at)
    VALUES (${contactId}, ${workflowId},
            COALESCE(${clientId ?? null}::uuid, (SELECT client_id FROM contacts WHERE id = ${contactId})),
            0, 'active', now())
    ON CONFLICT (contact_id, workflow_id)
    DO UPDATE SET current_step = 0, status = 'active', next_run_at = now(), completed_at = NULL
  `

  const [e] = await db`SELECT id FROM enrollments WHERE contact_id = ${contactId} AND workflow_id = ${workflowId}`
  if (e) await runEnrollment(e.id) // fire the first touch immediately + drain ready steps

  return { enrolled: true }
}

export async function processAllDueEnrollments() {
  const db = sql()

  const due = await db`
    SELECT e.id
    FROM   enrollments e
    JOIN   workflows   w ON w.id = e.workflow_id
    WHERE  e.status = 'active'
      AND  e.next_run_at <= now()
      AND  w.active = true
    ORDER BY e.next_run_at ASC
    LIMIT  200
  `

  let processed = 0
  for (const { id } of due) {
    await runEnrollment(id)
    processed++
  }

  return { processed }
}

async function processEnrollmentStep(row) {
  const db      = sql()
  const steps   = row.steps || []
  const stepIdx = row.current_step
  const contact = {
    id: row.contact_id, first_name: row.first_name, last_name: row.last_name,
    email: row.email, phone: row.phone, tags: row.tags, metadata: row.metadata,
    client_id: row.client_id,
  }
  const client = {
    name: row.client_name, rep_name: row.rep_name, from_name: row.from_name,
    from_email: row.from_email, twilio_number: row.twilio_number,
    booking_link: row.booking_link, offer: row.offer,
  }

  if (stepIdx >= steps.length) {
    await db`UPDATE enrollments SET status = 'completed', completed_at = now() WHERE id = ${row.id}`
    return { enrollmentId: row.id, status: 'completed' }
  }

  const step = steps[stepIdx]

  try {
    await executeStep(step, contact, client, row.workflow_id, stepIdx)

    const nextIdx = stepIdx + 1
    if (nextIdx >= steps.length) {
      await db`UPDATE enrollments SET status = 'completed', completed_at = now(), current_step = ${nextIdx} WHERE id = ${row.id}`
      return { enrollmentId: row.id, status: 'completed', step: stepIdx }
    }

    // Look ahead: if the next step is a wait, push next_run_at out by its delay.
    const nextStep = steps[nextIdx]
    const delayMs  = nextStep?.type === 'wait' ? stepDelayMs(nextStep) : 0

    await db`
      UPDATE enrollments
      SET    current_step = ${nextIdx},
             next_run_at  = now() + (${delayMs} || ' milliseconds')::interval
      WHERE  id = ${row.id}
    `

    return { enrollmentId: row.id, status: 'advanced', step: stepIdx, nextStep: nextIdx }
  } catch (err) {
    console.error(`[automation] Step ${stepIdx} failed for enrollment ${row.id}:`, err.message)
    await db`UPDATE enrollments SET status = 'error' WHERE id = ${row.id}`
    return { enrollmentId: row.id, status: 'error', step: stepIdx, error: err.message }
  }
}

async function executeStep(step, contact, client, workflowId, stepIndex) {
  const db = sql()

  if (step.type === 'send_sms') {
    if (!contact.phone) return
    await sendSMS({ contact, body: step.body, client, workflowId, stepIndex })

  } else if (step.type === 'send_email') {
    if (!contact.email) return
    await sendEmail({ contact, subject: step.subject, body: step.body, fromName: step.fromName, fromEmail: step.fromEmail, client, workflowId, stepIndex })

  } else if (step.type === 'add_tag') {
    await db`
      UPDATE contacts SET tags = array_append(tags, ${step.tag}), updated_at = now()
      WHERE id = ${contact.id} AND client_id = ${contact.client_id} AND NOT (${step.tag} = ANY(tags))
    `

  } else if (step.type === 'remove_tag') {
    await db`
      UPDATE contacts SET tags = array_remove(tags, ${step.tag}), updated_at = now()
      WHERE id = ${contact.id} AND client_id = ${contact.client_id}
    `

  } else if (step.type === 'wait') {
    // handled by next_run_at advancement — nothing to execute
  }
}

function stepDelayMs(step) {
  const days    = parseFloat(step.days    || 0)
  const hours   = parseFloat(step.hours   || 0)
  const minutes = parseFloat(step.minutes || 0)
  return Math.round((days * 86400 + hours * 3600 + minutes * 60) * 1000)
}
