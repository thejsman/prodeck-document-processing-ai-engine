'use client';

import { useState, useEffect, useMemo } from 'react';
import { Check, Loader2, ExternalLink, Globe, Eye, EyeOff, Lock, RotateCcw } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import type { LayoutAST } from '@/types/presentation';
import { sanitizeSubdomainInput } from '@/lib/subdomainValidation';
import { useSubdomainCheck } from '@/hooks/useSubdomainCheck';
import { usePublishMicrosite } from '@/hooks/usePublishMicrosite';
import { fetchPublishMeta } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface Props {
  ast: LayoutAST;
  namespace: string;
  proposalId: string;
  rootDomain: string;
  onPublishingChange?: (publishing: boolean) => void;
}

export function PublishSubdomainSection({ ast, namespace, proposalId, rootDomain, onPublishingChange }: Props) {
  const { apiKey } = useAuth();
  const [subdomain, setSubdomain] = useState('');
  const [copied, setCopied] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetPasswordMode, setResetPasswordMode] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetting, setResetting] = useState(false);
  const check = useSubdomainCheck(subdomain);
  const publish = usePublishMicrosite();

  // On mount, fetch previously published URL from server so any browser/user sees it
  useEffect(() => {
    fetchPublishMeta(namespace, proposalId)
      .then(meta => { if (meta) publish.restoreFromMeta(meta); })
      .catch(() => { /* non-fatal */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, proposalId]);

  useEffect(() => {
    onPublishingChange?.(publish.status === 'publishing');
  }, [publish.status, onPublishingChange]);

  const passwordValid = !passwordEnabled || password.length >= 6;

  const canPublish = useMemo(
    () => check.status === 'available' && publish.status !== 'publishing' && passwordValid,
    [check.status, publish.status, passwordValid],
  );

  async function handlePublish() {
    if (!canPublish) return;
    await publish.publish(namespace, ast, subdomain, proposalId, apiKey, passwordEnabled ? password : undefined);
  }

  async function handleResetPassword() {
    if (!publish.subdomain || resetting) return;
    setResetting(true);
    await publish.publish(namespace, ast, publish.subdomain, proposalId, apiKey, newPassword || undefined);
    setResetting(false);
    setResetPasswordMode(false);
    setNewPassword('');
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
          {publish.passwordProtected && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                color: 'var(--muted)',
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '2px 6px',
              }}
            >
              <Lock size={10} /> Password protected
            </span>
          )}
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
            onClick={() => setResetPasswordMode((v) => !v)}
            className="btn btn-sm"
            title="Update password protection"
          >
            <RotateCcw size={12} /> Password
          </button>
          <button
            onClick={() => {
              publish.reset();
              setSubdomain('');
              setPasswordEnabled(false);
              setPassword('');
              setResetPasswordMode(false);
            }}
            className="btn btn-sm"
            style={{ marginLeft: 'auto' }}
          >
            Publish another
          </button>
        </div>

        {resetPasswordMode && (
          <div
            style={{
              marginTop: 12,
              padding: '12px 14px',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', margin: '0 0 8px' }}>
              Update password
            </p>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 10px', lineHeight: 1.4 }}>
              Leave blank to remove password protection.
            </p>
            <div style={{ position: 'relative', marginBottom: 10 }}>
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (leave blank to remove)"
                style={{
                  width: '100%',
                  padding: '8px 36px 8px 10px',
                  border: '1px solid var(--border)',
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
                onClick={() => setShowNewPassword((v) => !v)}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  color: 'var(--muted)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {showNewPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {newPassword.length > 0 && newPassword.length < 6 && (
              <p style={{ fontSize: 11, color: '#dc2626', margin: '0 0 8px' }}>
                Password must be at least 6 characters.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleResetPassword}
                disabled={resetting || (newPassword.length > 0 && newPassword.length < 6)}
                className="btn btn-sm btn-primary"
              >
                {resetting ? <><Icon icon={Loader2} size="sm" /> Updating…</> : 'Update'}
              </button>
              <button
                onClick={() => { setResetPasswordMode(false); setNewPassword(''); }}
                className="btn btn-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

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
            onChange={(e) => {
              setPasswordEnabled(e.target.checked);
              if (!e.target.checked) setPassword('');
            }}
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
              onClick={() => setShowPassword((v) => !v)}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 2,
                color: 'var(--muted)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        )}
        {passwordEnabled && password.length > 0 && password.length < 6 && (
          <p style={{ fontSize: 11, color: '#dc2626', margin: '4px 0 0' }}>
            Password must be at least 6 characters.
          </p>
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
