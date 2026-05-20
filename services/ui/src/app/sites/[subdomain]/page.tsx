import { notFound } from 'next/navigation';
import { getAst } from '@/lib/micrositeStorage';
import { Microsite } from '@/components/microsite/Microsite';

export const revalidate = 60;

interface Params {
  params: Promise<{ subdomain: string }>;
}

export default async function MicrositePublicPage({ params }: Params) {
  const { subdomain } = await params;
  const record = await getAst(subdomain);
  if (!record) notFound();
  return <Microsite ast={record.ast} mode="fullscreen" />;
}

export async function generateMetadata({ params }: Params) {
  const { subdomain } = await params;
  const record = await getAst(subdomain).catch(() => null);
  if (!record) return { title: 'Not found' };
  return {
    title: record.ast.meta?.title ?? subdomain,
    description: record.ast.brief?.engagementSummary ?? undefined,
  };
}
