import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface PromptAudioObjectStore {
  get(objectKey: string): Promise<Uint8Array | undefined>;
  putIfAbsent(objectKey: string, audio: Uint8Array): Promise<void>;
}

/** Structural subset of a GCS Bucket; keeps the shared SDK cloud-client-version agnostic. */
export interface PromptAudioGcsBucket {
  file(name: string): {
    download(): Promise<readonly [Buffer]>;
    save(data: Uint8Array, options: Readonly<{
      resumable: false;
      contentType: string;
      metadata: Readonly<{ cacheControl: string }>;
      preconditionOpts: Readonly<{ ifGenerationMatch: number }>;
    }>): Promise<unknown>;
  };
}

export interface CachedPromptAudio {
  objectKey: string;
  audio: Uint8Array;
  created: boolean;
}

export interface ElevenLabsPromptAudioRequest {
  voiceId: string;
  text: string;
  modelId?: string;
  outputFormat?: string;
}

const REQUIRED_TOKEN = /^[A-Za-z0-9._-]+$/u;

function requireText(value: unknown, errorCode: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

/** Hash a canonical descriptor produced by `sos-data-utils-ts/prompt-audio`. */
export function buildPromptAudioObjectKey(canonicalDescriptor: string, extension: string): string {
  requireText(canonicalDescriptor, 'prompt_audio_canonical_descriptor_required');
  const normalizedExtension = requireText(extension, 'prompt_audio_extension_required').replace(/^\./u, '');
  if (!REQUIRED_TOKEN.test(normalizedExtension)) throw new Error('prompt_audio_extension_invalid');
  const digest = createHash('sha256').update(canonicalDescriptor, 'utf8').digest('hex');
  return `prompt-audio/sha256/${digest}.${normalizedExtension}`;
}

/** Durable local adapter. Production callers may implement the same interface over object storage. */
export class FileSystemPromptAudioStore implements PromptAudioObjectStore {
  public constructor(private readonly rootDirectory: string) {
    if (!path.isAbsolute(rootDirectory)) throw new Error('prompt_audio_store_root_must_be_absolute');
  }

  private resolveObjectPath(objectKey: string): string {
    if (!/^prompt-audio\/sha256\/[a-f0-9]{64}\.[A-Za-z0-9._-]+$/u.test(objectKey)) {
      throw new Error('prompt_audio_object_key_invalid');
    }
    const resolved = path.resolve(this.rootDirectory, objectKey);
    const relative = path.relative(this.rootDirectory, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('prompt_audio_object_key_invalid');
    return resolved;
  }

  public async get(objectKey: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(this.resolveObjectPath(objectKey)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  public async putIfAbsent(objectKey: string, audio: Uint8Array): Promise<void> {
    if (!(audio instanceof Uint8Array) || audio.byteLength === 0) throw new Error('prompt_audio_bytes_required');
    const objectPath = this.resolveObjectPath(objectKey);
    await mkdir(path.dirname(objectPath), { recursive: true });
    try {
      await writeFile(objectPath, audio, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/**
 * Shared durable GCS adapter for public immutable prompts.
 *
 * The default prefix is intentionally product-neutral: Vet, UHC and Connect
 * ICA resolve the same object whenever their complete canonical descriptors
 * match. `ifGenerationMatch: 0` makes concurrent cross-process writes
 * create-only; an existing object wins and is read back by the cache.
 */
export class GcsPromptAudioStore implements PromptAudioObjectStore {
  private readonly prefix: string;

  public constructor(
    private readonly bucket: PromptAudioGcsBucket,
    options: Readonly<{ prefix?: string; cacheControl?: string }> = {},
  ) {
    this.prefix = String(options.prefix ?? '').trim().replace(/^\/+|\/+$/gu, '');
    this.cacheControl = String(options.cacheControl ?? 'public, max-age=31536000, immutable').trim();
    if (!this.cacheControl) throw new Error('prompt_audio_gcs_cache_control_required');
  }

  private readonly cacheControl: string;

  private resolveObjectName(objectKey: string): string {
    if (!/^prompt-audio\/sha256\/[a-f0-9]{64}\.[A-Za-z0-9._-]+$/u.test(objectKey)) {
      throw new Error('prompt_audio_object_key_invalid');
    }
    return this.prefix ? `${this.prefix}/${objectKey}` : objectKey;
  }

  public async get(objectKey: string): Promise<Uint8Array | undefined> {
    try {
      const [bytes] = await this.bucket.file(this.resolveObjectName(objectKey)).download();
      return new Uint8Array(bytes);
    } catch (error) {
      const status = (error as { code?: number | string }).code;
      if (status === 404 || status === '404') return undefined;
      throw error;
    }
  }

  public async putIfAbsent(objectKey: string, audio: Uint8Array): Promise<void> {
    if (!(audio instanceof Uint8Array) || audio.byteLength === 0) throw new Error('prompt_audio_bytes_required');
    try {
      await this.bucket.file(this.resolveObjectName(objectKey)).save(audio, {
        resumable: false,
        contentType: objectKey.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream',
        metadata: { cacheControl: this.cacheControl },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (error) {
      const status = (error as { code?: number | string }).code;
      if (status !== 409 && status !== 412 && status !== '409' && status !== '412') throw error;
    }
  }
}

/** Runtime cache with one synthesis operation for every in-process immutable miss. */
export class ImmutablePromptAudioCache {
  private readonly inFlight = new Map<string, Promise<CachedPromptAudio>>();

  public constructor(private readonly store: PromptAudioObjectStore) {}

  public async getOrCreate(input: Readonly<{
    canonicalDescriptor: string;
    extension: string;
    synthesize: () => Promise<Uint8Array>;
  }>): Promise<CachedPromptAudio> {
    const objectKey = buildPromptAudioObjectKey(input.canonicalDescriptor, input.extension);
    const stored = await this.store.get(objectKey);
    if (stored) return { objectKey, audio: stored, created: false };

    const current = this.inFlight.get(objectKey);
    if (current) return current;
    const creation = this.create(objectKey, input.synthesize);
    this.inFlight.set(objectKey, creation);
    try {
      return await creation;
    } finally {
      this.inFlight.delete(objectKey);
    }
  }

  private async create(objectKey: string, synthesize: () => Promise<Uint8Array>): Promise<CachedPromptAudio> {
    const audio = await synthesize();
    if (!(audio instanceof Uint8Array) || audio.byteLength === 0) throw new Error('prompt_audio_synthesis_empty');
    await this.store.putIfAbsent(objectKey, audio);
    const durableAudio = await this.store.get(objectKey);
    if (!durableAudio) throw new Error('prompt_audio_persistence_failed');
    return { objectKey, audio: durableAudio, created: true };
  }
}

/** Prewarm deliberately serializes paid synthesis and stops at the first failure. */
export async function prewarmPromptAudioSequentially<Input, Output>(
  inputs: readonly Input[],
  prepare: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const outputs: Output[] = [];
  for (const input of inputs) outputs.push(await prepare(input));
  return outputs;
}

/** Minimal ElevenLabs adapter; credentials stay only in the trusted Node runtime. */
export class ElevenLabsPromptAudioSynthesizer {
  private readonly apiKey: string;
  private readonly fetchImplementation: typeof fetch;

  public constructor(options: Readonly<{ apiKey: string; fetch?: typeof fetch }>) {
    this.apiKey = requireText(options.apiKey, 'elevenlabs_api_key_required');
    this.fetchImplementation = options.fetch ?? fetch;
  }

  public async synthesize(request: ElevenLabsPromptAudioRequest): Promise<Uint8Array> {
    const voiceId = requireText(request.voiceId, 'elevenlabs_voice_id_required');
    const outputFormat = request.outputFormat ?? 'mp3_44100_128';
    if (!REQUIRED_TOKEN.test(voiceId)) throw new Error('elevenlabs_voice_id_invalid');
    if (!REQUIRED_TOKEN.test(outputFormat)) throw new Error('elevenlabs_output_format_invalid');
    const response = await this.fetchImplementation(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`,
      {
        method: 'POST',
        headers: {
          accept: 'audio/mpeg',
          'content-type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text: requireText(request.text, 'elevenlabs_text_required'),
          model_id: request.modelId ?? 'eleven_multilingual_v2',
        }),
      },
    );
    if (!response.ok) throw new Error(`prompt_audio_synthesis_failed:${response.status}`);
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0) throw new Error('prompt_audio_synthesis_empty');
    return audio;
  }
}
