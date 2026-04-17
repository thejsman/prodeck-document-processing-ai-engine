import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

interface ApprovalPayload {
  name: string;
  role?: string;
  company?: string;
  email: string;
  signature: string;
  acceptedAt: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ namespace: string; proposalId: string }> },
) {
  const { namespace, proposalId } = await params;

  let body: ApprovalPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.name || !body.email || !body.signature) {
    return NextResponse.json({ error: 'name, email, and signature are required' }, { status: 422 });
  }

  const workdir = process.env.WORKDIR ?? '../../workdir';
  const approvalDir = join(workdir, 'namespaces', namespace, 'approvals');

  try {
    if (!existsSync(approvalDir)) {
      await mkdir(approvalDir, { recursive: true });
    }

    const record = {
      proposalId,
      namespace,
      name: body.name,
      role: body.role ?? '',
      company: body.company ?? '',
      email: body.email,
      signatureDataUrl: body.signature,
      acceptedAt: body.acceptedAt ?? new Date().toISOString(),
      recordedAt: new Date().toISOString(),
    };

    const filename = `${proposalId}-${Date.now()}.json`;
    await writeFile(join(approvalDir, filename), JSON.stringify(record, null, 2), 'utf-8');

    return NextResponse.json({ ok: true, recordedAt: record.recordedAt });
  } catch (err) {
    console.error('[approve] failed to save approval', err);
    return NextResponse.json({ error: 'Failed to save approval record' }, { status: 500 });
  }
}
