// Flow contract: every Node channel reuses one durable immutable prompt object, coalesces concurrent misses and prewarms sequentially without retaining credentials or live verification codes.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  ElevenLabsPromptAudioSynthesizer,
  FileSystemPromptAudioStore,
  GcsPromptAudioStore,
  ImmutablePromptAudioCache,
  buildPromptAudioObjectKey,
  prewarmPromptAudioSequentially,
} from '../dist/prompt-audio-runtime.js';

const TEST_RESULTS_DIRECTORY = path.resolve('.test-results');
const CANONICAL_PUBLIC_PROMPT = JSON.stringify({
  version: 1,
  promptId: 'verification.instructions',
  locale: 'en-CA',
  text: 'Press one to continue.',
  voiceProfile: 'accessible-neutral',
  speakingRate: 0.9,
  synthesisEngine: 'reviewed-provider',
  engineModel: 'multilingual-v2',
  pronunciationVersion: '1',
  audioCodec: 'audio/mpeg;rate=44100',
  cachePolicy: 'public-static',
});

async function withStore(run) {
  await mkdir(TEST_RESULTS_DIRECTORY, { recursive: true });
  const directory = await mkdtemp(path.join(TEST_RESULTS_DIRECTORY, 'prompt-audio-'));
  try {
    await run(new FileSystemPromptAudioStore(directory), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('derives a stable opaque object key from the canonical shared descriptor', () => {
  const first = buildPromptAudioObjectKey(CANONICAL_PUBLIC_PROMPT, 'mp3');
  const second = buildPromptAudioObjectKey(CANONICAL_PUBLIC_PROMPT, '.mp3');

  assert.equal(first, second);
  assert.match(first, /^prompt-audio\/sha256\/[a-f0-9]{64}\.mp3$/);
  assert.notEqual(first, buildPromptAudioObjectKey(`${CANONICAL_PUBLIC_PROMPT} `, 'mp3'));
  assert.throws(() => buildPromptAudioObjectKey('', 'mp3'), /prompt_audio_canonical_descriptor_required/);
  assert.throws(() => buildPromptAudioObjectKey(CANONICAL_PUBLIC_PROMPT, '../mp3'), /prompt_audio_extension_invalid/);
});

test('coalesces concurrent misses and reuses the durable object after runtime restart', async () => {
  await withStore(async (store, directory) => {
    let synthesisCount = 0;
    const synthesize = async () => {
      synthesisCount += 1;
      return Uint8Array.from([0x49, 0x44, 0x33, 0x04]);
    };
    const cache = new ImmutablePromptAudioCache(store);

    const [first, second] = await Promise.all([
      cache.getOrCreate({ canonicalDescriptor: CANONICAL_PUBLIC_PROMPT, extension: 'mp3', synthesize }),
      cache.getOrCreate({ canonicalDescriptor: CANONICAL_PUBLIC_PROMPT, extension: 'mp3', synthesize }),
    ]);

    assert.equal(synthesisCount, 1);
    assert.equal(first.created, true);
    assert.equal(second.objectKey, first.objectKey);
    assert.deepEqual(second.audio, first.audio);

    const restartedCache = new ImmutablePromptAudioCache(new FileSystemPromptAudioStore(directory));
    const afterRestart = await restartedCache.getOrCreate({
      canonicalDescriptor: CANONICAL_PUBLIC_PROMPT,
      extension: 'mp3',
      synthesize: async () => {
        throw new Error('synthesis_must_not_run_after_restart');
      },
    });
    assert.equal(afterRestart.created, false);
    assert.deepEqual(afterRestart.audio, first.audio);
    assert.deepEqual(new Uint8Array(await readFile(path.join(directory, first.objectKey))), first.audio);
  });
});

test('prewarms one prompt at a time and fails at the first invalid asset', async () => {
  let active = 0;
  let maximumActive = 0;
  const visited = [];
  const result = await prewarmPromptAudioSequentially(['first', 'second', 'third'], async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    visited.push(value);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return value;
  });

  assert.equal(maximumActive, 1);
  assert.deepEqual(visited, ['first', 'second', 'third']);
  assert.deepEqual(result, ['first', 'second', 'third']);
  await assert.rejects(
    () => prewarmPromptAudioSequentially(['valid', 'invalid', 'unreached'], async (value) => {
      if (value === 'invalid') throw new Error('asset_invalid');
      return value;
    }),
    /asset_invalid/,
  );
});

test('shares product-neutral immutable objects through a create-only GCS bucket', async () => {
  const objects = new Map();
  const saves = [];
  const bucket = {
    file(name) {
      return {
        async download() {
          if (!objects.has(name)) throw Object.assign(new Error('not found'), { code: 404 });
          return [Buffer.from(objects.get(name))];
        },
        async save(bytes, options) {
          saves.push({ name, options });
          if (objects.has(name)) throw Object.assign(new Error('already exists'), { code: 412 });
          objects.set(name, Uint8Array.from(bytes));
        },
      };
    },
  };
  const store = new GcsPromptAudioStore(bucket);
  const cache = new ImmutablePromptAudioCache(store);
  const first = await cache.getOrCreate({
    canonicalDescriptor: CANONICAL_PUBLIC_PROMPT,
    extension: 'mp3',
    synthesize: async () => Uint8Array.from([0x49, 0x44, 0x33]),
  });
  const reusedByAnotherProduct = await new ImmutablePromptAudioCache(new GcsPromptAudioStore(bucket)).getOrCreate({
    canonicalDescriptor: CANONICAL_PUBLIC_PROMPT,
    extension: 'mp3',
    synthesize: async () => { throw new Error('shared_object_must_be_reused'); },
  });

  assert.equal(first.objectKey, reusedByAnotherProduct.objectKey);
  assert.equal(reusedByAnotherProduct.created, false);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].name, first.objectKey);
  assert.deepEqual(saves[0].options.preconditionOpts, { ifGenerationMatch: 0 });
  assert.equal(saves[0].options.metadata.cacheControl, 'public, max-age=31536000, immutable');
});

test('calls ElevenLabs multilingual v2 without exposing the API key in failures', async () => {
  const requests = [];
  const synthesizer = new ElevenLabsPromptAudioSynthesizer({
    apiKey: 'test-secret-that-must-not-leak',
    fetch: async (url, init) => {
      requests.push({ url, init });
      return new Response(Uint8Array.from([0x49, 0x44, 0x33]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    },
  });

  const audio = await synthesizer.synthesize({
    voiceId: 'configured-voice-id',
    text: 'Reviewed public prompt.',
    modelId: 'eleven_multilingual_v2',
    outputFormat: 'mp3_44100_128',
  });

  assert.deepEqual(audio, Uint8Array.from([0x49, 0x44, 0x33]));
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/v1\/text-to-speech\/configured-voice-id\?output_format=mp3_44100_128$/);
  assert.equal(requests[0].init.headers['xi-api-key'], 'test-secret-that-must-not-leak');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    text: 'Reviewed public prompt.',
    model_id: 'eleven_multilingual_v2',
  });

  const rejected = new ElevenLabsPromptAudioSynthesizer({
    apiKey: 'another-secret',
    fetch: async () => new Response('provider details', { status: 401 }),
  });
  await assert.rejects(
    () => rejected.synthesize({
      voiceId: 'configured-voice-id',
      text: 'Reviewed public prompt.',
      modelId: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_128',
    }),
    (error) => {
      assert.match(error.message, /prompt_audio_synthesis_failed:401/);
      assert.doesNotMatch(error.message, /another-secret|provider details/);
      return true;
    },
  );
});
