'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PresentationPage } from '@/components/PresentationPage';
import { useAuth } from '@/lib/auth-context';
import { generateMicrositeDirectly, listDesignSkillsApi } from '@/lib/api';
import { DesignSkillPicker } from '@/components/microsite/DesignSkillPicker';

const SS_KEY   = 'ms_wizard_state';
const LS_KEY   = 'ms_fast_gen_target';
const NS_KEY   = 'ms_namespace';
const BTN_ID   = 'fast-microsite-btn';
const STORE_KEY = 'ai-engine-namespace-panel'; // Zustand persisted store key

interface Target { namespace: string; proposalId: string }

/** Read target before PresentationPage's useEffect clears the snapshot. */
function captureTarget(): Target | null {
  if (typeof window === 'undefined') return null;
  const namespace = localStorage.getItem(NS_KEY) ?? '';

  // 1. sessionStorage snapshot (written by ProposalPage before navigation)
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (raw) {
      const snap = JSON.parse(raw) as {
        selectedProposal?: { fileName?: string };
        selectedNamespace?: string;
      };
      const ns       = snap.selectedNamespace ?? namespace;
      const fileName = snap.selectedProposal?.fileName;
      if (ns && fileName) {
        const t: Target = { namespace: ns, proposalId: fileName.replace(/\.md$/i, '') };
        localStorage.setItem(LS_KEY, JSON.stringify(t));
        return t;
      }
    }
  } catch { /* ignore */ }

  // 2. Last persisted target (survives step changes)
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const t = JSON.parse(raw) as Target;
      if (!namespace || t.namespace === namespace) return t;
    }
  } catch { /* ignore */ }

  // 3. Zustand namespace-panel store — use the single proposal if only one exists
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw && namespace) {
      const store = JSON.parse(raw) as {
        state?: { byNamespace?: Record<string, { proposals?: { fileName: string }[] }> }
      };
      const proposals = store.state?.byNamespace?.[namespace]?.proposals ?? [];
      if (proposals.length === 1) {
        const fileName = proposals[0].fileName;
        const t: Target = { namespace, proposalId: fileName.replace(/\.md$/i, '') };
        localStorage.setItem(LS_KEY, JSON.stringify(t));
        return t;
      }
    }
  } catch { /* ignore */ }

  return null;
}

export default function PresentationRoutePage() {
  const { apiKey } = useAuth();

  // Runs synchronously before PresentationPage's useEffect clears the snapshot
  const [target] = useState<Target | null>(captureTarget);
  const handlerRef = useRef<() => void>(() => {});

  // Design skill picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hasDesignSkills, setHasDesignSkills] = useState(false);
  const pendingResolvedRef = useRef<Target | null>(null);

  // Check if any design skills exist (once) to decide whether to show picker
  useEffect(() => {
    if (!apiKey) return;
    listDesignSkillsApi(apiKey)
      .then((skills) => setHasDesignSkills(skills.length > 0))
      .catch(() => {});
  }, [apiKey]);

  const runGenerate = useCallback(async (resolved: Target, designSkillSlug: string | null) => {
    const btn = document.getElementById(BTN_ID) as HTMLButtonElement | null;
    if (!btn) return;

    btn.dataset.state = 'generating';
    btn.textContent   = '⏳ Generating…';
    btn.disabled      = true;
    btn.style.opacity = '0.75';
    btn.style.cursor  = 'default';

    try {
      const { elapsed } = await generateMicrositeDirectly(
        apiKey!, resolved.namespace, resolved.proposalId,
        designSkillSlug ?? undefined,
      );
      const viewerUrl      = `/microsite-view/${resolved.namespace}/${resolved.proposalId}`;
      btn.dataset.state    = 'done';
      btn.dataset.url      = viewerUrl;
      btn.textContent      = `✅ Open Result (${Math.round(elapsed / 1000)}s)`;
      btn.disabled         = false;
      btn.style.opacity    = '1';
      btn.style.cursor     = 'pointer';
      btn.style.background = '#22c55e';
      btn.style.color      = '#000';
    } catch (err) {
      btn.dataset.state    = 'idle';
      btn.textContent      = '⚡ Generate Fast Microsite';
      btn.disabled         = false;
      btn.style.opacity    = '1';
      btn.style.cursor     = 'pointer';
      btn.style.background = '#f59e0b';
      alert(`Generation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [apiKey]);

  const handlePickerSelect = useCallback((designSkillSlug: string | null) => {
    setPickerOpen(false);
    const resolved = pendingResolvedRef.current;
    if (resolved) void runGenerate(resolved, designSkillSlug);
  }, [runGenerate]);

  const handlePickerCancel = useCallback(() => {
    setPickerOpen(false);
    pendingResolvedRef.current = null;
    const btn = document.getElementById(BTN_ID) as HTMLButtonElement | null;
    if (btn) {
      btn.dataset.state = 'idle';
      btn.textContent   = '⚡ Generate Fast Microsite';
      btn.disabled      = false;
      btn.style.opacity = '1';
      btn.style.cursor  = 'pointer';
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    const btn = document.getElementById(BTN_ID) as HTMLButtonElement | null;
    if (!btn || btn.dataset.state === 'generating') return;

    if (btn.dataset.state === 'done') {
      window.open(btn.dataset.url ?? '', '_blank');
      return;
    }

    if (!apiKey) { alert('Not authenticated.'); return; }

    const resolved = target ?? captureTarget();
    if (!resolved) {
      alert('Could not resolve the selected proposal. Please select a proposal first.');
      return;
    }

    if (hasDesignSkills) {
      // Store resolved target and show picker — runGenerate fires from handlePickerSelect
      pendingResolvedRef.current = resolved;
      setPickerOpen(true);
      return;
    }

    // No design skills exist — generate directly with default
    void runGenerate(resolved, null);
  }, [apiKey, target, hasDesignSkills, runGenerate]);

  useEffect(() => { handlerRef.current = handleGenerate; }, [handleGenerate]);


  useEffect(() => {
    function inject() {
      if (document.getElementById(BTN_ID)) return;

      // Find the modal close button — it has aria-label="Close" and is always in the header
      const closeBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
      if (!closeBtn) return;

      const btn             = document.createElement('button');
      btn.id                = BTN_ID;
      btn.dataset.state     = 'idle';
      btn.textContent       = '⚡ Generate Fast Microsite';
      btn.title             = 'Single LLM call — skips the multi-step pipeline (~20 s)';
      btn.style.cssText     = [
        'display:none',
        'padding:6px 14px',
        'border-radius:6px',
        'border:none',
        'background:#f59e0b',
        'color:#000',
        'font-weight:700',
        'font-size:13px',
        'cursor:pointer',
        'font-family:inherit',
        'white-space:nowrap',
        'flex-shrink:0',
        'margin-right:8px',
      ].join(';');
      btn.addEventListener('click', () => handlerRef.current());

      // Insert before the × close button, inside the modal header
      closeBtn.parentElement?.insertBefore(btn, closeBtn);
    }

    inject();
    const observer = new MutationObserver(inject);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.getElementById(BTN_ID)?.remove();
    };
  }, []);

  return (
    <>
      <PresentationPage />
      {pickerOpen && (
        <DesignSkillPicker
          onSelect={handlePickerSelect}
          onCancel={handlePickerCancel}
        />
      )}
    </>
  );
}
