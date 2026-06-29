/**
 * Automation engine
 *
 * Workflow step types:
 *   send_sms    { body }
 *   send_email  { subject, body, fromName, fromEmail }
 *   add_tag     { tag }
 *   remove_tag  { tag }
 *   wait        { days, hours }   — just advances next_run_at
 *   condition   { field, operator, value, if_yes: [...steps], if_no: [...steps] }
 *
 * Cron calls processAllDueEnrollments() every hour.
 */

import { sql } from './_db.js'
import { sendSMS, sendEmail } from './_messaging.js'

export async function enrollContact(contactId, workflowId) {
  const db = sql()

  // Upsert — re-enroll resets progress
  await db`
    INSERT INTO enrollments (contact_id, workflow_id, current_step, status, next_run_at)
    VALUES (${contactId}, ${workflowId}, 0, 'active', now())
    ON CONFLICT (contact_id, workflow_id)
    DO UPDATE SET current_step = 0, status = 'active', next_run_at = now(), completed_at = NULL
  `
  return { enrolled: true }
}

export async function processAllDueEnrollments() {
  const db = sql()

  const due = await db`
    SELECT e.id, e.contact_id, e.workflow_id, e.current_step,
           c.first_name, c.last_name, c.email, c.phone, c.tags, c.metadata,
           w.steps
    FROM   enrollments e
    JOIN   contacts    c ON c.id = e.contact_id
    JOIN   workflows   w ON w.id = e.workflow_id
    WHERE  e.status = 'active'
      AND  e.next_run_at <= now()
      AND  w.active = true
    LIMIT  100
  `

  const results = []
  for (const row of due) {
    const result = await processEnrollmentStep(row)
    results.push(result)
  }

  return { processed: results.length, results }
}

async function processEnrollmentStep(row) {
  const db       = sql()
  const steps    = row.steps || []
  const stepIdx  = row.current_step
  const contact  = { id: row.contact_id, first_name: row.first_name, last_name: row.last_name, email: row.email, phone: row.phone, tags: row.tags, metadata: row.metadata }

  if (stepIdx >= steps.length) {
    await db`UPDATE enrollments SET status = 'completed', completed_at = now() WHERE id = ${row.id}`
    return { enrollmentId: row.id, status: 'completed' }
  }

  const step = steps[stepIdx]

  try {
    await executeStep(step, contact, row.workflow_id, stepIdx)

    // Figure out next step and when to run it
    const nextIdx = stepIdx + 1
    if (nextIdx >= steps.length) {
      await db`UPDATE enrollments SET status = 'completed', completed_at = now(), current_step = ${nextIdx} WHERE id = ${row.id}`
      return { enrollmentId: row.id, status: 'completed', step: stepIdx }
    }

    // Look ahead for wait step
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

async function executeStep(step, contact, workflowId, stepIndex) {
  const db = sql()

  if (step.type === 'send_sms') {
    if (!contact.phone) return
    await sendSMS({ contact, body: step.body, workflowId, stepIndex })

  } else if (step.type === 'send_email') {
    if (!contact.email) return
    await sendEmail({ contact, subject: step.subject, body: step.body, fromName: step.fromName, fromEmail: step.fromEmail, workflowId, stepIndex })

  } else if (step.type === 'add_tag') {
    await db`
      UPDATE contacts SET tags = array_append(tags, ${step.tag}), updated_at = now()
      WHERE id = ${contact.id} AND NOT (${step.tag} = ANY(tags))
    `

  } else if (step.type === 'remove_tag') {
    await db`
      UPDATE contacts SET tags = array_remove(tags, ${step.tag}), updated_at = now()
      WHERE id = ${contact.id}
    `

  } else if (step.type === 'wait') {
    // wait is handled by next_run_at advancement — nothing to execute
  }
  // condition support: skip for now, treat as no-op
}

function stepDelayMs(step) {
  const days  = parseFloat(step.days  || 0)
  const hours = parseFloat(step.hours || 0)
  return Math.round((days * 24 * 60 * 60 + hours * 3600) * 1000)
}
