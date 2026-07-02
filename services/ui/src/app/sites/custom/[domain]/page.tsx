import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getCustomDomainAst } from '@/lib/customDomainStorage';
import { verifyAccessToken, accessCookieName } from '@/lib/micrositeAuth';
import { Microsite } from '@/components/microsite/Microsite';
import { MicrositeV2Frame } from '@/components/microsite/MicrositeV2Frame';
import { PasswordGate } from '@/components/microsite/PasswordGate';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ domain: string }>;
}

export default async function CustomDomainMicrositePage({ params }: Params) {
  const { domain } = await params;
  const record = await getCustomDomainAst(domain);
  if (!record) notFound();

  if (record.passwordHash) {
    const cookieStore = await cookies();
    const token = cookieStore.get(accessCookieName(domain))?.value ?? '';
    const granted = verifyAccessToken(domain, record.passwordHash, token);
    if (!granted) {
      return (
        <PasswordGate
          identifier={domain}
          verifyEndpoint="/api/verify-custom-domain-password"
          payloadKey="domain"
        />
      );
    }
  }

  if (record.ast.generationMode === 'v2') {
    const html = (record.ast.sections?.[0] as { customHtml?: string } | undefined)?.customHtml ?? '';
    return <MicrositeV2Frame html={html} />;
  }

  return <Microsite ast={record.ast} mode="fullscreen" />;
}

export async function generateMetadata({ params }: Params) {
  const { domain } = await params;
  const record = await getCustomDomainAst(domain).catch(() => null);
  if (!record) return { title: 'Not found' };
  return {
    title: record.ast.meta?.title ?? domain,
    description: record.ast.brief?.engagementSummary ?? undefined,
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false, nosnippet: true, noimageindex: true },
    },
  };
}
