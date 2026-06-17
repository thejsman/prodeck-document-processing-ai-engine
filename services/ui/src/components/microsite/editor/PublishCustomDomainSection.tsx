'use client';

import { useState, useEffect } from 'react';
import { Check, Loader2, ExternalLink, Globe, Eye, EyeOff, Lock, ChevronDown, ChevronUp, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import type { LayoutAST } from '@/types/presentation';
import { useCustomDomainPublish } from '@/hooks/useCustomDomainPublish';
import { fetchPublishMeta } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface Props {
  ast: LayoutAST;
  namespace: string;
  proposalId: string;
  onPublishingChange?: (publishing: boolean) => void;
}

const FQDN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

type DnsStatus = 'idle' | 'checking' | 'verified' | 'failed';

export function PublishCustomDomainSection({ ast, namespace, proposalId, onPublishingChange }: Props) {
  const { apiKey } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [domain, setDomain] = useState('');
  const [dnsStatus, setDnsStatus] = useState<DnsStatus>('idle');
  const [dnsMessage, setDnsMessage] = useState('');
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const publish = useCustomDomainPublish();

  const cnameTarget = process.env.NEXT_PUBLIC_MICROSITE_CNAME_TARGET ?? '';
  const serverIp = process.env.NEXT_PUBLIC_MICROSITE_SERVER_IP ?? '';

  // Detect whether the domain looks like a root/apex (two labels only)
  const isApex = domain.split('.').filter(Boolean).length === 2;
  const isValidDomain = FQDN_RE.test(domain) && domain.length <= 253;

  useEffect(() => {
    fetchPublishMeta(namespace, proposalId)
      .then(meta => {
        if (meta && (meta as { customDomain?: string }).customDomain) {
          const m = meta as { customDomain: string; url: string; publishedAt: string };
          publish.restoreFromMeta({ customDomain: m.customDomain, url: m.url, publishedAt: m.publishedAt });
          setExpanded(true);
        }
      })
      .catch(() => { /* non-fatal */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, proposalId]);

  useEffect(() => {
    const isActive = publish.status === 'publishing' || publish.status === 'polling-ssl';
    onPublishingChange?.(isActive);
  }, [publish.status, onPublishingChange]);

  // Reset DNS status when domain changes
  useEffect(() => {
    setDnsStatus('idle');
    setDnsMessage('');
  }, [domain]);

  async function handleVerifyDns() {
    if (!isValidDomain) return;
    setDnsStatus('checking');
    setDnsMessage('');
    try {
      const res = await fetch(`/api/check-custom-domain-dns?domain=${encodeURIComponent(domain)}`);
      const data = (await res.json()) as { verified: boolean; skipped?: boolean; message?: string; recordType?: string };
      if (data.skipped) {
        setDnsStatus('verified');
        setDnsMessage('DNS check skipped — not configured on this server');
      } else if (data.verified) {
        setDnsStatus('verified');
        setDnsMessage('');
      } else {
        setDnsStatus('failed');
        setDnsMessage(data.message ?? 'DNS record not found — check your DNS provider and try again');
      }
    } catch {
      setDnsStatus('failed');
      setDnsMessage('Could not reach DNS check service');
    }
  }

  async function handlePublish() {
    if (publish.status === 'publishing' || publish.status === 'polling-ssl') return;
    if (!isValidDomain || (dnsStatus !== 'verified' && dnsStatus !== 'idle')) return;
    const pw = passwordEnabled && password.length >= 6 ? password : undefined;
    await publish.publish(namespace, ast, domain, proposalId, apiKey, pw);
  }

  async function handleCopy() {
    if (!publish.url) return;
    try {
      await navigator.clipboard.writeText(publish.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }

  const passwordValid = !passwordEnabled || password.length >= 6;
  const canPublish = isValidDomain && dnsStatus !== 'failed' && dnsStatus !== 'checking' && passwordValid
    && publish.status !== 'publishing' && publish.status !== 'polling-ssl';

  if (publish.status === 'success' && publish.url) {
    return (
      <div
        style={{
          padding: '16px 18px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          marginBottom: 12,
          background: 'var(--bg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Icon icon={Check} size="sm" />
          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', margin: 0 }}>
            Published to custom domain
          </p>
          {publish.passwordProtected && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>
              <Lock size={10} /> Password protected
            </span>
          )}
        </div>
        {publish.sslReady ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#10b981', marginBottom: 8 }}>
            <ShieldCheck size={12} /> SSL ready
          </div>
        ) : (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
            <Loader2 size={12} style={{ animation: 'spin 0.8s linear infinite' }} /> SSL being provisioned...
          </div>
        )}
        <a
          href={publish.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'block', fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', wordBreak: 'break-all', marginBottom: 10, textDecoration: 'underline' }}
        >
          {publish.url}
        </a>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleCopy} className="btn btn-sm" style={{ color: copied ? 'var(--success)' : undefined }}>
            {copied ? <><Icon icon={Check} size="sm" /> Copied</> : 'Copy link'}
          </button>
          <a href={publish.url} target="_blank" rel="noopener noreferrer" className="btn btn-sm" style={{ textDecoration: 'none' }}>
            <Icon icon={ExternalLink} size="sm" /> Visit
          </a>
          <button onClick={() => { publish.reset(); setDomain(''); setDnsStatus('idle'); setPasswordEnabled(false); setPassword(''); }} className="btn btn-sm" style={{ marginLeft: 'auto' }}>
            Change domain
          </button>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (publish.status === 'polling-ssl') {
    return (
      <div style={{ padding: '16px 18px', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 12, background: 'var(--bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite', color: 'var(--muted)' }} />
          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', margin: 0 }}>Provisioning SSL certificate…</p>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0' }}>
          Obtaining a Let&apos;s Encrypt certificate for <span style={{ fontFamily: 'monospace' }}>{publish.domain}</span>. This usually takes under 30 seconds.
        </p>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 8, border: '1px solid var(--border)', marginBottom: 12, overflow: 'hidden' }}>
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          background: 'var(--panel)',
          border: 'none',
          cursor: 'pointer',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Globe size={14} style={{ color: 'var(--muted)' }} />
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>Custom Domain</span>
          <span style={{ fontSize: 10, fontWeight: 500, color: '#6366f1', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 4, padding: '2px 6px', letterSpacing: '0.02em' }}>Advanced</span>
        </div>
        {expanded ? <ChevronUp size={14} color="var(--muted)" /> : <ChevronDown size={14} color="var(--muted)" />}
      </button>

      {expanded && (
        <div style={{ padding: '16px 18px' }}>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px', lineHeight: 1.4 }}>
            Publish to your own domain. Add the DNS record below, verify it, then publish.
          </p>

          {/* Domain input */}
          <input
            type="text"
            value={domain}
            onChange={e => setDomain(e.target.value.trim().toLowerCase())}
            placeholder="e.g. deck.yourdomain.com or yourdomain.com"
            disabled={publish.status === 'publishing'}
            style={{
              width: '100%',
              padding: '8px 10px',
              border: `1px solid ${domain.length > 0 && !isValidDomain ? '#dc2626' : 'var(--border)'}`,
              borderRadius: 6,
              background: 'var(--bg)',
              fontSize: 13,
              color: 'var(--text)',
              fontFamily: 'monospace',
              outline: 'none',
              boxSizing: 'border-box',
              marginBottom: 8,
            }}
          />
          {domain.length > 0 && !isValidDomain && (
            <p style={{ fontSize: 11, color: '#dc2626', margin: '0 0 8px' }}>
              Enter a valid domain name (e.g. deck.yourdomain.com)
            </p>
          )}

          {/* DNS instructions — shown once a valid domain is typed */}
          {isValidDomain && (
            <div
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '12px 14px',
                marginBottom: 10,
                fontSize: 12,
              }}
            >
              <p style={{ fontWeight: 600, color: 'var(--text)', margin: '0 0 8px' }}>
                Add this DNS record at your provider
              </p>
              {!isApex && cnameTarget ? (
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text)', display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: '4px 12px', alignItems: 'center' }}>
                  <span style={{ color: 'var(--muted)' }}>Type</span><span style={{ color: 'var(--muted)' }}>Name</span><span style={{ color: 'var(--muted)' }}>Value</span>
                  <span>CNAME</span><span>{domain.split('.')[0]}</span><span style={{ wordBreak: 'break-all' }}>{cnameTarget}</span>
                </div>
              ) : serverIp ? (
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text)', display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: '4px 12px', alignItems: 'center' }}>
                  <span style={{ color: 'var(--muted)' }}>Type</span><span style={{ color: 'var(--muted)' }}>Name</span><span style={{ color: 'var(--muted)' }}>Value</span>
                  <span>A</span><span>@</span><span>{serverIp}</span>
                </div>
              ) : (
                <p style={{ color: 'var(--muted)', margin: 0 }}>
                  Point your domain to this server&apos;s IP address using an A record (for root domain) or CNAME (for subdomain).
                </p>
              )}
              {!isApex && cnameTarget && serverIp && (
                <>
                  <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
                  <p style={{ color: 'var(--muted)', fontSize: 11, margin: '0 0 6px' }}>Or for the root domain:</p>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text)', display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: '4px 12px', alignItems: 'center' }}>
                    <span>A</span><span>@</span><span>{serverIp}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* DNS verification */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <button
              onClick={handleVerifyDns}
              disabled={!isValidDomain || dnsStatus === 'checking'}
              className="btn btn-sm"
              style={{
                border: '1px solid var(--border)',
                color: 'var(--text)',
                background: 'var(--panel)',
                opacity: !isValidDomain ? 0.45 : 1,
              }}
            >
              {dnsStatus === 'checking'
                ? <><Icon icon={Loader2} size="sm" /> Checking…</>
                : 'Verify DNS'}
            </button>
            {dnsStatus === 'verified' && (
              <span style={{ fontSize: 12, color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Check size={12} /> DNS verified
              </span>
            )}
            {dnsStatus === 'failed' && (
              <span style={{ fontSize: 12, color: '#dc2626', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <AlertTriangle size={12} /> {dnsMessage || 'Not pointing here yet'}
              </span>
            )}
          </div>

          {/* Password protection */}
          <div style={{ marginBottom: 12 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                userSelect: 'none',
                fontSize: 12,
                color: 'var(--text)',
              }}
            >
              <input
                type="checkbox"
                checked={passwordEnabled}
                onChange={(e) => { setPasswordEnabled(e.target.checked); if (!e.target.checked) setPassword(''); }}
                disabled={publish.status === 'publishing'}
                style={{ cursor: 'pointer' }}
              />
              <Lock size={12} style={{ opacity: 0.6 }} />
              Password protect this site
            </label>
            {passwordEnabled && (
              <div style={{ marginTop: 8, position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Set a password (min. 6 characters)"
                  disabled={publish.status === 'publishing'}
                  autoComplete="new-password"
                  style={{
                    width: '100%',
                    padding: '8px 36px 8px 10px',
                    border: `1px solid ${password.length > 0 && password.length < 6 ? '#dc2626' : 'var(--border)'}`,
                    borderRadius: 6,
                    background: 'var(--bg)',
                    fontSize: 12,
                    color: 'var(--text)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--muted)', display: 'flex', alignItems: 'center' }}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            )}
            {passwordEnabled && password.length > 0 && password.length < 6 && (
              <p style={{ fontSize: 11, color: '#dc2626', margin: '4px 0 0' }}>Password must be at least 6 characters.</p>
            )}
          </div>

          <button
            onClick={handlePublish}
            disabled={!canPublish}
            className="btn btn-sm btn-primary"
            style={{ width: '100%' }}
          >
            {publish.status === 'publishing'
              ? <><Icon icon={Loader2} size="sm" /> Publishing…</>
              : 'Publish to custom domain'}
          </button>

          {publish.status === 'error' && publish.error && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626' }}>
              {publish.error}
            </div>
          )}

          <p style={{ fontSize: 11, color: 'var(--subtle)', margin: '10px 0 0', lineHeight: 1.4 }}>
            SSL certificate is provisioned automatically via Let&apos;s Encrypt after publishing.
          </p>
        </div>
      )}
    </div>
  );
}
