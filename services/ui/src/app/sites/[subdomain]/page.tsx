import { notFound } from 'next/navigation';
import { getAst } from '@/lib/micrositeStorage';
import { Microsite } from '@/components/microsite/Microsite';
import { MicrositeV2Frame } from '@/components/microsite/MicrositeV2Frame';

export const revalidate = 60;

interface Params {
  params: Promise<{ subdomain: string }>;
}

export default async function MicrositePublicPage({ params }: Params) {
  const { subdomain } = await params;
  const record = await getAst(subdomain);
  if (!record) notFound();

  if (record.ast.generationMode === 'v2') {
    const html = (record.ast.sections?.[0] as { customHtml?: string } | undefined)?.customHtml ?? '';
    return <MicrositeV2Frame html={html} />;
  }

  return <Microsite ast={record.ast} mode="fullscreen" />;
}

export async function generateMetadata({ params }: Params) {
  const { subdomain } = await params;
  const record = await getAst(subdomain).catch(() => null);
  if (!record) return { title: 'Not found' };
  return {
    title: record.ast.meta?.title ?? subdomain,
    description: record.ast.brief?.engagementSummary ?? undefined,
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: {
        index: false,
        follow: false,
        nosnippet: true,
        noimageindex: true,
      },
    },
  };
}
