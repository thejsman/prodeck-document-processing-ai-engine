'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useExecutionStore } from '@/core/execution/execution-store';
import {
  fetchNamespaces,
  fetchProposals,
  fetchProposalContent,
  fetchMicrositeContent,
  synthesizeDesignStyle,
  generateMicrositeStream,
  runAgent,
  type StreamEvent,
  type ProposalFile,
  type SynthesizedDesignSystem,
} from '@/lib/api';
import type { LayoutAST, BrandConfig } from '@/types/presentation';
import { PLUGINS, fetchPluginsFromApi, DEFAULT_PLUGIN_IDS, THEME_REGISTRY, type ThemeDefinition } from '@/lib/presentation/pluginRegistry';
import type { PluginMeta } from '@/types/presentation';
import { Microsite } from './microsite/Microsite';
import { MicrositeEditor } from './microsite/editor/MicrositeEditor';
import { MicrositeHistory } from './microsite/MicrositeHistory';
import { ThemeModal } from './microsite/ThemeModal';
import { ThemeFullPreview } from './microsite/ThemeFullPreview';
import { ThemePreviewCard } from './microsite/ThemePreviewCard';
import { getPlugin } from '@/lib/presentation/pluginRegistry';
import { useMicrositeHistory } from '@/lib/useMicrositeHistory';

// ── Pipeline steps ───────────────────────────────────────────────────────────
type StepId = 'upload' | 'brand' | 'plugin' | 'generate' | 'preview';

const STEPS: Array<{ id: StepId; label: string; description: string }> = [
  { id: 'upload',   label: 'Select Proposal', description: 'Choose a source proposal' },
  { id: 'brand',    label: 'Brand Setup',     description: 'Your identity & colors' },
  { id: 'plugin',   label: 'Choose Style',    description: 'Pick a design system' },
  { id: 'generate', label: 'Generate',        description: 'AI builds your microsite' },
  { id: 'preview',  label: 'Preview',         description: 'Review the result' },
];

interface ProgressItem { text: string; done: boolean; }


// ── Color extraction utilities ────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      case bn: h = ((rn - gn) / d + 4) / 6; break;
    }
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function complementaryHex(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const [nr, ng, nb] = hslToRgb((h + 0.5) % 1, Math.max(s, 0.3), l < 0.4 ? 0.65 : 0.25);
  return rgbToHex(nr, ng, nb);
}

function extractSvgColors(svgText: string): string[] {
  const colors: string[] = [];
  const hexRe = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(svgText)) !== null) {
    const hex = m[0].length === 4
      ? '#' + m[1].split('').map(c => c + c).join('')
      : m[0];
    const [r, g, b] = hexToRgb(hex);
    const brightness = (r + g + b) / 3;
    const [, s] = rgbToHsl(r, g, b);
    if (brightness > 20 && brightness < 235 && s > 0.1) colors.push(hex.toLowerCase());
  }
  return [...new Set(colors)];
}

function extractColorsFromCanvas(dataUrl: string): Promise<{ primary: string; secondary: string }> {
  return new Promise(resolve => {
    const fallback = { primary: '#C8A96E', secondary: '#1A1612' };
    const img = new Image();
    img.onload = () => {
      try {
        const size = 80;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(fallback); return; }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        const buckets = new Map<string, number>();
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 128) continue;
          const r = Math.round(data[i] / 32) * 32;
          const g = Math.round(data[i + 1] / 32) * 32;
          const b = Math.round(data[i + 2] / 32) * 32;
          const brightness = (r + g + b) / 3;
          const [, s] = rgbToHsl(r, g, b);
          if (brightness < 25 || brightness > 230 || s < 0.08) continue;
          const key = `${r},${g},${b}`;
          buckets.set(key, (buckets.get(key) ?? 0) + 1);
        }

        const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
        if (sorted.length === 0) { resolve(fallback); return; }

        const toHex = (k: string) => {
          const [r, g, b] = k.split(',').map(Number);
          return rgbToHex(r, g, b);
        };

        const primary = toHex(sorted[0][0]);

        if (sorted.length >= 2) {
          const [r1, g1, b1] = sorted[0][0].split(',').map(Number);
          const [r2, g2, b2] = sorted[1][0].split(',').map(Number);
          const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
          if (diff > 64) { resolve({ primary, secondary: toHex(sorted[1][0]) }); return; }
        }

        resolve({ primary, secondary: complementaryHex(primary) });
      } catch {
        resolve(fallback);
      }
    };
    img.onerror = () => resolve(fallback);
    img.src = dataUrl;
  });
}

async function extractLogoColors(
  file: File,
  dataUrl: string,
): Promise<{ primary: string; secondary: string }> {
  if (file.type === 'image/svg+xml') {
    const text = await file.text();
    const svgColors = extractSvgColors(text);
    if (svgColors.length >= 2) return { primary: svgColors[0], secondary: svgColors[1] };
    if (svgColors.length === 1) return { primary: svgColors[0], secondary: complementaryHex(svgColors[0]) };
  }
  return extractColorsFromCanvas(dataUrl);
}

// ── Session-storage key for wizard state ──────────────────────────────────────
const SS_KEY = 'ms_wizard_state';

interface WizardSnapshot {
  step: StepId;
  wasGenerating: boolean;
  progress: ProgressItem[];
  streamingSections: string[];
  error: string | null;
  selectedNamespace: string;
  selectedProposal: ProposalFile | null;
}

