import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import nodemailer from 'nodemailer';

interface ApprovalPayload {
  name: string;
  role?: string;
  company?: string;
  email: string;
  signature: string;
  acceptedAt: string;
}

/** Returns a nodemailer transporter if SMTP env vars are set, otherwise null. */
function createTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });
}

/** Send confirmation email to the approver and optionally a notification to the sender. */
async function sendApprovalEmails(record: {
  name: string;
  role: string;
  company: string;
  email: string;
  proposalId: string;
  acceptedAt: string;
}): Promise<boolean> {
  const transporter = createTransporter();
  if (!transporter) return false;

  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const notifyEmail = process.env.APPROVAL_NOTIFY_EMAIL;
  const formattedDate = new Date(record.acceptedAt).toLocaleString('en-US', {
    dateStyle: 'long', timeStyle: 'short',
  });
  const roleLine = record.role ? `<p style="margin:4px 0;color:#888;">${record.role}${record.company ? ` · ${record.company}` : ''}</p>` : '';

  const confirmationHtml = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111;">
      <h2 style="color:#111;margin-bottom:4px;">Proposal Approved</h2>
      <p style="color:#555;margin-top:0;">Your approval has been recorded successfully.</p>
      <div style="background:#f5f5f5;border-radius:8px;padding:20px 24px;margin:24px 0;">
        <p style="margin:4px 0;font-weight:600;">${record.name}</p>
        ${roleLine}
        <p style="margin:12px 0 4px;color:#888;font-size:0.85em;">Approved on</p>
        <p style="margin:0;font-weight:500;">${formattedDate}</p>
        <p style="margin:12px 0 4px;color:#888;font-size:0.85em;">Proposal reference</p>
        <p style="margin:0;font-family:monospace;font-size:0.9em;">${record.proposalId}</p>
      </div>
      <p style="color:#888;font-size:0.85em;">This is an automated confirmation. Please keep this email for your records.</p>
    </div>`;

  const sends = [
    transporter.sendMail({
      from,
      to: record.email,
      subject: 'Your proposal approval has been recorded',
      html: confirmationHtml,
    }),
  ];

  // Notify the sender/owner if configured
  if (notifyEmail && notifyEmail !== record.email) {
    sends.push(
      transporter.sendMail({
        from,
        to: notifyEmail,
        subject: `Proposal approved by ${record.name}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111;">
            <h2 style="margin-bottom:4px;">New Approval Received</h2>
            <p style="color:#555;margin-top:0;">
              <strong>${record.name}</strong>${record.role ? ` (${record.role}${record.company ? `, ${record.company}` : ''})` : ''} approved proposal <code>${record.proposalId}</code> on ${formattedDate}.
            </p>
            <p style="color:#888;font-size:0.85em;">Approver email: ${record.email}</p>
          </div>`,
      }),
    );
  }

  try {
    await Promise.all(sends);
    return true;
  } catch (err) {
    console.error('[approve] email send failed:', err);
    return false;
  }
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

    const emailSent = await sendApprovalEmails(record);

    return NextResponse.json({ ok: true, recordedAt: record.recordedAt, emailSent });
  } catch (err) {
    console.error('[approve] failed to save approval', err);
    return NextResponse.json({ error: 'Failed to save approval record' }, { status: 500 });
  }
}

/** Check whether this proposal already has an approval record on disk. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ namespace: string; proposalId: string }> },
) {
  const { namespace, proposalId } = await params;
  const workdir = process.env.WORKDIR ?? '../../workdir';
  const approvalDir = join(workdir, 'namespaces', namespace, 'approvals');
  try {
    if (!existsSync(approvalDir)) return NextResponse.json({ approved: false });
    const files = await readdir(approvalDir);
    const approved = files.some(f => f.startsWith(`${proposalId}-`) && f.endsWith('.json'));
    return NextResponse.json({ approved });
  } catch {
    return NextResponse.json({ approved: false });
  }
}
