// Flow contract: 1) an authenticated BFF issues a short-lived email assertion for one exact audience and purpose; 2) the receiving BFF verifies signature, issuer, audience, purpose and time; 3) altered, expired, cross-audience or weak-secret assertions fail closed; 4) the browser never chooses trusted identity claims.
import assert from 'node:assert/strict'
import test from 'node:test'

import { createBffEmailAssertion, verifyBffEmailAssertion } from '../dist/bff-email-assertion.js'

const SECRET = 'test-only-'.repeat(4)
const ISSUER = 'https://personal.example'
const AUDIENCE = 'https://professional.example/api/demo/controller-notifications'
const PURPOSE = 'demo-animal-controller'
const NOW = new Date('2026-10-05T12:00:00.000Z')

test('issues and verifies one normalized short-lived BFF email assertion', () => {
  const assertion = createBffEmailAssertion({
    issuer: ISSUER, audience: AUDIENCE, purpose: PURPOSE, email: 'Controller.Demo@Example.org',
    secret: SECRET, now: NOW, lifetimeSeconds: 120,
  })
  const verified = verifyBffEmailAssertion(assertion, {
    issuer: ISSUER, audience: AUDIENCE, purpose: PURPOSE, secret: SECRET,
    now: new Date(NOW.getTime() + 60_000),
  })

  assert.equal(verified.email, 'controller.demo@example.org')
  assert.equal(verified.issuer, ISSUER)
  assert.equal(verified.audience, AUDIENCE)
  assert.equal(verified.purpose, PURPOSE)
  assert.match(verified.assertionId, /^[0-9a-f-]{36}$/)
})

test('fails closed for tampering, expiry, wrong audience and weak secrets', () => {
  const assertion = createBffEmailAssertion({
    issuer: ISSUER, audience: AUDIENCE, purpose: PURPOSE, email: 'controller.demo@example.org',
    secret: SECRET, now: NOW, lifetimeSeconds: 60,
  })
  assert.throws(() => verifyBffEmailAssertion(`${assertion}x`, { issuer: ISSUER, audience: AUDIENCE, purpose: PURPOSE, secret: SECRET, now: NOW }), /signature/)
  assert.throws(() => verifyBffEmailAssertion(assertion, { issuer: ISSUER, audience: `${AUDIENCE}/other`, purpose: PURPOSE, secret: SECRET, now: NOW }), /audience/)
  assert.throws(() => verifyBffEmailAssertion(assertion, { issuer: ISSUER, audience: AUDIENCE, purpose: PURPOSE, secret: SECRET, now: new Date(NOW.getTime() + 61_000) }), /expired/)
  assert.throws(() => createBffEmailAssertion({ issuer: ISSUER, audience: AUDIENCE, purpose: PURPOSE, email: 'controller.demo@example.org', secret: 'weak', now: NOW }), /secret/)
})
