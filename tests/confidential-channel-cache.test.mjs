// Flow contract: 1) an unlocked profile synchronizes authorized group-recipient Communications for one subject/channel; 2) the BFF opens only unseen source JWEs and materializes the channel as one confidential document; 3) later listing opens that cached document; 4) another profile cannot address it. Authorization invariant: the caller supplies the already-authorized profile storage adapter and group opener. Persistence invariant: the vault receives only hashes, timestamps and JWE, never subject, channel, payload, source CEK or message seed in clear.
import assert from 'node:assert/strict'
import test from 'node:test'

import { ConfidentialChannelCache } from '../dist/confidential-channel-cache.js'

test('stores one protected channel document and skips already materialized source messages', async () => {
  const records = new Map()
  const vault = {
    async get(_collection, id) { return records.get(id) },
    async put(_collection, value) { records.set(value.id, value) },
    async query(_collection, where) {
      return [...records.values()].filter(record => where.every(condition => record[condition.attribute] === condition.equals))
    },
  }
  const adapter = {
    async protect(document) { return { id: document.id, jwe: Buffer.from(JSON.stringify(document.content)).toString('base64url') } },
    async unprotect(document) { return { id: document.id, content: JSON.parse(Buffer.from(document.jwe, 'base64url').toString('utf8')) } },
  }
  let opens = 0
  const cache = new ConfidentialChannelCache(vault)
  const input = {
    profileId: 'profile-one', subjectId: 'did:web:animal.example', channelId: 'Communication/channel-one', adapter,
    messages: [{
      id: 'message-one', channelId: 'Communication/channel-one', sender: 'Organization/clinic',
      recipients: ['Group/subject', 'Group/professional'], sent: '2026-10-04T12:00:00.000Z', envelope: { ciphertext: 'opaque' },
    }],
    open: async () => { opens += 1; return { contentType: 'text/plain', plaintext: new TextEncoder().encode('Pluto is stable.') } },
  }
  await cache.synchronize(input)
  await cache.synchronize(input)

  assert.equal(opens, 1)
  assert.equal(records.size, 1)
  const persisted = JSON.stringify([...records.values()][0])
  assert.doesNotMatch(persisted, /animal\.example|Communication\/channel-one|Pluto is stable|Group\/subject|opaque/)
  assert.deepEqual(await cache.read({
    profileId: 'profile-one', subjectId: 'did:web:animal.example', channelId: 'Communication/channel-one', adapter,
  }), {
    version: 1,
    cursor: '2026-10-04T12:00:00.000Z',
    messages: [{
      id: 'message-one', channelId: 'Communication/channel-one', sender: 'Organization/clinic',
      recipients: ['Group/subject', 'Group/professional'], sent: '2026-10-04T12:00:00.000Z',
      messageKind: 'text', text: 'Pluto is stable.',
    }],
  })
  assert.equal(await cache.read({
    profileId: 'profile-two', subjectId: 'did:web:animal.example', channelId: 'Communication/channel-one', adapter,
  }), undefined)
})
