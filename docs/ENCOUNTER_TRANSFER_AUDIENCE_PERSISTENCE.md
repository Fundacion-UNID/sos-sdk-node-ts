# Accepted Encounter handover persistence

`persistAcceptedEncounterHandover(...)` is the product-neutral Node boundary
for one accepted patient movement. The product BFF authenticates the actor,
authorizes the transition and resolves exact source/destination
`HealthcareService` Group assignments before calling it.

The injected persistence adapter receives one indivisible commit containing:

- the completed Communication Bundle that projects both Encounter updates and
  both EncounterHistory milestones;
- the expected current professional Groups and retained/added/removed/next
  future audience;
- the family-safe journey event;
- one idempotency key and communication-thread identifier.

The adapter must compare-and-swap the expected audience and commit every field
or none. Retrying the same idempotency key returns `already-committed`. It must
not expose separate public callbacks that could persist the Encounter while
failing to update the channel, or vice versa.

```ts
const persisted = await persistAcceptedEncounterHandover(
  authorizedEncounterTransfer,
  {
    commitAcceptedHandover: commit => handoverRepository.commitAtomically(commit),
  },
)

if (persisted.receipt.outcome === 'already-committed') {
  return persisted.receipt
}
```

Historical Communications and their recipient snapshots are never modified.
Subsequent Communications use `nextProfessionalGroupReferences`. The
family-facing channel receives only `familyJourneyEvent` after its independent
recipient and purpose checks.
