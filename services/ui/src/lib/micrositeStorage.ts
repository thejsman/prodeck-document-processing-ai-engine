import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  NotFound,
} from '@aws-sdk/client-s3';
import type { LayoutAST } from '../types/presentation';

let cachedClient: S3Client | null = null;

function client(): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: process.env.AWS_REGION ?? 'us-east-1',
  });
  return cachedClient;
}

function bucket(): string {
  const name = process.env.MICROSITE_S3_BUCKET;
  if (!name) throw new Error('MICROSITE_S3_BUCKET is not set');
  return name;
}

function key(subdomain: string): string {
  return `subdomains/${subdomain}.json`;
}

export interface PublishedAst {
  ast: LayoutAST;
  namespace: string;
  publishedAt: string;
  passwordHash?: string;
}

export async function putAst(
  subdomain: string,
  ast: LayoutAST,
  meta: { namespace: string; passwordHash?: string },
): Promise<{ publishedAt: string }> {
  const publishedAt = new Date().toISOString();
  const body: PublishedAst = { ast, namespace: meta.namespace, publishedAt };
  if (meta.passwordHash !== undefined) body.passwordHash = meta.passwordHash;

  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key(subdomain),
      Body: JSON.stringify(body),
      ContentType: 'application/json',
      CacheControl: 'no-cache',
      Metadata: { namespace: meta.namespace, publishedAt },
    }),
  );

  return { publishedAt };
}

export type HeadResult = 'taken' | 'available' | 'error';

export async function headAst(subdomain: string): Promise<HeadResult> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key(subdomain) }));
    return 'taken';
  } catch (err) {
    if (err instanceof NotFound) return 'available';
    const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } });
    if (code.name === 'NotFound' || code.$metadata?.httpStatusCode === 404) return 'available';
    console.error('[micrositeStorage.headAst] S3 error — failing open', err);
    return 'error';
  }
}

export async function getAst(subdomain: string): Promise<PublishedAst | null> {
  try {
    const res = await client().send(
      new GetObjectCommand({ Bucket: bucket(), Key: key(subdomain) }),
    );
    const text = await res.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text) as PublishedAst;
  } catch (err) {
    if (err instanceof NotFound) return null;
    const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } });
    if (code.name === 'NoSuchKey' || code.name === 'NotFound' || code.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}
