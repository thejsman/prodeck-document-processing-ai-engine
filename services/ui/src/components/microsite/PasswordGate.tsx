'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Lock, Loader2 } from 'lucide-react';

interface Props {
  /** For subdomain microsites — used as identifier when `identifier` is not provided */
  subdomain?: string;
  /** For custom domain microsites — the full domain string used as the identifier */
  identifier?: string;
  /** Override the verify endpoint. Defaults to '/api/verify-password' for subdomains. */
  verifyEndpoint?: string;
  /** The body key for the identifier value. Defaults to 'subdomain'. */
  payloadKey?: string;
}

export function PasswordGate({
  subdomain,
  identifier,
  verifyEndpoint,
  payloadKey,
}: Props) {
  const id = identifier ?? subdomain ?? '';
  const endpoint = verifyEndpoint ?? '/api/verify-password';
  const bodyKey = payloadKey ?? 'subdomain';

  const router = useRouter();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || status === 'loading') return;
    setStatus('loading');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [bodyKey]: id, password }),
      });
      const data = (await res.json()) as { valid: boolean };
      if (data.valid) {
        router.refresh();
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 16,
          padding: '40px 36px',
          width: '100%',
          maxWidth: 380,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <Lock size={20} color="rgba(255,255,255,0.75)" />
          </div>
          <h1
            style={{
              color: '#fff',
              fontSize: 20,
              fontWeight: 600,
              margin: '0 0 8px',
              letterSpacing: '-0.01em',
            }}
          >
            Password protected
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, margin: 0, lineHeight: 1.5 }}>
            Enter the password to access this page
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ position: 'relative', marginBottom: status === 'error' ? 8 : 14 }}>
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (status === 'error') setStatus('idle');
              }}
              placeholder="Enter password"
              autoFocus
              autoComplete="current-password"
              style={{
                width: '100%',
                padding: '10px 40px 10px 14px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: `1px solid ${status === 'error' ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: 8,
                color: '#fff',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                color: 'rgba(255,255,255,0.4)',
                display: 'flex',
                alignItems: 'center',
              }}
              tabIndex={-1}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {status === 'error' && (
            <p
              style={{
                color: '#f87171',
                fontSize: 12,
                margin: '0 0 12px',
                textAlign: 'center',
              }}
            >
              Incorrect password. Please try again.
            </p>
          )}

          <button
            type="submit"
            disabled={status === 'loading' || !password}
            style={{
              width: '100%',
              padding: '10px',
              background:
                status === 'loading' || !password ? 'rgba(99,102,241,0.4)' : '#6366f1',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              cursor: status === 'loading' || !password ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'background 0.15s',
            }}
          >
            {status === 'loading' ? (
              <>
                <Loader2
                  size={16}
                  style={{ animation: 'spin 0.8s linear infinite' }}
                />
                Verifying…
              </>
            ) : (
              'Access site'
            )}
          </button>
        </form>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
