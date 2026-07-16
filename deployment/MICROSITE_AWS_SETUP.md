# Microsite Publishing — AWS Setup

This guide walks through the minimum AWS configuration needed for the
microsite publish feature. There is **no Terraform** — these are one-time
manual steps; revisit them when bootstrapping a new environment.

## Architecture recap

```
User's browser
  └── DNS:  *.{ROOT_DOMAIN}  →  Next.js deployment (ALB, ECS, etc.)
        └── middleware.ts rewrites host → /sites/{subdomain}
              └── server component fetches subdomains/{subdomain}.json from S3
                    └── renders <Microsite />
```

S3 is **only** used as a key-value store for published `LayoutAST` JSON. There
is no CloudFront and no static HTML hosting in this design.

## 1. S3 bucket

1. Create a bucket — suggested name `microsites-static-assets`, region
   `us-east-1`.
2. **Enable versioning** (S3 → bucket → Properties → Bucket Versioning →
   Enable). This is the rollback mechanism.
3. **Block all public access** — the Next.js server reads via IAM credentials,
   so nothing needs to be world-readable.
4. (Optional) Lifecycle rule: expire non-current versions after 90 days.

## 2. ACM wildcard certificate

1. Request a public certificate in ACM (region depends on what fronts your
   Next.js app — `us-east-1` if CloudFront, otherwise the region of your ALB).
2. Domain: `*.{ROOT_DOMAIN}`. Add SAN `{ROOT_DOMAIN}` if you want the apex on
   the same cert.
3. Validate via DNS by creating the CNAME records ACM provides.

## 3. Route 53 (or your DNS provider)

Create an `A` ALIAS (or `CNAME`) record:

```
*.{ROOT_DOMAIN}  →  <your Next.js deployment endpoint>
```

Examples:
- ALB: `dualstack.my-alb-…elb.amazonaws.com`
- CloudFront: `dxxxx.cloudfront.net`
- Vercel: the CNAME they provide

## 4. IAM policy for the Next.js server

The Next.js process needs to put / head / get objects under
`subdomains/*`. Minimum policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:HeadObject"
      ],
      "Resource": "arn:aws:s3:::microsites-static-assets/subdomains/*"
    }
  ]
}
```

Attach the policy to:
- An IAM user (set `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` env vars), or
- An IAM role assumed by the task / instance running Next.js (preferred).

## 5. Environment variables

Add to `services/ui/.env.local` (or your deployment env):

```bash
AWS_REGION=us-east-1
MICROSITE_S3_BUCKET=microsites-static-assets
MICROSITE_ROOT_DOMAIN=yourdomain.com
NEXT_PUBLIC_MICROSITE_ROOT_DOMAIN=yourdomain.com

# Either explicit creds…
AWS_ACCESS_KEY_ID=AKIA…
AWS_SECRET_ACCESS_KEY=…
# …or rely on an instance/task role and omit the keys.
```

## 6. Verify

Run the smoke test from the repo root:

```bash
pnpm tsx scripts/test-publish.ts
```

It uploads a fake AST under `subdomains/smoketest-….json`, HEADs it, reads
it back, and cleans up. If everything is wired right you'll see four `OK`
lines.

## Rollback

S3 versioning keeps every published copy. To roll a subdomain back:

```bash
# List versions
aws s3api list-object-versions \
  --bucket $MICROSITE_S3_BUCKET \
  --prefix subdomains/{subdomain}.json

# Restore a specific version by copying it over the current key
aws s3api copy-object \
  --bucket $MICROSITE_S3_BUCKET \
  --copy-source "$MICROSITE_S3_BUCKET/subdomains/{subdomain}.json?versionId=<VERSION_ID>" \
  --key "subdomains/{subdomain}.json"
```

The Next.js ISR cache will catch up within 60 seconds; for an instant
refresh, re-deploy or hit the publish API once with the same payload
(`revalidatePath` runs after each publish).

## Local development

For local subdomain testing, point at `localtest.me` (resolves
`*.localtest.me` to `127.0.0.1`):

```bash
MICROSITE_ROOT_DOMAIN=localtest.me:3001
NEXT_PUBLIC_MICROSITE_ROOT_DOMAIN=localtest.me:3001
```

Then visit `http://acme.localtest.me:3001/` after publishing. (The publish
flow itself still needs real S3 — use a personal sandbox bucket.)
