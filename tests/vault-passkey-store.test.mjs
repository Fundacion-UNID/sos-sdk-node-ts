// Flow contract: passkey ceremonies and grants use the shared transactional vault, reject replay and consume access exactly once without importing a database adapter.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createVaultServerPasskeyStore, TransactionalMemoryVaultRepository } from '../dist/index.js'

test('registers atomically, updates a verified counter and consumes one competing access grant', async () => {
  const vault = new TransactionalMemoryVaultRepository()
  const store = createVaultServerPasskeyStore(vault, { credentials: 'credentials', ceremonies: 'ceremonies', access: 'access' })
  const ceremony = { kind: 'registration', challenge: 'test-challenge', ownerId: 'owner', loginIdentifier: 'login', profileId: 'profile', expiresAt: new Date(Date.now() + 60_000).toISOString() }
  const credential = { credentialId: 'credential', publicKey: 'test-public-key', counter: 0, ownerId: 'owner', loginIdentifier: 'login', profileId: 'profile', sealedUnlockSecret: 'sealed', deviceType: 'singleDevice', backedUp: false, createdAt: new Date().toISOString() }
  await store.putCeremony('registration', ceremony)
  await store.completeRegistration('registration', 'credential-key', credential)
  assert.deepEqual(await store.getCredential('credential-key'), credential)
  assert.equal(await store.getCeremony('registration'), undefined)
  await assert.rejects(store.completeRegistration('registration', 'another-key', credential), /ceremony/)
  assert.equal(await store.getCredential('another-key'), undefined)
  assert.equal((await store.listCredentials('other-login')).length, 0)
  assert.equal((await store.listCredentials('login', 'other-profile')).length, 0)
  const access = { ownerId: 'owner', loginIdentifier: 'login', profileId: 'profile', credentialKey: 'credential-key', createdAt: new Date().toISOString(), expiresAt: ceremony.expiresAt }
  await store.putCeremony('authentication', { ...ceremony, kind: 'authentication' })
  await store.completeAuthentication('authentication', 'credential-key', 1, 'access-key', access)
  assert.equal((await store.getCredential('credential-key')).counter, 1)
  const results = await Promise.all([store.consumeAccess('access-key'), store.consumeAccess('access-key')])
  assert.equal(results.filter(Boolean).length, 1)
  await assert.rejects(store.completeAuthentication('authentication', 'credential-key', 1, 'duplicate-access', access), /ceremony/)
  assert.equal(await store.consumeAccess('duplicate-access'), undefined)
  await store.putCeremony('counter-replay', { ...ceremony, kind: 'authentication' })
  await assert.rejects(store.completeAuthentication('counter-replay', 'credential-key', 1, 'replayed-access', access), /counter_replayed/)
  assert.ok(await store.getCeremony('counter-replay'))
  assert.equal(await store.consumeAccess('replayed-access'), undefined)
  assert.equal((await store.getCredential('credential-key')).counter, 1)
})