function readSnapshot(): WizardSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    return raw ? (JSON.parse(raw) as WizardSnapshot) : null;
  } catch { return null; }
}

function writeSnapshot(s: WizardSnapshot) {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function clearSnapshot() {
  if (typeof window === 'undefined') return;
  try { sessionStorage.removeItem(SS_KEY); } catch { /* ignore */ }
}

// ── Main Component ───────────────────────────────────────────────────────────
export function PresentationPage() {
  const { apiKey } = useAuth();
  const addExecution = useExecutionStore((s) => s.addExecution);
  const updateExecution = useExecutionStore((s) => s.updateExecution);

  // Restore wizard state from sessionStorage on mount
  const _snap = readSnapshot();

  // Wizard state
  const [step, setStep] = useState<StepId>(() => {
    // If there's a saved generate/preview step, restore it
    if (_snap && (_snap.step === 'generate' || _snap.step === 'preview')) return _snap.step;
    return 'upload';
  });

  // Step 1
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [namespacesLoading, setNamespacesLoading] = useState(false);
  const [selectedNamespace, setSelectedNamespace] = useState<string>(() => {
    if (_snap?.selectedNamespace) return _snap.selectedNamespace;
    return typeof window !== 'undefined' ? localStorage.getItem('ms_namespace') || '' : '';
  });
  const [proposals, setProposals] = useState<ProposalFile[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [proposalsError, setProposalsError] = useState<string | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<ProposalFile | null>(() => _snap?.selectedProposal ?? null);
  const [mdContent, setMdContent] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);

  // Step 2
  const prevNamespaceRef = useRef<string>('');
  const [brand, setBrand] = useState<BrandConfig>({
    companyName: 'Meridian Studio',
    tagline: 'Strategy & Design Consultancy',
    logoUrl: null,
    logoText: 'Meridian Studio',
    primaryColor: '#C8A96E',
    secondaryColor: '#1A1612',
  });

  // Step 2 – logo extraction
  const [logoExtracting, setLogoExtracting] = useState(false);
  const [colorsAutoExtracted, setColorsAutoExtracted] = useState(false);

  // Plugin list — fetched from API on mount, falls back to static PLUGINS
  const [pluginList, setPluginList] = useState<PluginMeta[]>(PLUGINS);

  // Step 3
  const [designBrief, setDesignBrief] = useState('');
  const [brandImagePrompt, setBrandImagePrompt] = useState<string>('');
  const [synthStatus, setSynthStatus] = useState<null | 'scanning' | 'building' | 'ready'>(null);
  const [synthesizedDesign, setSynthesizedDesign] = useState<SynthesizedDesignSystem | null>(null);
  const [synthError, setSynthError] = useState<string | null>(null);
  // Step 3 — null means "no theme / default styling"
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(() => {
    if (typeof window === 'undefined') return 'obsidian';
    return localStorage.getItem('presentation-builder-theme') ?? 'obsidian';
  });
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [previewTheme, setPreviewTheme] = useState<ThemeDefinition | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');

  // Step 4
  const [generating, setGenerating] = useState(false);
  // If we restored a snapshot where generation was running, track that separately
  const [wasGenerating, setWasGenerating] = useState(() => !!(_snap?.wasGenerating && _snap.step === 'generate'));
  const [progress, setProgress] = useState<ProgressItem[]>(() => _snap?.step === 'generate' ? (_snap.progress ?? []) : []);
  const [error, setError] = useState<string | null>(() => _snap?.step === 'generate' ? (_snap.error ?? null) : null);
  const [streamingSections, setStreamingSections] = useState<string[]>(() => _snap?.step === 'generate' ? (_snap.streamingSections ?? []) : []);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 5
  const [layoutAST, setLayoutAST] = useState<LayoutAST | null>(null);
  const [loadingAST, setLoadingAST] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  // Stores last generated markdown — used as input on regeneration instead of original proposal
  const [generatedMarkdown, setGeneratedMarkdown] = useState<string | null>(null);

  // History
  const [activeTab, setActiveTab] = useState<'generate' | 'history'>(() => {
    if (typeof window === 'undefined') return 'generate';
    return (localStorage.getItem('ms_activeTab') as 'generate' | 'history') || 'generate';
  });
  // addEntry scoped to selectedNamespace; totalHistory unfiltered for accurate tab count
  const { addEntry } = useMicrositeHistory(selectedNamespace);
  const { history: totalHistory } = useMicrositeHistory();

  const handleTabChange = (tab: 'generate' | 'history') => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') localStorage.setItem('ms_activeTab', tab);
  };

  // Unified preview handler — opens ThemeFullPreview for any theme
  const handlePreview = (id: string) => {
    const theme = THEME_REGISTRY.find(t => t.id === id);
    if (theme) setPreviewTheme(theme);
  };

  // Persist selected theme to localStorage
  const handleSelectPlugin = (id: string | null) => {
    setSelectedPlugin(id);
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem('presentation-builder-theme', id);
      else localStorage.removeItem('presentation-builder-theme');
    }
  };

  // ── Escape key: close ThemeModal (ThemeFullPreview handles its own Escape) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // ThemeFullPreview has its own Escape handler — let it fire first.
      // We only close the modal when no preview is open.
      if (previewTheme) return;
      if (isThemeModalOpen) setIsThemeModalOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewTheme, isThemeModalOpen]);

  // ── Persist wizard step + generation state to sessionStorage ──────────────
  useEffect(() => {
    if (step === 'generate' || step === 'preview') {
      writeSnapshot({
        step,
        wasGenerating: generating,
        progress,
        streamingSections,
        error,
        selectedNamespace,
        selectedProposal,
      });
    } else {
      // Back to earlier steps — clear the snapshot
      clearSnapshot();
    }
  }, [step, generating, progress, streamingSections, error, selectedNamespace, selectedProposal]);

  // ── When restored to generate step with wasGenerating, auto-check for result ──
  useEffect(() => {
    if (!wasGenerating || !apiKey || !selectedNamespace || !selectedProposal) return;
    // Clear the flag immediately to avoid re-running
    setWasGenerating(false);
    setProgress(p => {
      const last = p[p.length - 1];
      if (!last || last.text.startsWith('Checking')) return [...p, { text: 'Checking for results…', done: false }];
      return p;
    });
    fetchMicrositeContent(apiKey, selectedNamespace, selectedProposal.fileName.replace(/\.md$/, ''))
      .then(ast => {
        if (ast && typeof ast === 'object' && (ast as { sections?: unknown[] }).sections?.length) {
          setLayoutAST(ast as LayoutAST);
          setProgress(p => p.map((x, i) => i === p.length - 1 ? { ...x, text: 'Microsite ready!', done: true } : x));
          setTimeout(() => { clearSnapshot(); setStep('preview'); }, 600);
        } else {
          setProgress(p => p.map((x, i) => i === p.length - 1 ? { ...x, text: 'Generation was interrupted — click Generate to restart.', done: false } : x));
        }
      })
      .catch(() => {
        setProgress(p => p.map((x, i) => i === p.length - 1 ? { ...x, text: 'Generation was interrupted — click Generate to restart.', done: false } : x));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasGenerating]);

  useEffect(() => {
    if (selectedNamespace) {
      setBrand(b => {
        const wasAutoSet =
          b.companyName === 'Meridian Studio' ||
          b.companyName === prevNamespaceRef.current;
        prevNamespaceRef.current = selectedNamespace;
        return {
          ...b,
          companyName: wasAutoSet ? selectedNamespace : b.companyName,
          logoText: wasAutoSet ? selectedNamespace : b.logoText,
        };
      });
    }
  }, [selectedNamespace]);

  // Fetch plugin list from API once on mount (Phase 5: dynamic discovery)
  useEffect(() => {
    if (!apiKey) return;
    fetchPluginsFromApi(apiKey).then(setPluginList).catch(() => {});
  }, [apiKey]);

  useEffect(() => {
    if (step !== 'upload' || !apiKey) return;
    setNamespacesLoading(true);
    fetchNamespaces(apiKey)
      .then(setNamespaces)
      .catch(() => {})
      .finally(() => setNamespacesLoading(false));
  }, [step, apiKey]);

  useEffect(() => {
    setProposals([]);
    setSelectedProposal(null);
    setMdContent('');
    setProposalsError(null);
  }, [selectedNamespace]);

  useEffect(() => {
    if (step !== 'upload' || !apiKey || !selectedNamespace) return;
    setProposalsLoading(true);
    const nsKey = selectedNamespace.toLowerCase().replace(/[^a-z0-9]/g, '');
    fetchProposals(apiKey)
      .then(all =>
        setProposals(
          all.filter(p => {
            if (p.status !== 'approved') return false;
            const clientKey = p.client.toLowerCase().replace(/[^a-z0-9]/g, '');
            return clientKey.includes(nsKey) || nsKey.includes(clientKey);
          }),
        ),
      )
      .catch(e => setProposalsError((e as Error).message))
      .finally(() => setProposalsLoading(false));
  }, [step, apiKey, selectedNamespace]);

  const selectProposal = useCallback(async (p: ProposalFile) => {
    if (!apiKey) return;
    setSelectedProposal(p);
    setLoadingContent(true);
    try {
      const doc = await fetchProposalContent(apiKey, p.fileName);
      setMdContent(doc.content);
    } catch (e) {
      setProposalsError(`Could not load proposal: ${(e as Error).message}`);
      setSelectedProposal(null);
    } finally {
      setLoadingContent(false);
    }
  }, [apiKey]);

  const stepIdx = STEPS.findIndex(s => s.id === step);

  // Restore layoutAST from disk when navigating to preview without an in-memory AST
  useEffect(() => {
    if (step !== 'preview' || layoutAST || !apiKey || !selectedNamespace || !selectedProposal) return;
    setLoadingAST(true);
    fetchMicrositeContent(apiKey, selectedNamespace, selectedProposal.fileName.replace(/\.md$/, ''))
      .then(ast => {
        if (ast && typeof ast === 'object' && (ast as { sections?: unknown[] }).sections?.length) {
          setLayoutAST(ast as LayoutAST);
        }
      })
      .catch(() => { /* no saved AST — fallback message already shown */ })
      .finally(() => setLoadingAST(false));
  }, [step, layoutAST, apiKey, selectedNamespace, selectedProposal]);

  const runPipeline = useCallback(async () => {
    if (!apiKey || !selectedNamespace) return;
    setGenerating(true);
    setError(null);
    setProgress([]);
    setLayoutAST(null);

    const execId = crypto.randomUUID();
    addExecution({
      id: execId,
      type: 'microsite',
      status: 'running',
      title: selectedProposal?.client ?? selectedNamespace,
    });

    const abortCtrl = new AbortController();

    try {
      setStreamingSections([]);
      setProgress([{ text: 'Connecting to AI pipeline...', done: true }]);
      setProgress(p => [...p, { text: 'Running design synthesis + section planning...', done: false }]);

      const isCustomSynth = selectedPlugin === 'custom-synthesized' && synthesizedDesign;
      const sourceMarkdown = generatedMarkdown ?? mdContent;

      const result = await runAgent(apiKey, {
        agent: 'microsite-generator-agent',
        namespace: selectedNamespace,
        input: {
          ...((customPrompt || designBrief).trim() ? { prompt: (customPrompt || designBrief).trim() } : {}),
          metadata: {
            proposalMarkdown: sourceMarkdown,
            plugin: selectedPlugin ?? 'none',
            brand: {
              companyName: brand.companyName,
              tagline: brand.tagline,
              logoText: brand.logoText,
              primaryColor: brand.primaryColor,
              secondaryColor: brand.secondaryColor,
              logoUrl: brand.logoUrl,
            },
            ...((customPrompt || designBrief).trim() ? { customInstructions: (customPrompt || designBrief).trim() } : {}),
            ...(designBrief.trim() ? { designBrief: designBrief.trim() } : {}),
            ...(isCustomSynth ? { preSynthesizedDesignSystem: { rawTokens: synthesizedDesign.designSystem } } : {}),
          },
        },
      });

      setProgress(p => p.map((x, i) => i === p.length - 1 ? { ...x, done: true } : x));
      setProgress(p => [...p, { text: 'Processing agent response...', done: false }]);

      let ast: LayoutAST | null = null;
      if (result.json && typeof result.json === 'object') {
        ast = result.json as LayoutAST;
      }

      if (ast && ast.sections?.length > 0) {
        ast.brand = {
          companyName: brand.companyName,
          tagline: brand.tagline,
          logoUrl: brand.logoUrl,
          logoText: brand.logoText,
          primaryColor: brand.primaryColor,
          secondaryColor: brand.secondaryColor,
        };
        // null → fall back to 'ivory' (cleanest/lightest) for renderer
        ast.plugin = selectedPlugin ?? 'ivory';
        setLayoutAST(ast);
        addEntry(ast);
        // Store generated markdown so next regeneration refines this output, not original proposal
        if (result.markdown) setGeneratedMarkdown(result.markdown);
      }

      setProgress(p => p.map((x, i) => i === p.length - 1 ? { ...x, done: true } : x));
      setProgress(p => [...p, { text: 'Microsite ready!', done: true }]);
      updateExecution(execId, { status: 'completed' });
      setTimeout(() => { clearSnapshot(); setStep('preview'); }, 600);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message);
        updateExecution(execId, { status: 'failed', errorMessage: (e as Error).message });
      }
    } finally {
      setGenerating(false);
    }
  }, [apiKey, selectedNamespace, mdContent, generatedMarkdown, selectedPlugin, brand, customPrompt, designBrief, synthesizedDesign, addExecution, updateExecution, selectedProposal]);

  // ── Preview loading state ──────────────────────────────────────────────────
  // If not actively loading and still no AST, fall back to upload step
  if (step === 'preview' && !loadingAST && !layoutAST) {
    clearSnapshot();
    setStep('upload');
    return null;
  }
  if (step === 'preview' && loadingAST) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: 'var(--color-bg, #0a0a0a)',
        gap: 16,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          border: '3px solid var(--color-border, #333)',
          borderTopColor: 'var(--color-accent, #7c6aff)',
          animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{ color: 'var(--color-text-muted, #888)', fontFamily: 'sans-serif', fontSize: 14 }}>
          {loadingAST ? 'Loading microsite…' : 'Building preview…'}
        </p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  // ── Preview mode: delegate entirely to Microsite (it handles fullscreen + portal buttons) ──
  if (step === 'preview' && layoutAST) {
    if (showEditor) {
      return (
        <MicrositeEditor
          ast={layoutAST}
          namespace={selectedNamespace}
          proposalId={selectedProposal?.fileName.replace(/\.md$/, '') ?? selectedNamespace}
          onClose={() => setShowEditor(false)}
          onExport={editedAst => {
            setLayoutAST(editedAst);
            setShowEditor(false);
          }}
        />
      );
    }
    return (
      <Microsite
        ast={layoutAST}
        onBack={() => setStep('plugin')}
        onRegenerate={() => setStep('plugin')}
        onEdit={() => setShowEditor(true)}
      />
    );
  }

  // ── Wizard steps ─────────────────────────────────────────────────────────
  return (
    <>
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 24px' }}>

      {/* Page header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1>Presentation Builder</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Transform a proposal into a high-end presentation microsite
          </p>
        </div>
      </div>

      {/* ── Tab strip ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--color-border)' }}>
        {(['generate', 'history'] as const).map(tab => {
          const isActive = activeTab === tab;
          const label = tab === 'generate'
            ? 'Generate'
            : `History${totalHistory.length > 0 ? ` (${totalHistory.length})` : ''}`;
          return (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              style={{
                padding: '8px 16px', background: 'none', border: 'none',
                borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
                marginBottom: -1, fontWeight: isActive ? 700 : 500, fontSize: 13,
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                cursor: 'pointer', transition: 'color 0.15s',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {activeTab === 'history' ? (
        <MicrositeHistory />
      ) : (<>

      {/* Stepper */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, marginBottom: 32, position: 'relative' }}>
        <div style={{
          position: 'absolute', top: 17, left: '10%', right: '10%',
          height: 2, background: 'var(--color-border)', zIndex: 0,
        }} />
        {STEPS.map((s, i) => {
          const isActive = s.id === step;
          const isDone = stepIdx > i;
          return (
            <div
              key={s.id}
              onClick={() => isDone && setStep(s.id)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 8, position: 'relative', zIndex: 1,
                cursor: isDone ? 'pointer' : 'default',
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, flexShrink: 0,
                background: isActive ? 'var(--color-primary)' : isDone ? 'var(--color-success)' : 'var(--color-surface)',
                border: `2px solid ${isActive ? 'var(--color-primary)' : isDone ? 'var(--color-success)' : 'var(--color-border)'}`,
                color: isActive || isDone ? '#fff' : 'var(--color-text-muted)',
                transition: 'all 0.2s',
                boxShadow: isActive ? '0 0 0 4px rgba(37,99,235,0.15)' : 'none',
              }}>
                {isDone ? '✓' : i + 1}
              </div>
              <div style={{ textAlign: 'center' }}>
                <p style={{
                  fontSize: 12, fontWeight: isActive ? 700 : 500, margin: 0, lineHeight: 1.3,
                  color: isActive ? 'var(--color-primary)' : isDone ? 'var(--color-text)' : 'var(--color-text-muted)',
                }}>
                  {s.label}
                </p>
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: 0, marginTop: 2 }}>
                  {s.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Card header strip */}
        <div style={{
          padding: '14px 24px', borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg)', display: 'flex', alignItems: 'center', gap: 10,
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: 'var(--color-primary)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, flexShrink: 0,
            }}>
              {stepIdx + 1}
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', margin: 0, lineHeight: 1.2 }}>
                {STEPS[stepIdx].label}
              </p>
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: 0 }}>
                {STEPS[stepIdx].description}
              </p>
            </div>
          </div>
          {step === 'plugin' && (
            <button
              onClick={() => setIsThemeModalOpen(true)}
              style={{
                background: 'none',
                border: '1px solid var(--color-border)',
                borderRadius: 8, padding: '6px 12px',
                fontSize: 12, fontWeight: 600,
                color: 'var(--color-text-muted)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                flexShrink: 0,
              }}
            >
              More themes →
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 100,
                background: 'var(--color-border)', color: 'var(--color-text-muted)',
              }}>+10</span>
            </button>
          )}
        </div>

        {/* Card body */}
        <div style={{ padding: 24 }}>

          {/* ═══ STEP 1: SELECT PROPOSAL ═══ */}
          {step === 'upload' && (
            <div>
              {/* Namespace */}
              <div className="form-group">
                <label>Namespace</label>
                <div style={{ position: 'relative' }}>
                  <select
                    className="select"
                    value={selectedNamespace}
                    disabled={namespacesLoading}
                    onChange={e => { setSelectedNamespace(e.target.value); localStorage.setItem('ms_namespace', e.target.value); }}
                  >
                    <option value="">{namespacesLoading ? 'Loading namespaces…' : 'Select a namespace…'}</option>
                    {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
                  </select>
                </div>
                {selectedNamespace && (
                  <p className="muted" style={{ marginTop: 4 }}>
                    Showing approved proposals for <strong style={{ color: 'var(--color-text)' }}>{selectedNamespace}</strong>
                  </p>
                )}
              </div>

              {/* Proposal list */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ color: selectedNamespace ? undefined : 'var(--color-border)' }}>Proposal</label>

                {!selectedNamespace && (
                  <div style={{
                    padding: '2rem', textAlign: 'center',
                    border: '1px dashed var(--color-border)', borderRadius: 'var(--radius)',
                  }}>
                    <p className="muted">Select a namespace first</p>
                  </div>
                )}

                {selectedNamespace && proposalsLoading && (
                  <p className="loading">Loading proposals…</p>
                )}

                {selectedNamespace && proposalsError && !proposalsLoading && (
                  <p className="error">{proposalsError}</p>
                )}

                {selectedNamespace && !proposalsLoading && !proposalsError && proposals.length === 0 && (
                  <div style={{
                    padding: '2rem', textAlign: 'center',
                    border: '1px dashed var(--color-border)', borderRadius: 'var(--radius)',
                  }}>
                    <p className="muted">No approved proposals found in <strong>{selectedNamespace}</strong>. Approve a proposal first.</p>
                  </div>
                )}

                {selectedNamespace && !proposalsLoading && proposals.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem' }}>
                    {proposals.map(p => {
                      const isSelected = selectedProposal?.fileName === p.fileName;
                      return (
                        <button
                          key={p.fileName}
                          onClick={() => selectProposal(p)}
                          style={{
                            textAlign: 'left', padding: '12px 14px',
                            borderRadius: 'var(--radius)', cursor: 'pointer',
                            border: `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                            background: isSelected ? '#eff6ff' : 'var(--color-surface)',
                            boxShadow: isSelected ? '0 0 0 2px #bfdbfe' : 'var(--shadow)',
                            transition: 'border-color 0.15s',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text)' }}>
                              {p.client || p.fileName}
                            </span>
                            <span className="badge" style={{ background: '#16a34a18', color: 'var(--color-success)', border: 'none', fontSize: 11 }}>
                              approved
                            </span>
                          </div>
                          <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>{p.fileName}</p>
                          {p.createdAt && (
                            <p className="muted" style={{ fontSize: 11 }}>{new Date(p.createdAt).toLocaleDateString()}</p>
                          )}
                          {isSelected && loadingContent && <p className="loading" style={{ marginTop: 4 }}>Loading content…</p>}
                          {isSelected && !loadingContent && mdContent && (
                            <p style={{ fontSize: 11, color: 'var(--color-success)', marginTop: 4 }}>✓ Loaded</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ STEP 2: BRAND SETUP ═══ */}
          {step === 'brand' && (
            <div>
              <div className="form-row">
                {/* Company name */}
                <div className="form-group">
                  <label>Company / Logo Name</label>
                  <input
                    type="text"
                    className="input"
                    value={brand.companyName}
                    onChange={e => setBrand(b => ({ ...b, companyName: e.target.value }))}
                  />
                </div>

                {/* Logo upload — PNG & SVG only */}
                <div className="form-group">
                  <label>Logo (PNG or SVG)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {brand.logoUrl && (
                      <div style={{
                        width: 48, height: 48, borderRadius: 'var(--radius)',
                        border: '1px solid var(--color-border)', overflow: 'hidden', flexShrink: 0,
                        background: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={brand.logoUrl} alt="logo preview" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      </div>
                    )}
                    <label style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '8px 10px', borderRadius: 'var(--radius)', cursor: logoExtracting ? 'not-allowed' : 'pointer',
                      border: '1px dashed var(--color-border)', background: 'var(--color-surface)',
                      color: 'var(--color-text-muted)', fontSize: 13,
                      opacity: logoExtracting ? 0.6 : 1,
                    }}>
                      {logoExtracting ? '⏳ Extracting colors…' : `↑ ${brand.logoUrl ? 'Change logo' : 'Upload logo'}`}
                      <input
                        type="file"
                        accept="image/png,image/svg+xml"
                        style={{ display: 'none' }}
                        disabled={logoExtracting}
                        onChange={async e => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = async ev => {
                            const dataUrl = ev.target?.result as string;
                            setBrand(b => ({ ...b, logoUrl: dataUrl }));
                            setLogoExtracting(true);
                            setColorsAutoExtracted(false);
                            try {
                              const { primary, secondary } = await extractLogoColors(file, dataUrl);
                              setBrand(b => ({ ...b, primaryColor: primary, secondaryColor: secondary }));
                              setColorsAutoExtracted(true);
                            } finally {
                              setLogoExtracting(false);
                            }
                          };
                          reader.readAsDataURL(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {brand.logoUrl && !logoExtracting && (
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          setBrand(b => ({ ...b, logoUrl: null }));
                          setColorsAutoExtracted(false);
                        }}
                        title="Remove logo"
                      >✕</button>
                    )}
                  </div>
                  {colorsAutoExtracted && !logoExtracting && (
                    <p style={{ fontSize: 11, color: 'var(--color-success)', marginTop: 4 }}>
                      ✓ Colors auto-extracted from logo — you can override below
                    </p>
                  )}
                </div>
              </div>

              <div className="form-row">
                {/* Tagline */}
                <div className="form-group">
                  <label>Tagline</label>
                  <input type="text" className="input" value={brand.tagline}
                    onChange={e => setBrand(b => ({ ...b, tagline: e.target.value }))} />
                </div>

                {/* Primary color */}
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    Primary Color (accent)
                    {colorsAutoExtracted && (
                      <span className="badge" style={{ fontSize: 10, background: 'var(--color-success)', color: '#fff', border: 'none' }}>auto</span>
                    )}
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="color"
                      value={brand.primaryColor || '#888888'}
                      onChange={e => { setBrand(b => ({ ...b, primaryColor: e.target.value })); setColorsAutoExtracted(false); }}
                      style={{ width: 38, height: 38, borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', padding: 2, cursor: 'pointer' }}
                    />
                    <input
                      type="text"
                      className="input"
                      value={brand.primaryColor}
                      onChange={e => { setBrand(b => ({ ...b, primaryColor: e.target.value })); setColorsAutoExtracted(false); }}
                      style={{ fontFamily: 'monospace' }}
                    />
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  Secondary Color
                  {colorsAutoExtracted && (
                    <span className="badge" style={{ fontSize: 10, background: 'var(--color-success)', color: '#fff', border: 'none' }}>auto</span>
                  )}
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={brand.secondaryColor || '#888888'}
                    onChange={e => { setBrand(b => ({ ...b, secondaryColor: e.target.value })); setColorsAutoExtracted(false); }}
                    style={{ width: 38, height: 38, borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', padding: 2, cursor: 'pointer' }}
                  />
                  <input
                    type="text"
                    className="input"
                    value={brand.secondaryColor}
                    onChange={e => { setBrand(b => ({ ...b, secondaryColor: e.target.value })); setColorsAutoExtracted(false); }}
                    style={{ fontFamily: 'monospace' }}
                  />
                </div>
              </div>

              {/* Brand preview */}
              <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 'var(--radius)',
                  background: brand.logoUrl ? 'transparent' : (brand.primaryColor || 'var(--color-border)'),
                  border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '1rem', fontWeight: 700, color: '#fff', flexShrink: 0, overflow: 'hidden',
                }}>
                  {brand.logoUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={brand.logoUrl} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    : (brand.companyName?.[0] || '?')}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 600, fontSize: 13, margin: 0 }}>{brand.companyName || 'Company Name'}</p>
                  <p className="muted" style={{ fontSize: 12 }}>{brand.tagline || 'Tagline'}</p>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[brand.primaryColor, brand.secondaryColor].map((c, i) =>
                    c ? <div key={i} style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: '1px solid var(--color-border)' }} /> : null
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ═══ STEP 3: CHOOSE STYLE ═══ */}
          {step === 'plugin' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 14 }}>

                {/* ── Default 4 theme cards — same ThemePreviewCard as expanded panel ── */}
                {THEME_REGISTRY.filter(t => DEFAULT_PLUGIN_IDS.includes(t.id)).map(theme => (
                  <ThemePreviewCard
                    key={theme.id}
                    theme={theme}
                    selected={selectedPlugin === theme.id}
                    onSelect={handleSelectPlugin}
                    onPreview={handlePreview}
                  />
                ))}

                {/* ── No Theme card ── */}
                {(() => {
                  const noThemeActive = selectedPlugin === null;
                  return (
                    <button
                      key="no-theme"
                      onClick={() => handleSelectPlugin(noThemeActive ? 'obsidian' : null)}
                      title="Generate without a design theme"
                      style={{
                        background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                        border: `2px solid ${noThemeActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        borderRadius: 12, overflow: 'hidden',
                        boxShadow: noThemeActive ? '0 0 0 3px #bfdbfe' : 'var(--shadow)',
                        transition: 'border-color 0.2s',
                      }}
                    >
                      <div style={{
                        height: 130, position: 'relative', overflow: 'hidden',
                        background: 'repeating-linear-gradient(45deg, var(--color-bg) 0px, var(--color-bg) 8px, var(--color-border) 8px, var(--color-border) 9px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <span style={{ fontSize: 32, opacity: 0.2, color: 'var(--color-text)' }}>∅</span>
                        {noThemeActive && (
                          <div style={{
                            position: 'absolute', top: 7, right: 7, width: 20, height: 20, borderRadius: '50%',
                            background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, color: '#fff',
                          }}>✓</div>
                        )}
                      </div>
                      <div style={{
                        padding: '10px 12px',
                        background: 'var(--color-surface)',
                        borderTop: '1px solid var(--color-border)',
                      }}>
                        <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 2px', color: noThemeActive ? 'var(--color-primary)' : 'var(--color-text)' }}>
                          No Theme
                        </p>
                        <p className="muted" style={{ fontSize: 11, lineHeight: 1.4, margin: 0 }}>
                          Clean default layout
                        </p>
                      </div>
                    </button>
                  );
                })()}
              </div>

              {/* Selection hint */}
              <p className="muted" style={{ fontSize: 11, margin: '10px 0 0' }}>
                {selectedPlugin
                  ? `Theme: ${PLUGINS.find(p => p.id === selectedPlugin)?.name ?? selectedPlugin}`
                  : 'No theme selected'}
              </p>

              {/* Custom prompt */}
              <div className="form-group" style={{ marginTop: 24, marginBottom: 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  Prompt & Design Instructions
                  {designBrief.trim() && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                      background: 'var(--color-primary)', color: '#fff', letterSpacing: '0.03em',
                    }}>
                      AI-customized
                    </span>
                  )}
                </label>
                <textarea
                  className="input"
                  rows={8}
                  placeholder={
                    'Structure, design, and content — all in one place.\n\n' +
                    'Examples:\n' +
                    '• "only generate 1 section: hero"\n' +
                    '• "make it 3 sections focused on the problem and solution"\n' +
                    '• "remove pricing, add a benefits section after hero"\n' +
                    '• "swap hero and challenge order"\n' +
                    '• "make it beautiful by using images"\n' +
                    '• "dark premium theme, no CTA in hero, add fade-in animations"'
                  }
                  value={designBrief}
                  onChange={e => setDesignBrief(e.target.value)}
                  style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                />
                <p className="muted" style={{ marginTop: 4 }}>
                  Drives colors, fonts, section structure, layout variants, and motion. The more specific you are, the more distinct the result.
                </p>
              </div>
            </div>
          )}

          {/* ═══ STEP 4: GENERATING ═══ */}
          {step === 'generate' && (
            <div style={{ padding: '4px 0' }}>

              {/* Restored-from-navigation banner */}
              {!generating && progress.length > 0 && !layoutAST && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', marginBottom: 16,
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  gap: 12,
                }}>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {wasGenerating ? 'Checking for results…' : 'Generation interrupted while you were away.'}
                  </span>
                  {!wasGenerating && (
                    <button
                      className="btn btn-sm btn-primary"
                      style={{ flexShrink: 0 }}
                      onClick={() => { setStep('plugin'); setError(null); setProgress([]); setStreamingSections([]); }}
                    >
                      ↺ Restart
                    </button>
                  )}
                </div>
              )}

              {/* Pipeline progress */}
              <div style={{ marginBottom: 20 }}>
                {progress.map((p, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    marginBottom: 8, opacity: p.done ? 1 : 0.6,
                    transition: 'opacity 0.3s',
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      background: p.done ? 'var(--color-primary)' : 'var(--color-surface)',
                      border: p.done ? 'none' : '1px solid var(--color-border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, color: '#fff', transition: 'background 0.3s',
                    }}>
                      {p.done ? '✓' : ''}
                    </div>
                    <span style={{ fontSize: 12, color: p.done ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                      {p.text}
                    </span>
                    {!p.done && (generating || wasGenerating) && (
                      <div style={{
                        width: 11, height: 11, borderRadius: '50%', flexShrink: 0,
                        border: '1.5px solid var(--color-border)',
                        borderTopColor: 'var(--color-primary)',
                        animation: 'spin 0.8s linear infinite',
                      }} />
                    )}
                  </div>
                ))}
              </div>

              {/* Streaming section cards — show during generation or when restored */}
              {streamingSections.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Building sections
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {streamingSections.map((name, i) => {
                      const isDone = i < streamingSections.length - 1;
                      return (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '9px 12px',
                          borderRadius: 'var(--radius)',
                          background: isDone ? 'var(--color-surface)' : 'var(--color-bg)',
                          border: `1px solid ${isDone ? 'var(--color-border)' : 'var(--color-primary)'}`,
                          boxShadow: isDone ? 'none' : '0 0 0 2px #bfdbfe44',
                          transition: 'all 0.3s',
                          animation: i === streamingSections.length - 1 ? 'slideInSection 0.35s ease-out' : 'none',
                        }}>
                          {isDone ? (
                            <div style={{
                              width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                              background: 'var(--color-primary)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 8, color: '#fff',
                            }}>✓</div>
                          ) : (
                            <div style={{
                              width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                              border: '1.5px solid var(--color-border)',
                              borderTopColor: 'var(--color-primary)',
                              animation: 'spin 0.8s linear infinite',
                            }} />
                          )}
                          <span style={{
                            fontSize: 13, fontWeight: isDone ? 400 : 600,
                            color: isDone ? 'var(--color-text-muted)' : 'var(--color-text)',
                          }}>
                            {name}
                          </span>
                          {isDone && (
                            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-muted)' }}>done</span>
                          )}
                          {!isDone && (
                            <span style={{
                              marginLeft: 'auto', fontSize: 10, fontWeight: 600,
                              color: 'var(--color-primary)', letterSpacing: '0.04em',
                            }}>writing…</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {error && (
                <div style={{
                  marginTop: 16, padding: '12px 14px',
                  background: '#fef2f2', border: '1px solid #fecaca',
                  borderRadius: 'var(--radius)',
                }}>
                  <p className="error" style={{ marginTop: 0 }}>{error}</p>
                  <button
                    className="btn btn-sm"
                    style={{ marginTop: 8, borderColor: '#fecaca', color: 'var(--color-error)' }}
                    onClick={() => { setStep('plugin'); setError(null); }}
                  >
                    Try Again
                  </button>
                </div>
              )}

              <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes slideInSection {
                  from { opacity: 0; transform: translateY(-6px); }
                  to { opacity: 1; transform: translateY(0); }
                }
              `}</style>
            </div>
          )}

        </div>
      </div>

      {/* Navigation footer */}
      {step !== 'generate' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
          <button
            className="btn"
            onClick={() => {
              const prev: Record<StepId, StepId | null> = { upload: null, brand: 'upload', plugin: 'brand', generate: 'plugin', preview: 'plugin' };
              const p = prev[step];
              if (p) setStep(p);
            }}
            disabled={step === 'upload'}
            style={{ minWidth: 96 }}
          >
            ← Back
          </button>

          <span className="muted">Step {stepIdx + 1} of {STEPS.length}</span>

          {step === 'upload' && (
            <button
              className="btn btn-primary"
              onClick={() => setStep('brand')}
              disabled={!mdContent.trim() || loadingContent}
              style={{ minWidth: 120, width: 'auto' }}
            >
              Next →
            </button>
          )}
          {step === 'brand' && (
            <button
              className="btn btn-primary"
              onClick={() => setStep('plugin')}
              style={{ minWidth: 120, width: 'auto' }}
            >
              Next →
            </button>
          )}
          {step === 'plugin' && (
            <button
              className="btn btn-primary"
              onClick={() => { setStep('generate'); setTimeout(runPipeline, 100); }}
              style={{ minWidth: 140, width: 'auto' }}
            >
              ⚡ Generate Microsite
            </button>
          )}
        </div>
      )}
      </>)}
    </div>

    {/* Theme selector modal — opens via 'More themes' button */}
    {isThemeModalOpen && (
      <ThemeModal
        selectedPlugin={selectedPlugin}
        onSelect={handleSelectPlugin}
        onPreview={handlePreview}
        onClose={() => setIsThemeModalOpen(false)}
      />
    )}

    {/* Unified fullscreen theme preview — z-index 10000, above ThemeModal */}
    {previewTheme && (
      <ThemeFullPreview
        theme={previewTheme}
        allThemes={THEME_REGISTRY}
        onSelect={id => {
          handleSelectPlugin(id);
          setPreviewTheme(null);
          setIsThemeModalOpen(false);
        }}
        onClose={() => setPreviewTheme(null)}
      />
    )}
    </>
  );
}
