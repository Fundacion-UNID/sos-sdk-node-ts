# sos-sdk-node-ts

Copyright 2026 Connecting Solution & Applications Ltd.
Licensed under the Apache License, Version 2.0; see [`NOTICE`](NOTICE).

## Public source history

The public repository begins from a clean 2026 source snapshot. The retained
[`CHANGELOG.md`](CHANGELOG.md) records package releases without republishing
the former Git push history.

Accepted Encounter handover persistence and future channel-audience
reconciliation are documented in
[`docs/ENCOUNTER_TRANSFER_AUDIENCE_PERSISTENCE.md`](docs/ENCOUNTER_TRANSFER_AUDIENCE_PERSISTENCE.md).
## Blocking local-first SDK release

The canonical contract is [`SDK_LAYERING.md`](https://github.com/Fundacion-UNID/sos-data-utils-ts/blob/main/docs/SDK_LAYERING.md). Its
indivisible order is **local packages -> full local test matrix -> merge every
validated branch to `main` -> publish bottom-up -> install exact registry
versions and commit lockfiles on `main` -> staging**. Never publish to discover
deterministic failures and never commit a local package reference. Staging
begins only after exact registry packages are installed and verified.


Product-neutral Node adapters for trusted SOSCHAIN runtimes.

```text
gdc-* frozen
    ↓
sos-data-utils-ts
    ↓
sos-sdk-core-ts
    ↓
sos-sdk-node-ts
```

This package owns reusable server-side Node transport, credentials,
persistence, jobs and prompt-audio runtime behavior. It does not own
deterministic data contracts, common authorization or sector policy. Downstream
applications consume it without creating dependencies between one another.

`BundleSyncDraftService` is the trusted-runtime adapter for the shared durable
editor outbox. The application injects protected storage, payload protection
and the real provider executor. The service stores no clear clinical Bundle,
reuses the same idempotent draft after transient failures, and does not report
confirmation until the provider write has been followed by authoritative
readback.

It also does not duplicate the typed clinical Bundle editors exposed by the
GDC Node SDK. Add a SOS Node adapter only when a real shared channel workflow
requires runtime behavior, following the
[clinical accessor adoption matrix](https://github.com/Fundacion-UNID/sos-data-utils-ts/blob/main/docs/CLINICAL_TYPED_ACCESSOR_ADOPTION.md).
Portals and assistants without that editor remain on their verified versions.

The first adapter, `SosEmergencyDispatchClient`, sends an already-authorized
emergency request over HTTPS with a stable idempotency key and validates the
provider acknowledgement. The bearer credential remains only in the trusted
Node runtime.

`sos-sdk-node-ts/bff-email-assertion` lets one authenticated BFF present a
normalized email to one exact receiving BFF for a short-lived, named purpose.
The receiving application still authorizes the operation and should reject
replay where it matters. Never expose the shared secret or let a browser set
the trusted issuer, audience, purpose or identity claims.

## Secure-message CSPRNG adapter

`sos-sdk-node-ts/secure-message-crypto` exports `NodeSecureRandomSource` and
`createNodeSecureMessageCrypto()`. Node supplies only bytes from
`node:crypto.randomBytes`; the runtime-neutral `sos-sdk-core-ts` package owns
ML-KEM, key derivation, recipient CEK wrapping and AES content encryption.

The factory handles UTF-8 text and binary audio through the same byte-oriented
API. Applications select the protected `contentType`, apply their own upload or
audio-duration limits, and authorize every recipient change before calling the
shared core. See [docs/SECURE_MESSAGES.md](docs/SECURE_MESSAGES.md).

## Immutable prompt audio

`sos-sdk-node-ts/prompt-audio-runtime` hashes the canonical descriptor produced
by `sos-data-utils-ts/prompt-audio`, coalesces concurrent misses, persists the
audio and prewarms prompts sequentially. It includes a filesystem adapter for
local execution and an ElevenLabs multilingual-v2 synthesizer. A production
runtime supplies its approved durable-object-store adapter. Complete live OTPs
are never cache entries; ICA composes static prefix and digit assets. See
[docs/PROMPT_AUDIO_RUNTIME.md](docs/PROMPT_AUDIO_RUNTIME.md).

```bash
npm ci
npm run check
```
