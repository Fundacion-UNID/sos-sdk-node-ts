// Flow contract: 1) prepare one accepted Encounter handover through the shared high-level SDK; 2) submit the Encounter projection, future professional audience revision and family-safe journey event to one atomic persistence method; 3) return the same receipt for an idempotent retry. Authorization invariant: the runtime receives already-authorized exact HealthcareService Group assignments and never derives access from membership. Persistence invariant: an adapter cannot commit only one part of the handover and historical Communication recipients remain unchanged.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EncounterClaim,
  EncounterStatusR5,
  FHIR_ENCOUNTER_TRANSFER_TEST_DATA as fixture,
} from 'fhir-data-utils-ts'
import { CareJourneyMovementKind } from 'sos-sdk-core-ts/encounter-transfer-communication'
import { persistAcceptedEncounterHandover } from '../dist/encounter-transfer-audience-service.js'

const sourceDepartmentReference = fixture.senderReference
const destinationDepartmentReference = `Organization/destination-${fixture.destination.id}`
const sourceGroupReference = `Group/source-${fixture.source.id}`
const destinationGroupReference = `Group/destination-${fixture.destination.id}`

function encounterResource(stage, status) {
  return {
    resourceType: 'Encounter',
    id: stage.id,
    meta: { claims: {
      [EncounterClaim.Identifier]: stage.identifier,
      [EncounterClaim.Status]: status,
      [EncounterClaim.Subject]: fixture.subjectReference,
      [EncounterClaim.ServiceType]: stage.serviceReference,
      [EncounterClaim.ServiceProvider]: fixture.senderReference,
      [EncounterClaim.Location]: stage.locationReference,
      [EncounterClaim.ActualPeriodStart]: fixture.occurredAt,
    } },
  }
}

function input() {
  return {
    communicationIdentifier: fixture.communicationIdentifier,
    communicationThreadId: fixture.communicationIdentifier,
    subjectReference: fixture.subjectReference,
    departmentSenderReference: fixture.senderReference,
    indexRecipientReferences: [fixture.indexRecipientReference],
    occurredAt: fixture.occurredAt,
    sourceDisposition: 'not-returning',
    movementKind: CareJourneyMovementKind.PermanentTransfer,
    sourceEncounter: encounterResource(fixture.source, EncounterStatusR5.InProgress),
    destinationEncounter: encounterResource(fixture.destination, EncounterStatusR5.Planned),
    sourceHistoryIdentifier: fixture.sourceHistory.identifier,
    destinationHistoryIdentifier: fixture.destinationHistory.identifier,
    encounterClass: fixture.class,
    sourceAssignments: [{
      groupReference: sourceGroupReference,
      departmentOrganizationReference: sourceDepartmentReference,
      healthcareServiceReference: fixture.source.serviceReference,
    }],
    destinationAssignments: [{
      groupReference: destinationGroupReference,
      departmentOrganizationReference: destinationDepartmentReference,
      healthcareServiceReference: fixture.destination.serviceReference,
    }],
    currentProfessionalGroupReferences: [sourceGroupReference],
    handoverAccepted: true,
  }
}

test('commits the projection, channel audience and family event through one atomic adapter call', async () => {
  const commits = []
  const persistence = {
    commitAcceptedHandover: async commit => {
      commits.push(commit)
      return Object.freeze({
        idempotencyKey: commit.idempotencyKey,
        outcome: 'committed',
        revision: fixture.destination.identifier,
      })
    },
  }

  const result = await persistAcceptedEncounterHandover(input(), persistence)

  assert.equal(commits.length, 1)
  assert.equal(commits[0].projectionCommunication.resourceType, 'Bundle')
  assert.deepEqual(commits[0].expectedProfessionalGroupReferences, [sourceGroupReference])
  assert.deepEqual(commits[0].nextProfessionalGroupReferences, [destinationGroupReference])
  assert.equal(commits[0].familyJourneyEvent.subjectReference, fixture.subjectReference)
  assert.equal('professionalGroupReferences' in commits[0].familyJourneyEvent, false)
  assert.equal(result.receipt.outcome, 'committed')
})

test('accepts an idempotent adapter receipt and rejects a receipt for another handover', async () => {
  const expectedInput = input()
  const alreadyCommitted = await persistAcceptedEncounterHandover(expectedInput, {
    commitAcceptedHandover: async commit => Object.freeze({
      idempotencyKey: commit.idempotencyKey,
      outcome: 'already-committed',
      revision: fixture.destination.identifier,
    }),
  })
  assert.equal(alreadyCommitted.receipt.outcome, 'already-committed')

  await assert.rejects(() => persistAcceptedEncounterHandover(expectedInput, {
    commitAcceptedHandover: async () => Object.freeze({
      idempotencyKey: fixture.source.identifier,
      outcome: 'committed',
      revision: fixture.destination.identifier,
    }),
  }), /encounter_handover_receipt_idempotency_mismatch/)
})
