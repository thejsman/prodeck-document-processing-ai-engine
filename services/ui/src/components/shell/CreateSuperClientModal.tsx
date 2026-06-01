'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Sparkles, Check, Loader, Globe, AlertTriangle, Building2 } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/auth-context';
import { createSuperClient } from '@/lib/api';

interface Props {
  onClose: () => void;
  onCreated: (name: string) => void;
}

// ── Progress step types ──────────────────────────────────────────
type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface Step {
  id: string;
  label: string;
  activeLabel: string; // shown while spinning
  doneLabel: string; // shown when complete
  status: StepStatus;
}

type Phase = 'form' | 'creating' | 'done' | 'error';

function buildSteps(hasUrl: boolean, hasNotes: boolean): Step[] {
  const steps: Step[] = [
    {
      id: 'profile',
      label: 'Create client profile',
      activeLabel: 'Creating client profile…',
      doneLabel: 'Client profile created',
      status: 'active',
    },
  ];
  if (hasUrl) {
    steps.push({
      id: 'website',
      label: 'Analyze website',
      activeLabel: 'Analyzing website…',
      doneLabel: 'Website analyzed',
      status: 'pending',
    });
  }
  if (hasUrl || hasNotes) {
    steps.push({
      id: 'intel',
      label: 'Build client intelligence',
      activeLabel: 'Building client intelligence…',
      doneLabel: 'Intelligence built',
      status: 'pending',
    });
  }
  return steps;
}

// ── Step row component ───────────────────────────────────────────
function StepRow({ step }: { step: Step }) {
  const isActive = step.status === 'active';
  const isDone = step.status === 'done';
  const isError = step.status === 'error';
  const isPending = step.status === 'pending';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '5px 0',
        opacity: isPending ? 0.38 : 1,
        transition: 'opacity 0.3s ease',
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 18,
          height: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {isDone && (
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: 'color-mix(in srgb, #16a34a 12%, transparent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Check size={11} strokeWidth={2.5} style={{ color: '#16a34a' }} />
          </div>
        )}
        {isActive && (
          <Loader size={15} strokeWidth={2} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
        )}
        {isPending && (
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--muted)', opacity: 0.5 }} />
        )}
        {isError && (
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: 'color-mix(in srgb, #ef4444 12%, transparent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={10} strokeWidth={2.5} style={{ color: '#ef4444' }} />
          </div>
        )}
      </div>

      {/* Label */}
      <span
        style={{
          fontSize: 13,
          color: isError ? '#ef4444' : isDone ? 'var(--foreground)' : isActive ? 'var(--foreground)' : 'var(--muted)',
          fontWeight: isActive ? 500 : 400,
          transition: 'color 0.2s ease',
        }}
      >
        {isDone
          ? step.doneLabel
          : isActive
            ? step.activeLabel
            : isError
              ? `Failed — ${step.activeLabel.toLowerCase().replace('…', '')}`
              : step.label}
      </span>
    </div>
  );
}

