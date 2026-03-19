import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as s3GetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'node:stream';
import type { StorageProvider } from '@ai-engine/core';

export interface S3StorageConfig {
  /** S3 bucket name. */
  bucketName: string;

  /** AWS region (e.g. "ap-south-1"). */
  region: string;

  /**
   * Top-level key prefix inside the bucket (e.g. "prod" or "ai-engine").
   * All keys are stored under: {basePrefix}/namespaces/{namespace}/{path}
   */
  basePrefix: string;

  /** Namespace slug — enforces per-namespace key isolation. */
  namespace: string;
}

// ── Path safety ───────────────────────────────────────────────────

function sanitize(inputPath: string): string {
  if (inputPath.startsWith('/')) {
    throw new Error(`Storage: absolute paths are not allowed: "${inputPath}"`);
  }
  // Normalize separators to forward slash (S3 keys always use /)
  const normalized = inputPath.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') {
    throw new Error(`Storage: path traversal is not allowed: "${inputPath}"`);
  }
  return normalized;
}

// ── Provider ─────────────────────────────────────────────────────

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  /**
   * Full namespace-scoped key prefix:
   *   {basePrefix}/namespaces/{namespace}
   */
  private readonly nsPrefix: string;

  constructor({ bucketName, region, basePrefix, namespace }: S3StorageConfig) {
    this.client = new S3Client({ region });
    this.bucket = bucketName;
    this.nsPrefix = `${basePrefix}/namespaces/${namespace}`;
  }

  private key(relativePath: string): string {
    return `${this.nsPrefix}/${sanitize(relativePath)}`;
  }

  async writeFile(relativePath: string, content: Buffer | string): Promise<string> {
    const k = this.key(relativePath);
    const body = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;

    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: k, Body: body }),
    );

    return `s3://${this.bucket}/${k}`;
  }

  async readFile(relativePath: string): Promise<Buffer> {
    const k = this.key(relativePath);
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: k }),
    );

    if (!res.Body) throw new Error(`S3: empty response body for key "${k}"`);

    // Body is an async-iterable stream in Node.js
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async list(prefix: string): Promise<string[]> {
    const keyPrefix = `${this.nsPrefix}/${sanitize(prefix)}`;
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: keyPrefix,
          ContinuationToken: continuationToken,
        }),
      );

      for (const obj of res.Contents ?? []) {
        if (obj.Key) {
          // Strip the namespace prefix to return relative paths
          const rel = obj.Key.slice(this.nsPrefix.length + 1);
          keys.push(rel);
        }
      }

      continuationToken = res.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }

  async delete(relativePath: string): Promise<void> {
    const k = this.key(relativePath);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: k }),
    );
  }

  async exists(relativePath: string): Promise<boolean> {
    const k = this.key(relativePath);
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: k }),
      );
      return true;
    } catch (err) {
      // AWS SDK v3 throws a 404-shaped error for missing objects
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  }

  /**
   * Generate a pre-signed S3 GET URL valid for `ttlSeconds` seconds.
   * Allows direct client access without proxying through the API.
   */
  async getSignedUrl(relativePath: string, ttlSeconds: number): Promise<string> {
    const k = this.key(relativePath);
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: k });
    return s3GetSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  /**
   * Stream a large file to S3 using multipart upload.
   * Parts are 5 MB each; up to 4 parts upload concurrently.
   * The SDK handles assembly — no in-memory buffering of the full file.
   */
  async writeStream(relativePath: string, stream: Readable): Promise<string> {
    const k = this.key(relativePath);
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: k, Body: stream },
      partSize: 5 * 1024 * 1024, // 5 MB per part
      queueSize: 4,               // concurrent part uploads
    });
    await upload.done();
    return `s3://${this.bucket}/${k}`;
  }

  /**
   * Open a streaming read from S3.
   * The SDK body is a Node.js Readable in the Node.js runtime.
   */
  async readStream(relativePath: string): Promise<Readable> {
    const k = this.key(relativePath);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: k }),
    );
    if (!response.Body) {
      throw new Error(`S3: empty body for key "${k}"`);
    }
    return response.Body as unknown as Readable;
  }
}
