# Immutable prompt audio in Node runtimes

Telephone, portal, chatbot and messaging channels use the same reviewed prompt
identity from `sos-data-utils-ts/prompt-audio`. The application canonicalizes
the public-static descriptor, then passes that opaque canonical value to
`ImmutablePromptAudioCache`.

```text
reviewed prompt descriptor
        ↓ canonicalize in sos-data-utils-ts
canonical JSON
        ↓ SHA-256 in sos-sdk-node-ts
immutable object key
        ↓
durable store ── miss only ──> configured synthesizer
```

The durable store, rather than process memory, is authoritative across
restarts. Concurrent in-process misses are coalesced. Startup prewarming is
sequential so it cannot create a burst of paid requests or exhaust a shared
developer machine.

`FileSystemPromptAudioStore` supports local and demo execution. Production
applications use `GcsPromptAudioStore` or implement `PromptAudioObjectStore`
over another approved object store without changing the cache lifecycle.
One object bucket may be shared by compatible trusted runtimes: the default
object name has no product prefix and reuse occurs only when the complete
canonical descriptor matches. Deployments may configure an isolation prefix
when policy requires separate storage. `ElevenLabsPromptAudioSynthesizer`
defaults to `eleven_multilingual_v2`; API keys stay in the trusted runtime and
are neither logged nor included in an error.

Activation and verification services must never cache a complete live code.
They retain its value, expiry and attempt counter, and compose the call from a
static prefix plus localized digit fragments. Personalized names and clinical
data are not public-static prompts.