// ── Main modal ───────────────────────────────────────────────────
export function CreateSuperClientModal({ onClose, onCreated }: Props) {
  const { apiKey } = useAuth();
  const router = useRouter();
  const mountedRef = useRef(true);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [displayName, setDisplayName] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [fieldError, setFieldError] = useState('');

  const [phase, setPhase] = useState<Phase>('form');
  const [steps, setSteps] = useState<Step[]>([]);
  const [apiError, setApiError] = useState('');
  const [pendingName, setPendingName] = useState(''); // display name shown during progress

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  // Escape: only in form phase
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase === 'form') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, phase]);

  function addTimer(fn: () => void, ms: number) {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }

  function setStepStatus(id: string, status: StepStatus) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
  }

  function activateNextPending() {
    setSteps((prev) => {
      const next = [...prev];
      const idx = next.findIndex((s) => s.status === 'pending');
      if (idx !== -1) next[idx] = { ...next[idx], status: 'active' };
      return next;
    });
  }

  async function handleCreate() {
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setFieldError('Client name is required');
      return;
    }

    const hasUrl = !!url.trim();
    const hasNotes = !!notes.trim();
    const initialSteps = buildSteps(hasUrl, hasNotes);

    setPendingName(trimmedName);
    setSteps(initialSteps);
    setPhase('creating');
    setApiError('');

    // Simulate step 1 completing quickly (~700 ms)
    addTimer(() => {
      if (!mountedRef.current) return;
      setStepStatus('profile', 'done');
      activateNextPending();
    }, 700);

    // If there are 3 steps, activate the third one after a few seconds
    if (initialSteps.length === 3) {
      addTimer(() => {
        if (!mountedRef.current) return;
        activateNextPending();
      }, 4000);
    }

    try {
      const result = await createSuperClient(apiKey, trimmedName, url.trim() || undefined, notes.trim() || undefined);

      timersRef.current.forEach(clearTimeout);

      if (!mountedRef.current) {
        // User already closed — still call onCreated so sidebar refreshes
        onCreated(result.name);
        return;
      }

      // All steps → done
      setSteps((prev) => prev.map((s) => ({ ...s, status: 'done' })));
      onCreated(result.name);
      setPhase('done');

      // Auto-navigate after brief "done" moment
      addTimer(() => {
        if (!mountedRef.current) return;
        onClose();
        router.push(`/super-client/${result.name}`);
      }, 900);
    } catch (err) {
      timersRef.current.forEach(clearTimeout);
      if (!mountedRef.current) return;
      setSteps((prev) => prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s)));
      setApiError((err as Error).message ?? 'Something went wrong');
      setPhase('error');
    }
  }

  function handleRetry() {
    setPhase('form');
    setApiError('');
    setSteps([]);
  }

  // ── Shared styles ──────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--panel-soft)',
    color: 'var(--text)',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  };

  // ── Backdrop click: only allowed in form / error phase ─────────
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target !== e.currentTarget) return;
    if (phase === 'form' || phase === 'error') onClose();
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          width: '100%',
          maxWidth: 440,
          boxShadow: '0 24px 64px rgba(0,0,0,0.30)',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <div style={{ padding: '18px 20px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon
                icon={phase === 'done' ? Check : Sparkles}
                size="sm"
                style={{ color: phase === 'done' ? '#16a34a' : 'var(--accent)', transition: 'color 0.3s' }}
              />
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                {phase === 'form'
                  ? 'New Client'
                  : phase === 'creating'
                    ? 'Setting up…'
                    : phase === 'done'
                      ? 'Ready'
                      : 'Something went wrong'}
              </p>
            </div>
            <button
              onClick={onClose}
              title="Close"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--muted)',
                padding: 4,
                display: 'flex',
                alignItems: 'center',
                borderRadius: 6,
                opacity: 0.7,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
            >
              <Icon icon={X} size="md" />
            </button>
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* ── FORM PHASE ──────────────────────────────────────── */}
        {phase === 'form' && (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--muted)',
                  marginBottom: 6,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Client name <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>
              </label>
              <input
                autoFocus
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setFieldError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                }}
                placeholder="e.g. Acme Corporation"
                style={{ ...inputStyle, borderColor: fieldError ? 'var(--danger)' : 'var(--border)' }}
              />
              {fieldError && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '4px 0 0' }}>{fieldError}</p>}
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--muted)',
                  marginBottom: 6,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Website URL{' '}
                <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.6, textTransform: 'none', letterSpacing: 0 }}>
                  (optional)
                </span>
              </label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                }}
                placeholder="https://acme.com"
                type="url"
                style={inputStyle}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--muted)',
                  marginBottom: 6,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Notes{' '}
                <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.6, textTransform: 'none', letterSpacing: 0 }}>
                  (optional)
                </span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Industry, target audience, brand tone, anything useful…"
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
            </div>

            {(url.trim() || notes.trim()) && (
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--muted)',
                  margin: '-4px 0 0',
                  opacity: 0.65,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <Sparkles size={11} />
                We will analyze this to build client intelligence.
              </p>
            )}

            <button
              onClick={() => void handleCreate()}
              disabled={!displayName.trim()}
              className="btn btn-primary"
              style={{ marginTop: 2 }}
            >
              Create Client
            </button>
          </div>
        )}

        {/* ── CREATING / DONE / ERROR PHASES ──────────────────── */}
        {phase !== 'form' && (
          <div style={{ padding: '20px 20px 24px', display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* Client identity card */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                borderRadius: 10,
                background: 'var(--panel-soft)',
                border: '1px solid var(--border)',
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 9,
                  background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Building2 size={16} strokeWidth={1.75} style={{ color: 'var(--primary)' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--text)',
                    margin: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {pendingName}
                </p>
                {url.trim() && (
                  <p
                    style={{
                      fontSize: 12,
                      color: 'var(--muted)',
                      margin: '1px 0 0',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Globe size={10} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                    {url.replace(/^https?:\/\//, '')}
                  </p>
                )}
              </div>
            </div>

            {/* Step list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 20 }}>
              {steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </div>

            {/* Footer hint / status */}
            {phase === 'creating' && (
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, opacity: 0.55 }}>
                This usually takes 15–30 seconds. You can close this and we'll run it in the background.
              </p>
            )}

            {phase === 'done' && (
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--muted)',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Loader size={12} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                Opening {pendingName}…
              </p>
            )}

            {phase === 'error' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'color-mix(in srgb, #ef4444 8%, transparent)',
                    border: '1px solid color-mix(in srgb, #ef4444 20%, transparent)',
                  }}
                >
                  <AlertTriangle size={14} strokeWidth={2} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
                  <p style={{ fontSize: 12, color: '#ef4444', margin: 0, lineHeight: 1.5 }}>{apiError}</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleRetry} className="btn btn-primary" style={{ flex: 1 }}>
                    Try again
                  </button>
                  <button onClick={onClose} className="btn" style={{ flex: 1, border: '1px solid var(--border)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
