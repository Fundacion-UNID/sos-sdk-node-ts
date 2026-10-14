// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import assert from 'node:assert/strict'
import test from 'node:test'

import { FHIR_ENCOUNTER_TRANSFER_TEST_DATA as fixture } from 'fhir-data-utils-ts'
import { BundleSyncKinds, BundleSyncStates, createBundleSyncDraft } from 'sos-sdk-core-ts/bundle-sync-draft'
import { BundleSyncDraftService, BundleSyncRepositoryMemory } from '../dist/index.js'

const resource = Object.freeze({ resourceType: 'Encounter', id: fixture.source.id, meta: { claims: { 'Encounter.identifier': fixture.source.identifier } } })
const entry = Object.freeze({ type: 'Encounter', fullUrl: fixture.source.identifier, resource })
const changesBundle = Object.freeze({ resourceType: 'Bundle', type: 'batch', total: 1, data: Object.freeze([entry]) })
const confirmedBundle = Object.freeze({ resourceType: 'Bundle', type: 'collection', total: 0, data: Object.freeze([]) })
const optimisticBundle = Object.freeze({ resourceType: 'Bundle', type: 'collection', total: 1, data: Object.freeze([entry]) })

function draft() {
  return createBundleSyncDraft({ id: fixture.communicationIdentifier, kind: BundleSyncKinds.EncounterTransfer, subjectReference: fixture.subjectReference, changesBundle, lastConfirmedBundle: confirmedBundle, optimisticBundle, createdAt: fixture.occurredAt })
}

test('persists only a protected Bundle draft and confirms it after authoritative readback', async () => {
  const repository = new BundleSyncRepositoryMemory()
  const protection = {
    protect: async (value) => Buffer.from(JSON.stringify(value)).toString('base64'),
    unprotect: async (value) => JSON.parse(Buffer.from(value, 'base64').toString('utf8')),
  }
  const service = new BundleSyncDraftService({
    repository,
    protection,
    executor: {
      submit: async () => ({ resourceType: 'Bundle', type: 'batch-response', total: 1, data: [{ ...entry, response: { status: '201 Created' } }] }),
      readback: async () => optimisticBundle,
    },
    now: () => new Date(fixture.occurredAt),
  })

  await service.enqueue(draft())
  const stored = await repository.get(fixture.communicationIdentifier)
  assert.equal('changesBundle' in stored, false)
  assert.equal(stored.state, BundleSyncStates.Pending)

  const result = await service.process(fixture.communicationIdentifier)
  assert.equal(result.state, BundleSyncStates.Confirmed)
  assert.equal(result.visibleBundle.data[0].fullUrl, fixture.source.identifier)
})

test('retains one protected retryable draft after a transport error and reuses it on retry', async () => {
  const repository = new BundleSyncRepositoryMemory()
  const protection = {
    protect: async (value) => Buffer.from(JSON.stringify(value)).toString('base64'),
    unprotect: async (value) => JSON.parse(Buffer.from(value, 'base64').toString('utf8')),
  }
  let fail = true
  const service = new BundleSyncDraftService({
    repository,
    protection,
    executor: {
      submit: async () => {
        if (fail) throw new Error('network unavailable')
        return { resourceType: 'Bundle', type: 'batch-response', total: 1, data: [{ ...entry, response: { status: '201 Created' } }] }
      },
      readback: async () => optimisticBundle,
    },
    now: () => new Date(fixture.occurredAt),
  })

  await service.enqueue(draft())
  const retryable = await service.process(fixture.communicationIdentifier)
  assert.equal(retryable.state, BundleSyncStates.Retryable)
  assert.equal(retryable.visibleBundle.data[0].fullUrl, fixture.source.identifier)

  fail = false
  const confirmed = await service.process(fixture.communicationIdentifier)
  assert.equal(confirmed.id, retryable.id)
  assert.equal(confirmed.state, BundleSyncStates.Confirmed)
  assert.equal((await repository.list()).length, 1)
})
