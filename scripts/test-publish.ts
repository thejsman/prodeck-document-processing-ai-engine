/**
 * Smoke test for the microsite publish round-trip.
 *
 * Required env vars:
 *   AWS_REGION, MICROSITE_S3_BUCKET, MICROSITE_ROOT_DOMAIN, AWS_ACCESS_KEY_ID,
 *   AWS_SECRET_ACCESS_KEY
 *
 * Run from services/ui (where @aws-sdk/client-s3 is installed):
 *   cd services/ui
 *   node --experimental-strip-types --env-file=.env.local ../../scripts/test-publish.ts [subdomain]
 *
 * Requires Node 22+ for --experimental-strip-types. Pass CLEANUP=false to keep
 * the test object in S3 after the run.
 */

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const BUCKET = process.env.MICROSITE_S3_BUCKET;
const ROOT = process.env.MICROSITE_ROOT_DOMAIN ?? 'yourdomain.com';

if (!BUCKET) {
  console.error('MICROSITE_S3_BUCKET must be set');
  process.exit(1);
}

const subdomain = process.argv[2] ?? `smoketest-${Date.now().toString(36)}`;
const key = `subdomains/${subdomain}.json`;

const client = new S3Client({ region: REGION });

const fakeAst = {
  proposalId: 'smoke-test',
  generatedAt: new Date().toISOString(),
  meta: { title: 'Smoke Test', client: 'Test Client', date: '2026-05-19', author: 'CI' },
  brief: {
    clientName: 'Test',
    clientIndustry: 'Tech',
    clientChallenge: 'demo',
    proposingCompany: 'Us',
    proposingStrength: 'demo',
    engagementSummary: 'demo',
    keyOutcomes: [],
    totalValue: '',
    duration: '',
    primaryTone: 'consultative' as const,
    heroNarrative: '',
    industryKeywords: [],
  },
  brand: { companyName: 'Test', primaryColor: '#000000', secondaryColor: '#ffffff' },
  plugin: 'classic',
  sections: [],
};

async function main() {
  console.log(`[1/4] Uploading test AST to s3://${BUCKET}/${key}`);
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify({
        ast: fakeAst,
        namespace: 'smoke-test',
        publishedAt: new Date().toISOString(),
      }),
      ContentType: 'application/json',
    }),
  );

  console.log('[2/4] HEAD check — should be "taken"');
  await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));

  console.log('[3/4] GET round-trip');
  const get = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = await get.Body?.transformToString();
  if (!body) throw new Error('Empty body returned from GET');
  const parsed = JSON.parse(body);
  if (parsed.ast.proposalId !== 'smoke-test') {
    throw new Error(`Round-trip mismatch: ${parsed.ast.proposalId}`);
  }

  console.log(`[4/4] OK. Live URL would be https://${subdomain}.${ROOT}`);

  if (process.env.CLEANUP !== 'false') {
    console.log('Cleaning up test object…');
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } else {
    console.log('Skipping cleanup (CLEANUP=false)');
  }
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
