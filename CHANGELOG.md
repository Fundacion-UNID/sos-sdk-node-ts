# Changelog

## Unreleased

- Add the 2026 development-owner notice and re-establish the public repository
  from a clean source snapshot while
  retaining this changelog as the package release record.

## 0.1.7 - 2026-10-05

- Add a short-lived HMAC-protected email assertion for exact BFF-to-BFF
  audiences and purposes. It normalizes the authenticated email and fails
  closed for weak secrets, altered payloads, expiry and cross-audience reuse;
  it is not a browser-selected mode or an authorization capability.

## 0.1.6 - 2026-10-04

- Add one atomic accepted-handover persistence boundary for the
  Encounter/EncounterHistory projection, future professional Group audience
  revision and family-safe journey event.

## 0.1.5 - 2026-10-04

- Add the product-neutral confidential channel cache shared by SOSChain,
  VetChain and UHC Next.js BFFs. One profile-and-channel document stores
  materialized FHIR Communication messages behind the unlocked profile's
  confidential-storage adapter, skips already opened source JWEs and keeps
  subject, channel, recipients and payload out of cleartext persistence.

## 0.1.4 - 2026-10-04

- Add the injectable protected Bundle-sync service used by trusted runtimes for
  clinical documents, Consent, emergency contacts and Encounter transfers.
  It persists the exact retryable draft, enforces idempotency and confirms a
  mutation only after authoritative provider readback.
- Pin `sos-sdk-core-ts@0.5.1`, which owns the portable synchronization state
  and response reconciliation contract.

- Link the coordinated clinical accessor adoption boundary and keep optional
  portal/assistant editor work out of the Node adapter until runtime behavior
  is actually required.

## 0.1.3 - 2026-09-27

- Serialize Node test files so package and publication gates cannot exhaust a
  shared developer workstation with parallel workers.
- Require one version change only after grouped changes are merged and tested,
  and preserve every exact published version on an immutable stable branch.

- Add the product-neutral immutable prompt-audio Node runtime with stable
  SHA-256 object keys, durable filesystem storage, concurrent-miss coalescing,
  sequential prewarming and an ElevenLabs multilingual-v2 adapter.
- Correct the package boundary: SOSChain, Vet and UHC may reuse this Node
  runtime while keeping their sector policy in their own SDKs.
- Add a product-neutral, create-only GCS prompt store so identical reviewed
  assets can be reused across Vet, UHC and Connect ICA without sharing live
  OTPs, personalized speech or clinical data.

## 0.1.2

- Add the Node CSPRNG adapter and factory for the shared multi-recipient ML-KEM
  secure-message core used by written and binary-audio payloads.
- Keep Node limited to validated `node:crypto.randomBytes` output; ML-KEM, KDF,
  CEK wrapping and AES content protection remain in runtime-neutral core.

## 0.1.1

- Apply the blocking main-before-publish release contract to the SOSChain Node SDK documentation and repository skills.

## 0.1.0

- Initialize the SOSChain-specific Node SDK above `sos-sdk-core-ts@0.2.0`.
- Add fail-closed authenticated emergency dispatch with HTTPS enforcement,
  idempotency and acknowledgement validation.
