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
  runAgent,
  type ProposalFile,
  type SynthesizedDesignSystem,
} from '@/lib/api';
import type { LayoutAST, BrandConfig } from '@/types/presentation';
import { PLUGINS } from '@/lib/presentation/pluginRegistry';
import type { PluginMeta } from '@/types/presentation';
import { Microsite } from './microsite/Microsite';
import { MicrositeEditor } from './microsite/editor/MicrositeEditor';
import { MicrositeHistory } from './microsite/MicrositeHistory';
import { ThemePreviewModal } from './microsite/ThemePreviewModal';
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

function pluginThumbnail(plugin: PluginMeta): string {
  return `linear-gradient(135deg, ${plugin.tokens.bg} 0%, ${plugin.tokens.surfaceAlt} 100%)`;
}

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

// ── Main Component ───────────────────────────────────────────────────────────
export function PresentationPage() {
  const { apiKey } = useAuth();
  const addExecution = useExecutionStore((s) => s.addExecution);
  const updateExecution = useExecutionStore((s) => s.updateExecution);

  // Wizard state
  const [step, setStep] = useState<StepId>('upload');

  // Step 1
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [namespacesLoading, setNamespacesLoading] = useState(false);
  const [selectedNamespace, setSelectedNamespace] = useState<string>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('ms_namespace') || '' : ''
  );
  const [proposals, setProposals] = useState<ProposalFile[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [proposalsError, setProposalsError] = useState<string | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<ProposalFile | null>(null);
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

  // Step 3
  const [designBrief, setDesignBrief] = useState('');
  const [brandImagePrompt, setBrandImagePrompt] = useState<string>('');
  const [synthStatus, setSynthStatus] = useState<null | 'scanning' | 'building' | 'ready'>(null);
  const [synthesizedDesign, setSynthesizedDesign] = useState<SynthesizedDesignSystem | null>(null);
  const [synthError, setSynthError] = useState<string | null>(null);
  // Step 3 — null means "no theme / default styling"
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>('obsidian');
  const [customPrompt, setCustomPrompt] = useState('');
  const [previewPlugin, setPreviewPlugin] = useState<string | null>(null);

  // Step 4
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Step 5
  const [layoutAST, setLayoutAST] = useState<LayoutAST | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  // Stores last generated markdown — used as input on regeneration instead of original proposal
  const [generatedMarkdown, setGeneratedMarkdown] = useState<string | null>(null);

  // History
  const [activeTab, setActiveTab] = useState<'generate' | 'history'>(() => {
    if (typeof window === 'undefined') return 'generate';
    return (localStorage.getItem('ms_activeTab') as 'generate' | 'history') || 'generate';
  });
  const { history, addEntry } = useMicrositeHistory(selectedNamespace);

  const handleTabChange = (tab: 'generate' | 'history') => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') localStorage.setItem('ms_activeTab', tab);
  };

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
    fetchMicrositeContent(apiKey, selectedNamespace, selectedProposal.fileName.replace(/\.md$/, ''))
      .then(ast => {
        if (ast && typeof ast === 'object' && (ast as { sections?: unknown[] }).sections?.length) {
          setLayoutAST(ast as LayoutAST);
        }
      })
      .catch(() => { /* no saved AST — fallback message already shown */ });
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

    try {
      setProgress([{ text: 'Parsing document structure...', done: true }]);
      setProgress(p => [...p, { text: 'Sending to microsite-generator agent...', done: false }]);

      // When the user selected their custom synthesized style, pass it as pre-synthesized
      // so the agent skips Pass -1 (design synthesis).
      const isCustomSynth = selectedPlugin === 'custom-synthesized' && synthesizedDesign;
      const effectivePlugin = isCustomSynth ? 'cobalt' : selectedPlugin;

      // Use last generated markdown on regeneration; original proposal on first run
      const sourceMarkdown = generatedMarkdown ?? mdContent;

      const result = await runAgent(apiKey, {
        agent: 'microsite-generator-agent',
        namespace: selectedNamespace,
        input: {
          ...(customPrompt.trim() ? { prompt: customPrompt.trim() } : {}),
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
            ...(customPrompt.trim() ? { customInstructions: customPrompt.trim() } : {}),
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
      setTimeout(() => setStep('preview'), 600);
    } catch (e) {
      setError((e as Error).message);
      updateExecution(execId, { status: 'failed', errorMessage: (e as Error).message });
    } finally {
      setGenerating(false);
    }
  }, [apiKey, selectedNamespace, mdContent, generatedMarkdown, selectedPlugin, brand, customPrompt, designBrief, synthesizedDesign, addExecution, updateExecution, selectedProposal]);

  // ── Preview mode: delegate entirely to Microsite (it handles fullscreen + portal buttons) ──
  if (step === 'preview' && layoutAST) {
    if (showEditor) {
      return (
        <MicrositeEditor
          ast={layoutAST}
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
            : `History${history.length > 0 ? ` (${history.length})` : ''}`;
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
        <MicrositeHistory namespace={selectedNamespace || 'default'} />
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
        }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>

                {/* ── No Theme card ── */}
                {(() => {
                  const noThemeActive = selectedPlugin === null;
                  return (
                    <button
                      key="no-theme"
                      onClick={() => setSelectedPlugin(noThemeActive ? 'obsidian' : null)}
                      title="Generate without a design theme"
                      style={{
                        background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                        border: `2px solid ${noThemeActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        borderRadius: 10, overflow: 'hidden',
                        boxShadow: noThemeActive ? '0 0 0 3px #bfdbfe' : 'var(--shadow)',
                        transition: 'border-color 0.2s',
                      }}
                    >
                      <div style={{
                        height: 90, position: 'relative', overflow: 'hidden',
                        background: 'repeating-linear-gradient(45deg, var(--color-bg) 0px, var(--color-bg) 8px, var(--color-border) 8px, var(--color-border) 9px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <span style={{
                          fontSize: 28, opacity: 0.25,
                          color: 'var(--color-text)',
                        }}>∅</span>
                        {noThemeActive && (
                          <div style={{
                            position: 'absolute', top: 6, right: 6,
                            width: 20, height: 20, borderRadius: '50%',
                            background: 'var(--color-primary)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, color: '#fff',
                          }}>✓</div>
                        )}
                      </div>
                      <div style={{
                        padding: '10px 12px',
                        background: 'var(--color-surface)',
                        borderTop: '1px solid var(--color-border)',
                      }}>
                        <p style={{
                          fontSize: 13, fontWeight: 600, margin: '0 0 2px',
                          color: noThemeActive ? 'var(--color-primary)' : 'var(--color-text)',
                        }}>
                          No Theme
                        </p>
                        <p className="muted" style={{ fontSize: 11, lineHeight: 1.4, margin: 0 }}>
                          Clean layout, no styling
                        </p>
                      </div>
                    </button>
                  );
                })()}

                {/* ── Theme cards ── */}
                {PLUGINS.map(plugin => {
                  const active = selectedPlugin === plugin.id;
                  return (
                    <div
                      key={plugin.id}
                      style={{
                        position: 'relative',
                        border: `2px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        borderRadius: 10, overflow: 'hidden',
                        boxShadow: active ? '0 0 0 3px #bfdbfe' : 'var(--shadow)',
                        transition: 'border-color 0.2s',
                      }}
                    >
                      {/* Thumbnail — click to preview */}
                      <button
                        onClick={() => setPreviewPlugin(plugin.id)}
                        title={`Preview ${plugin.name}`}
                        style={{
                          display: 'block', width: '100%', background: 'none',
                          padding: 0, cursor: 'pointer', border: 'none',
                        }}
                      >
                        <div style={{
                          height: 90, background: pluginThumbnail(plugin),
                          position: 'relative', overflow: 'hidden',
                        }}>
                          <div style={{
                            position: 'absolute', inset: 0,
                            background: `radial-gradient(ellipse at 30% 50%, ${plugin.tokens.accent}22 0%, transparent 60%)`,
                          }} />
                          <div style={{
                            position: 'absolute', bottom: '0.6rem', left: '0.75rem',
                            fontFamily: `'${plugin.tokens.heroFont}', Georgia, serif`,
                            fontSize: '1.1rem', fontWeight: plugin.tokens.heroWeight,
                            color: plugin.tokens.text, lineHeight: 1,
                          }}>
                            Aa
                          </div>
                          {/* Preview hint overlay */}
                          <div style={{
                            position: 'absolute', inset: 0,
                            background: 'rgba(0,0,0,0)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            opacity: 0,
                            transition: 'opacity 0.2s, background 0.2s',
                          }}
                            className="theme-preview-hover"
                          >
                            <span style={{
                              background: 'rgba(0,0,0,0.6)', color: '#fff',
                              fontSize: 11, fontWeight: 600, padding: '4px 10px',
                              borderRadius: 100,
                            }}>Preview</span>
                          </div>
                          {active && (
                            <div style={{
                              position: 'absolute', top: 6, right: 6,
                              width: 20, height: 20, borderRadius: '50%',
                              background: 'var(--color-primary)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 10, color: '#fff',
                            }}>✓</div>
                          )}
                        </div>
                      </button>

                      {/* Footer — click to select / toggle off */}
                      <button
                        onClick={() => setSelectedPlugin(active ? null : plugin.id)}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '10px 12px', cursor: 'pointer', border: 'none',
                          background: 'var(--color-surface)',
                          borderTop: '1px solid var(--color-border)',
                        }}
                      >
                        <p style={{
                          fontSize: 13, fontWeight: 600, margin: '0 0 2px',
                          color: active ? 'var(--color-primary)' : 'var(--color-text)',
                        }}>
                          {plugin.name}
                        </p>
                        <p className="muted" style={{ fontSize: 11, lineHeight: 1.4, margin: 0 }}>
                          {plugin.description}
                        </p>
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Selection hint */}
              <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
                {selectedPlugin
                  ? `Theme selected: ${PLUGINS.find(p => p.id === selectedPlugin)?.name}. Click the name again to deselect.`
                  : 'No theme selected — microsite will use clean default styling.'}
              </p>

              <style>{`
                div:hover > button > .theme-preview-hover,
                div:hover .theme-preview-hover { opacity: 1 !important; background: rgba(0,0,0,0.35) !important; }
              `}</style>

              {/* Custom prompt */}
              <div className="form-group" style={{ marginTop: 24, marginBottom: 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  Design Brief
                  <span className="badge" style={{ fontSize: 10, fontWeight: 500 }}>optional but powerful</span>
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
                    'Describe your site in natural language — design intent, structure, motion, and copy direction all in one place.\n\n' +
                    'Examples:\n' +
                    '• "Dark premium theme, sharp corners, no rounded buttons, editorial hero with large type, 8 sections: hero, problem, approach, team, timeline, pricing, testimonials, next steps"\n' +
                    '• "B2B SaaS, clean dark mode, electric purple, no CTA in hero, add motion and fade-in animations"\n' +
                    '• "Heritage law firm, deep navy and gold, Economist tone, parallax hero, bold split layouts"'
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
            <div style={{ maxWidth: 480, margin: '0 auto', padding: '8px 0' }}>
              {progress.map((p, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  marginBottom: 12, opacity: p.done ? 1 : 0.55,
                  transition: 'opacity 0.3s',
                }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                    background: p.done ? 'var(--color-primary)' : 'var(--color-surface)',
                    border: p.done ? 'none' : '1px solid var(--color-border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: '#fff', transition: 'background 0.3s',
                  }}>
                    {p.done ? '✓' : ''}
                  </div>
                  <span style={{ fontSize: 13, color: p.done ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                    {p.text}
                  </span>
                  {!p.done && generating && (
                    <div style={{
                      width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                      border: '1.5px solid var(--color-border)',
                      borderTopColor: 'var(--color-primary)',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                  )}
                </div>
              ))}

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

              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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

    {/* Theme preview modal — rendered outside wizard flow, no API call */}
    {previewPlugin && (
      <ThemePreviewModal
        plugin={getPlugin(previewPlugin)}
        brand={brand}
        onClose={() => setPreviewPlugin(null)}
        onApply={() => {
          setSelectedPlugin(previewPlugin);
          setPreviewPlugin(null);
        }}
      />
    )}
    </>
  );
}
