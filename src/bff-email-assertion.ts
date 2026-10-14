import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

const MAXIMUM_LIFETIME_SECONDS = 5 * 60

export type BffEmailAssertion = Readonly<{
  issuer: string
  audience: string
  purpose: string
  email: string
  assertionId: string
  issuedAt: number
  expiresAt: number
}>

type CreateInput = Readonly<{
  issuer: string
  audience: string
  purpose: string
  email: string
  secret: string
  now?: Date
  lifetimeSeconds?: number
}>

type VerifyInput = Readonly<{
  issuer: string
  audience: string
  purpose: string
  secret: string
  now?: Date
}>

/**
 * Issues a minimal, short-lived identity assertion from one trusted BFF to an
 * exact receiving BFF. It is not a browser mode switch or an authorization
 * capability; the receiver must still enforce the requested operation.
 */
export function createBffEmailAssertion(input: CreateInput): string {
  const secret = validatedSecret(input.secret)
  const issuedAt = epochSeconds(input.now ?? new Date())
  const lifetimeSeconds = input.lifetimeSeconds ?? 120
  if (!Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > MAXIMUM_LIFETIME_SECONDS) {
    throw new Error('bff_assertion_lifetime_invalid')
  }
  const payload: BffEmailAssertion = Object.freeze({
    issuer: absoluteUrl(input.issuer, 'bff_assertion_issuer_invalid'),
    audience: absoluteUrl(input.audience, 'bff_assertion_audience_invalid'),
    purpose: required(input.purpose, 'bff_assertion_purpose_invalid'),
    email: normalizedEmail(input.email),
    assertionId: randomUUID(),
    issuedAt,
    expiresAt: issuedAt + lifetimeSeconds,
  })
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${signature(encoded, secret)}`
}

export function verifyBffEmailAssertion(assertion: string, input: VerifyInput): BffEmailAssertion {
  const secret = validatedSecret(input.secret)
  const [encoded, receivedSignature, extra] = assertion.split('.')
  if (!encoded || !receivedSignature || extra) throw new Error('bff_assertion_format_invalid')
  const expectedSignature = signature(encoded, secret)
  const received = Buffer.from(receivedSignature, 'base64url')
  const expected = Buffer.from(expectedSignature, 'base64url')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error('bff_assertion_signature_invalid')
  const payload = parsePayload(encoded)
  if (payload.issuer !== absoluteUrl(input.issuer, 'bff_assertion_issuer_invalid')) throw new Error('bff_assertion_issuer_mismatch')
  if (payload.audience !== absoluteUrl(input.audience, 'bff_assertion_audience_invalid')) throw new Error('bff_assertion_audience_mismatch')
  if (payload.purpose !== required(input.purpose, 'bff_assertion_purpose_invalid')) throw new Error('bff_assertion_purpose_mismatch')
  const now = epochSeconds(input.now ?? new Date())
  if (payload.expiresAt <= now) throw new Error('bff_assertion_expired')
  if (payload.issuedAt > now || payload.expiresAt - payload.issuedAt > MAXIMUM_LIFETIME_SECONDS) throw new Error('bff_assertion_time_invalid')
  return payload
}

function parsePayload(encoded: string): BffEmailAssertion {
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<BffEmailAssertion>
    if (!value || typeof value !== 'object'
      || typeof value.issuer !== 'string' || typeof value.audience !== 'string'
      || typeof value.purpose !== 'string' || typeof value.email !== 'string'
      || typeof value.assertionId !== 'string' || typeof value.issuedAt !== 'number'
      || typeof value.expiresAt !== 'number') throw new Error('invalid')
    return Object.freeze({
      issuer: absoluteUrl(value.issuer, 'bff_assertion_payload_invalid'),
      audience: absoluteUrl(value.audience, 'bff_assertion_payload_invalid'),
      purpose: required(value.purpose, 'bff_assertion_payload_invalid'),
      email: normalizedEmail(value.email),
      assertionId: required(value.assertionId, 'bff_assertion_payload_invalid'),
      issuedAt: value.issuedAt,
      expiresAt: value.expiresAt,
    })
  } catch (reason) {
    if (reason instanceof Error && reason.message.startsWith('bff_assertion_')) throw reason
    throw new Error('bff_assertion_payload_invalid')
  }
}

function signature(encoded: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(encoded).digest('base64url')
}

function validatedSecret(value: string): Buffer {
  const secret = Buffer.from(value, 'utf8')
  if (secret.length < 32) throw new Error('bff_assertion_secret_invalid')
  return secret
}

function normalizedEmail(value: string): string {
  const email = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('bff_assertion_email_invalid')
  return email
}

function required(value: string, issue: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(issue)
  return normalized
}

function absoluteUrl(value: string, issue: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error(issue)
    return url.href.replace(/\/$/, '')
  } catch {
    throw new Error(issue)
  }
}

function epochSeconds(value: Date): number {
  const milliseconds = value.getTime()
  if (!Number.isFinite(milliseconds)) throw new Error('bff_assertion_time_invalid')
  return Math.floor(milliseconds / 1_000)
}
