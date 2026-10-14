import {
  prepareEncounterTransferOrchestration,
  type EncounterTransferOrchestrationInput,
} from 'sos-sdk-core-ts/encounter-transfer-communication'

export type AcceptedEncounterHandoverCommit = Readonly<{
  idempotencyKey: string
  communicationThreadId: string
  projectionCommunication: Readonly<Record<string, unknown>>
  expectedProfessionalGroupReferences: readonly string[]
  retainedProfessionalGroupReferences: readonly string[]
  addedProfessionalGroupReferences: readonly string[]
  removedProfessionalGroupReferences: readonly string[]
  nextProfessionalGroupReferences: readonly string[]
  familyJourneyEvent: Readonly<Record<string, unknown>>
}>

export type AcceptedEncounterHandoverReceipt = Readonly<{
  idempotencyKey: string
  outcome: 'committed' | 'already-committed'
  revision: string
}>

export type AcceptedEncounterHandoverPersistence = Readonly<{
  /** Atomically persists every field or none; partial commits are forbidden. */
  commitAcceptedHandover(
    commit: AcceptedEncounterHandoverCommit,
  ): Promise<AcceptedEncounterHandoverReceipt>
}>

/**
 * Prepare and atomically persist one accepted Encounter handover.
 *
 * The injected adapter owns compare-and-swap/idempotency and must commit the
 * provider projection, future professional audience and family-safe journey
 * event as one unit. This service deliberately exposes no sequence of partial
 * persistence callbacks. Authorization and service Group resolution occur in
 * the product BFF before this call; historical Communications are untouched.
 */
export async function persistAcceptedEncounterHandover(
  input: EncounterTransferOrchestrationInput,
  persistence: AcceptedEncounterHandoverPersistence,
): Promise<Readonly<{
  commit: AcceptedEncounterHandoverCommit
  receipt: AcceptedEncounterHandoverReceipt
}>> {
  const plan = prepareEncounterTransferOrchestration(input)
  const reconciliation = plan.audienceReconciliation
  const commit = Object.freeze({
    idempotencyKey: reconciliation.idempotencyKey,
    communicationThreadId: reconciliation.communicationThreadId,
    projectionCommunication: Object.freeze(plan.projectionCommunication),
    expectedProfessionalGroupReferences: Object.freeze([...input.currentProfessionalGroupReferences]),
    retainedProfessionalGroupReferences: reconciliation.retainedProfessionalGroupReferences,
    addedProfessionalGroupReferences: reconciliation.addedProfessionalGroupReferences,
    removedProfessionalGroupReferences: reconciliation.removedProfessionalGroupReferences,
    nextProfessionalGroupReferences: reconciliation.nextProfessionalGroupReferences,
    familyJourneyEvent: reconciliation.familyJourneyEvent,
  }) satisfies AcceptedEncounterHandoverCommit
  const receipt = await persistence.commitAcceptedHandover(commit)
  if (receipt.idempotencyKey !== commit.idempotencyKey) {
    throw new TypeError('encounter_handover_receipt_idempotency_mismatch')
  }
  if (receipt.outcome !== 'committed' && receipt.outcome !== 'already-committed') {
    throw new TypeError('encounter_handover_receipt_outcome_invalid')
  }
  if (!String(receipt.revision || '').trim()) throw new TypeError('encounter_handover_receipt_revision_required')
  return Object.freeze({ commit, receipt: Object.freeze({ ...receipt }) })
}
