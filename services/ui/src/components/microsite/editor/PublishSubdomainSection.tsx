'use client';

import { useState, useEffect, useMemo } from 'react';
import { Check, Loader2, ExternalLink, Globe } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import type { LayoutAST } from '@/types/presentation';
import { sanitizeSubdomainInput } from '@/lib/subdomainValidation';
import { useSubdomainCheck } from '@/hooks/useSubdomainCheck';
import { usePublishMicrosite } from '@/hooks/usePublishMicrosite';

interface Props {
  ast: LayoutAST;
  namespace: string;
  rootDomain: string;
  onPublishingChange?: (publishing: boolean) => void;
}

export function PublishSubdomainSection({ ast, namespace, rootDomain, onPublishingChange }: Props) {
  const [subdomain, setSubdomain] = useState('');
  const [copied, setCopied] = useState(false);
  const check = useSubdomainCheck(subdomain);
  const publish = usePublishMicrosite();

  useEffect(() => {
    onPublishingChange?.(publish.status === 'publishing');
  }, [publish.status, onPublishingChange]);

  const canPublish = useMemo(
    () => check.status === 'available' && publish.status !== 'publishing',
    [check.status, publish.status],
  );

  async function handlePublish() {
    if (!canPublish) return;
    await publish.publish(namespace, ast, subdomain);
  }

  async function handleCopy() {
    if (!publish.url) return;
    try {
      await navigator.clipboard.writeText(publish.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Icon icon={Check} size="sm" />
          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>
            Published
          </p>
        </div>
        <a
          href={publish.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            fontFamily: 'monospace',
            fontSize: 12,
            color: 'var(--text)',
            wordBreak: 'break-all',
            marginBottom: 10,
            textDecoration: 'underline',
          }}
        >
          {publish.url}
        </a>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleCopy}
            className="btn btn-sm"
            style={{ color: copied ? 'var(--success)' : undefined }}
          >
            {copied ? <><Icon icon={Check} size="sm" /> Copied</> : 'Copy link'}
          </button>
          <a
            href={publish.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm"
            style={{ textDecoration: 'none' }}
          >
            <Icon icon={ExternalLink} size="sm" /> Visit
          </a>
          <button
            onClick={() => {
              publish.reset();
              setSubdomain('');
            }}
            className="btn btn-sm"
            style={{ marginLeft: 'auto' }}
          >
            Publish another
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--subtle)', margin: '10px 0 0', lineHeight: 1.4 }}>
          To publish to a different subdomain, open this dialog again. The current URL will stay live.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '16px 18px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon icon={Globe} size="sm" />
        <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>
          Publish to live URL
        </p>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px', lineHeight: 1.4 }}>
        Get a shareable link at <span style={{ fontFamily: 'monospace' }}>{rootDomain}</span>
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--bg)',
          overflow: 'hidden',
          marginBottom: 8,
        }}
      >
        <input
          type="text"
          value={subdomain}
          onChange={(e) => setSubdomain(sanitizeSubdomainInput(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canPublish) {
              e.preventDefault();
              handlePublish();
            }
          }}
          placeholder="your-microsite"
          disabled={publish.status === 'publishing'}
          maxLength={63}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            padding: '8px 10px',
            background: 'transparent',
            fontSize: 13,
            color: 'var(--text)',
            fontFamily: 'monospace',
            minWidth: 0,
          }}
        />
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            fontSize: 12,
            color: 'var(--muted)',
            fontFamily: 'monospace',
            borderLeft: '1px solid var(--border)',
            background: 'var(--panel)',
            whiteSpace: 'nowrap',
          }}
        >
          .{rootDomain}
        </span>
      </div>

      <div style={{ minHeight: 18, marginBottom: 10, fontSize: 12, lineHeight: 1.4 }}>
        {check.status === 'checking' && (
          <span style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon icon={Loader2} size="sm" /> Checking…
          </span>
        )}
        {check.status === 'available' && (
          <span style={{ color: 'var(--success, #10b981)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon icon={Check} size="sm" /> Available
          </span>
        )}
        {check.status === 'unavailable' && (
          <span style={{ color: '#dc2626' }}>{check.message}</span>
        )}
        {check.status === 'idle' && subdomain.length === 0 && (
          <span style={{ color: 'var(--subtle)' }}>
            3–63 characters, lowercase letters, numbers, and hyphens
          </span>
        )}
      </div>

      <button
        onClick={handlePublish}
        disabled={!canPublish}
        className="btn btn-sm btn-primary"
        style={{ width: '100%' }}
      >
        {publish.status === 'publishing' ? (
          <><Icon icon={Loader2} size="sm" /> Publishing…</>
        ) : (
          'Publish'
        )}
      </button>

      {publish.status === 'error' && publish.error && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            fontSize: 12,
            color: '#dc2626',
          }}
        >
          {publish.error}
        </div>
      )}
    </div>
  );
}
