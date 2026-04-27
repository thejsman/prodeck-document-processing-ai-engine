"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Check, Globe, Paperclip, X } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
import { useAuth } from "@/lib/auth-context";
import { useNamespace } from "@/lib/namespace-context";
import { useExecutionStore } from "@/core/execution/execution-store";
import {
  fetchNamespaces,
  fetchProposals,
  fetchProposalContent,
  fetchMicrositeContent,
  fetchPresentations,
  generateMicrositeStream,
  saveMicrositeAst,
  extractUrlDesign,
  type StreamEvent,
  type ProposalFile,
  type SynthesizedDesignSystem,
  type ReferenceDesign,
} from "@/lib/api";
import { useNamespacePanelStore } from "@/lib/namespace-panel-store";
import type {
  LayoutAST,
  LayoutSection,
  BrandConfig,
} from "@/types/presentation";
import {
  PLUGINS,
  fetchPluginsFromApi,
  DEFAULT_PLUGIN_IDS,
  THEME_REGISTRY,
  type ThemeDefinition,
} from "@/lib/presentation/pluginRegistry";
import type { PluginMeta } from "@/types/presentation";
import { Microsite } from "./microsite/Microsite";
import { MicrositeEditor } from "./microsite/editor/MicrositeEditor";
import { MicrositeHistory } from "./microsite/MicrositeHistory";
import { ThemeModal } from "./microsite/ThemeModal";
import { ThemeFullPreview } from "./microsite/ThemeFullPreview";
import { ThemePreviewCard } from "./microsite/ThemePreviewCard";
import { getPlugin } from "@/lib/presentation/pluginRegistry";
import {
  useMicrositeHistory,
  getHistoryCount,
} from "@/lib/useMicrositeHistory";

// ── Pipeline steps ───────────────────────────────────────────────────────────
type StepId = "upload" | "brand" | "plugin" | "generate" | "preview";

const STEPS: Array<{ id: StepId; label: string; description: string }> = [
  {
    id: "upload",
    label: "Select Proposal",
    description: "Choose a source proposal",
  },
  { id: "brand", label: "Brand Setup", description: "Your identity & colors" },
  { id: "plugin", label: "Choose Style", description: "Pick a design system" },
  {
    id: "generate",
    label: "Generate",
    description: "AI builds your microsite",
  },
];

interface ProgressItem {
  text: string;
  done: boolean;
}

// ── Color extraction utilities ────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        break;
      case gn:
        h = ((bn - rn) / d + 2) / 6;
        break;
      case bn:
        h = ((rn - gn) / d + 4) / 6;
        break;
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
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
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
  const [nr, ng, nb] = hslToRgb(
    (h + 0.5) % 1,
    Math.max(s, 0.3),
    l < 0.4 ? 0.65 : 0.25,
  );
  return rgbToHex(nr, ng, nb);
}

function extractSvgColors(svgText: string): string[] {
  const colors: string[] = [];
  const hexRe = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(svgText)) !== null) {
    const hex =
      m[0].length === 4
        ? "#" +
          m[1]
            .split("")
            .map((c) => c + c)
            .join("")
        : m[0];
    const [r, g, b] = hexToRgb(hex);
    const brightness = (r + g + b) / 3;
    const [, s] = rgbToHsl(r, g, b);
    if (brightness > 20 && brightness < 235 && s > 0.1)
      colors.push(hex.toLowerCase());
  }
  return [...new Set(colors)];
}

function extractColorsFromCanvas(
  dataUrl: string,
): Promise<{ primary: string; secondary: string }> {
  return new Promise((resolve) => {
    const fallback = { primary: "#C8A96E", secondary: "#1A1612" };
    const img = new Image();
    img.onload = () => {
      try {
        const size = 80;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(fallback);
          return;
        }
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
        if (sorted.length === 0) {
          resolve(fallback);
          return;
        }

        const toHex = (k: string) => {
          const [r, g, b] = k.split(",").map(Number);
          return rgbToHex(r, g, b);
        };

        const primary = toHex(sorted[0][0]);

        if (sorted.length >= 2) {
          const [r1, g1, b1] = sorted[0][0].split(",").map(Number);
          const [r2, g2, b2] = sorted[1][0].split(",").map(Number);
          const diff =
            Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
          if (diff > 64) {
            resolve({ primary, secondary: toHex(sorted[1][0]) });
            return;
          }
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
  if (file.type === "image/svg+xml") {
    const text = await file.text();
    const svgColors = extractSvgColors(text);
    if (svgColors.length >= 2)
      return { primary: svgColors[0], secondary: svgColors[1] };
    if (svgColors.length === 1)
      return {
        primary: svgColors[0],
        secondary: complementaryHex(svgColors[0]),
      };
  }
  return extractColorsFromCanvas(dataUrl);
}

// ── Session-storage key for wizard state ──────────────────────────────────────
const SS_KEY = "ms_wizard_state";

interface WizardSnapshot {
  step: StepId;
  wasGenerating: boolean;
  progress: ProgressItem[];
  streamingSections: string[];
  error: string | null;
  selectedNamespace: string;
  selectedProposal: ProposalFile | null;
  generationStartedAt?: number;
  lockedFromProposal?: boolean;
}

function readSnapshot(): WizardSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    return raw ? (JSON.parse(raw) as WizardSnapshot) : null;
  } catch {
    return null;
  }
}

function writeSnapshot(s: WizardSnapshot) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function clearSnapshot() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SS_KEY);
  } catch {
    /* ignore */
  }
}

// ── Main Component ───────────────────────────────────────────────────────────
export function PresentationPage() {
  const { apiKey } = useAuth();
  const { setNamespace: setGlobalNamespace } = useNamespace();
  const router = useRouter();
  const addExecution = useExecutionStore((s) => s.addExecution);
  const updateExecution = useExecutionStore((s) => s.updateExecution);
  const setPanelMicrosites = useNamespacePanelStore((s) => s.setMicrosites);

  // Restore wizard state from sessionStorage on mount
  const _snap = readSnapshot();

  // Wizard state
  const [step, setStep] = useState<StepId>(() => {
    // If there's a saved generate/preview step, restore it
    if (_snap && (_snap.step === "generate" || _snap.step === "preview"))
      return _snap.step;
    return "upload";
  });

  // Step 1
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [namespacesLoading, setNamespacesLoading] = useState(false);
  const [selectedNamespace, setSelectedNamespace] = useState<string>(() => {
    if (_snap?.selectedNamespace) return _snap.selectedNamespace;
    return typeof window !== "undefined"
      ? localStorage.getItem("ms_namespace") || ""
      : "";
  });
  const [proposals, setProposals] = useState<ProposalFile[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [proposalsError, setProposalsError] = useState<string | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<ProposalFile | null>(
    () => _snap?.selectedProposal ?? null,
  );
  const [lockedFromProposal] = useState<boolean>(
    () => _snap?.lockedFromProposal ?? false,
  );
  const [mdContent, setMdContent] = useState("");
  const [loadingContent, setLoadingContent] = useState(false);

  // Step 2 — agency brand persisted to localStorage so it survives namespace switches
  const prevNamespaceRef = useRef<string>("");
  const [brand, setBrand] = useState<BrandConfig>(() => {
    if (typeof window === 'undefined') return {
      companyName: '', tagline: '',
      logoUrl: null, logoText: '', primaryColor: '#C8A96E', secondaryColor: '#1A1612',
    };
    const clientName = (_snap?.lockedFromProposal && _snap?.selectedProposal?.client) ? _snap.selectedProposal.client : '';
    try {
      const saved = localStorage.getItem('agency-brand');
      if (saved) return { ...JSON.parse(saved), logoUrl: null, ...(clientName ? { companyName: clientName } : {}) };
    } catch { /* ignore */ }
    return { companyName: clientName, tagline: '', logoUrl: null, logoText: '', primaryColor: '#C8A96E', secondaryColor: '#1A1612' };
  });

  // Step 2 – logo extraction
  const [logoExtracting, setLogoExtracting] = useState(false);
  const [colorsAutoExtracted, setColorsAutoExtracted] = useState(false);

  // Plugin list — fetched from API on mount, falls back to static PLUGINS
  const [pluginList, setPluginList] = useState<PluginMeta[]>(PLUGINS);

  // Step 3
  const [designBrief, setDesignBrief] = useState("");
  const [referenceFile, setReferenceFile] = useState<{
    base64: string;
    mediaType: string;
    fileName: string;
    dominantColors?: string[];
  } | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [urlReferenceDesign, setUrlReferenceDesign] =
    useState<ReferenceDesign | null>(null);
  const [urlExtractionState, setUrlExtractionState] = useState<
    "idle" | "loading" | "success" | "error" | "blocked"
  >("idle");
  const urlDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [synthStatus, setSynthStatus] = useState<
    null | "scanning" | "building" | "ready"
  >(null);
  const [synthesizedDesign, setSynthesizedDesign] =
    useState<SynthesizedDesignSystem | null>(null);
  const [synthError, setSynthError] = useState<string | null>(null);
  // Step 3 — null means "no theme / default styling"
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(() => {
    if (typeof window === "undefined") return "obsidian";
    return localStorage.getItem("presentation-builder-theme") ?? "obsidian";
  });
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [previewTheme, setPreviewTheme] = useState<ThemeDefinition | null>(
    null,
  );
  const [customPrompt, setCustomPrompt] = useState("");
  const [pdfFriendly, setPdfFriendly] = useState(false);

  // Step 4
  const [generating, setGenerating] = useState(false);
  const [streamingTotal, setStreamingTotal] = useState(0);
  const [planSectionTypes, setPlanSectionTypes] = useState<string[]>([]);
  // If we restored a snapshot where generation was running, track that separately
  const [wasGenerating, setWasGenerating] = useState(
    () => !!(_snap?.wasGenerating && _snap.step === "generate"),
  );
  const [progress, setProgress] = useState<ProgressItem[]>(() =>
    _snap?.step === "generate" ? (_snap.progress ?? []) : [],
  );
  const [error, setError] = useState<string | null>(() =>
    _snap?.step === "generate" ? (_snap.error ?? null) : null,
  );
  const [streamingSections, setStreamingSections] = useState<string[]>(() =>
    _snap?.step === "generate" ? (_snap.streamingSections ?? []) : [],
  );
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentHistoryIdRef = useRef<string | null>(null);
  const layoutASTRef = useRef<LayoutAST | null>(null);
  const userCancelledRef = useRef(false);
  const generationStartedAtRef = useRef<number>(
    _snap?.generationStartedAt ?? 0,
  );
  // Holds reference CSS vars + font URL from Pass 0.5 so they survive the complete-event brandConfig merge
  const referenceCssVarsRef = useRef<{
    cssVars: Record<string, string>;
    googleFontsUrl?: string;
  } | null>(null);

  // Step 5
  const [layoutAST, setLayoutAST] = useState<LayoutAST | null>(null);
  // Keep ref in sync so finally block can read latest AST without stale closure
  useEffect(() => {
    layoutASTRef.current = layoutAST;
  }, [layoutAST]);

  // Auto-save AST to disk (debounced) whenever it changes after initial generation.
  // This ensures section deletions/edits survive page refresh without requiring
  // the user to open the full editor and click Export.
  const abortCtrlRef = useRef<AbortController | null>(null);
  const astSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedAstRef = useRef<string>('');
  useEffect(() => {
    if (!layoutAST || !apiKey || !selectedNamespace) return;
    const pid = layoutAST.proposalId ?? selectedProposal?.fileName.replace(/\.md$/, '') ?? selectedNamespace;
    const serialized = JSON.stringify(layoutAST);
    if (serialized === lastSavedAstRef.current) return; // no change
    if (astSaveTimerRef.current) clearTimeout(astSaveTimerRef.current);
    astSaveTimerRef.current = setTimeout(async () => {
      try {
        await saveMicrositeAst(apiKey, selectedNamespace, pid, layoutAST);
        lastSavedAstRef.current = serialized;
      } catch { /* best-effort — don't show error for background save */ }
    }, 1000);
  }, [layoutAST, apiKey, selectedNamespace, selectedProposal]);
  const [loadingAST, setLoadingAST] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  // Stores last generated markdown — used as input on regeneration instead of original proposal
  const [generatedMarkdown, setGeneratedMarkdown] = useState<string | null>(
    null,
  );

  // Generate modal
  const [showGenerateModal, setShowGenerateModal] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return !!(_snap?.lockedFromProposal);
  });
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  // addEntry scoped to selectedNamespace; count read directly from localStorage for accuracy
  const { addEntry, deleteEntry } = useMicrositeHistory(selectedNamespace, apiKey);
  // Count reported directly from MicrositeHistory (combined local + server, always accurate)
  const [totalHistoryCount, setTotalHistoryCount] = useState(() =>
    getHistoryCount(),
  );

  // Unified preview handler — opens ThemeFullPreview and closes ThemeModal
  const handlePreview = (id: string) => {
    const theme = THEME_REGISTRY.find((t) => t.id === id);
    if (theme) {
      setIsThemeModalOpen(false);
      setPreviewTheme(theme);
    }
  };

  // Persist selected theme to localStorage
  const handleSelectPlugin = (id: string | null) => {
    setSelectedPlugin(id);
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem("presentation-builder-theme", id);
      else localStorage.removeItem("presentation-builder-theme");
    }
  };

  // ── Escape key: close ThemeModal (ThemeFullPreview handles its own Escape) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // ThemeFullPreview has its own Escape handler — let it fire first.
      // We only close the modal when no preview is open.
      if (previewTheme) return;
      if (isThemeModalOpen) setIsThemeModalOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [previewTheme, isThemeModalOpen]);

  // ── Persist wizard step + generation state to sessionStorage ──────────────
  useEffect(() => {
    if (step === "generate" || step === "preview") {
      writeSnapshot({
        step,
        wasGenerating: generating,
        progress,
        streamingSections,
        error,
        selectedNamespace,
        selectedProposal,
        generationStartedAt: generationStartedAtRef.current,
      });
    } else {
      // Back to earlier steps — clear the snapshot
      clearSnapshot();
    }
  }, [
    step,
    generating,
    progress,
    streamingSections,
    error,
    selectedNamespace,
    selectedProposal,
  ]);

  // ── When restored to generate step with wasGenerating, poll until result is ready ──
  useEffect(() => {
    if (!wasGenerating || !apiKey || !selectedNamespace || !selectedProposal)
      return;
    setWasGenerating(false);
    setProgress((p) => {
      const last = p[p.length - 1];
      if (!last || last.text.startsWith("Checking"))
        return [...p, { text: "Checking for results…", done: false }];
      return p;
    });

    const startedAt = generationStartedAtRef.current;
    const key = apiKey;
    const ns = selectedNamespace;
    const pid = selectedProposal.fileName.replace(/\.md$/, "");
    let stopped = false;
    let pollCount = 0;
    const MAX_POLLS = 60; // 5 minutes at 5s intervals

    async function poll() {
      if (stopped) return;
      try {
        const { ast, savedAt } = await fetchMicrositeContent(key, ns, pid);
        if (stopped) return;
        const isNew = savedAt ? new Date(savedAt).getTime() > startedAt : false;
        if (
          ast &&
          typeof ast === "object" &&
          (ast as { sections?: unknown[] }).sections?.length &&
          isNew
        ) {
          const recovered = ast as LayoutAST;
          setLayoutAST(recovered);
          if (!currentHistoryIdRef.current) {
            const saved = addEntry(recovered);
            currentHistoryIdRef.current = saved.id;
          }
          setProgress((p) =>
            p.map((x, i) =>
              i === p.length - 1
                ? { ...x, text: "Microsite ready!", done: true }
                : x,
            ),
          );
          stopped = true;
          setTimeout(() => {
            clearSnapshot();
            setStep("preview");
          }, 600);
        } else {
          pollCount++;
          if (pollCount < MAX_POLLS) {
            setProgress((p) =>
              p.map((x, i) =>
                i === p.length - 1
                  ? {
                      ...x,
                      text: `Still generating… (${pollCount * 5}s)`,
                      done: false,
                    }
                  : x,
              ),
            );
            setTimeout(poll, 5000);
          } else {
            setProgress((p) =>
              p.map((x, i) =>
                i === p.length - 1
                  ? {
                      ...x,
                      text: "Generation was interrupted — click Generate to restart.",
                      done: false,
                    }
                  : x,
              ),
            );
          }
        }
      } catch {
        if (!stopped) {
          setProgress((p) =>
            p.map((x, i) =>
              i === p.length - 1
                ? {
                    ...x,
                    text: "Generation was interrupted — click Generate to restart.",
                    done: false,
                  }
                : x,
            ),
          );
        }
      }
    }

    poll();
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasGenerating]);

  // Track namespace changes (no longer overwrites agency brand — namespace is the CLIENT, not the proposer)
  useEffect(() => {
    if (selectedNamespace) {
      prevNamespaceRef.current = selectedNamespace;
    }
  }, [selectedNamespace]);

  // Persist agency brand to localStorage whenever it changes (excluding logoUrl — too large)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const { logoUrl: _skip, ...saveable } = brand;
      localStorage.setItem('agency-brand', JSON.stringify(saveable));
    } catch { /* ignore quota errors */ }
  }, [brand]);

  // Fetch plugin list from API once on mount (Phase 5: dynamic discovery)
  useEffect(() => {
    if (!apiKey) return;
    fetchPluginsFromApi(apiKey)
      .then(setPluginList)
      .catch(() => {});
  }, [apiKey]);

  useEffect(() => {
    if (step !== "upload" || !apiKey) return;
    setNamespacesLoading(true);
    fetchNamespaces(apiKey)
      .then(setNamespaces)
      .catch(() => {})
      .finally(() => setNamespacesLoading(false));
  }, [step, apiKey]);

  useEffect(() => {
    if (lockedFromProposal) return;
    setProposals([]);
    setSelectedProposal(null);
    setMdContent("");
    setProposalsError(null);
  }, [selectedNamespace, lockedFromProposal]);

  useEffect(() => {
    if (step !== "upload" || !apiKey || !selectedNamespace || lockedFromProposal) return;
    setProposalsLoading(true);
    fetchProposals(apiKey)
      .then((all) =>
        setProposals(
          all.filter((p) => {
            if (p.status !== "approved") return false;
            // Namespace-scoped proposals have fileName like "km-digital::file.md"
            if (p.fileName.includes("::")) {
              const fileNs = p.fileName.split("::")[0];
              return fileNs === selectedNamespace;
            }
            // Legacy proposals (no namespace prefix): fall back to fuzzy client name match
            const nsKey = selectedNamespace
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "");
            const clientKey = p.client.toLowerCase().replace(/[^a-z0-9]/g, "");
            return clientKey.includes(nsKey) || nsKey.includes(clientKey);
          }),
        ),
      )
      .catch((e) => setProposalsError((e as Error).message))
      .finally(() => setProposalsLoading(false));
  }, [step, apiKey, selectedNamespace, lockedFromProposal]);

  // Auto-load proposal content when arriving locked from the proposal flow
  useEffect(() => {
    if (!lockedFromProposal || !selectedProposal || !apiKey || mdContent) return;
    setLoadingContent(true);
    fetchProposalContent(apiKey, selectedProposal.fileName)
      .then((doc) => setMdContent(doc.content))
      .catch(() => {})
      .finally(() => setLoadingContent(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedFromProposal, apiKey, selectedProposal?.fileName]);

  const selectProposal = useCallback(
    async (p: ProposalFile) => {
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
    },
    [apiKey],
  );

  const stepIdx = STEPS.findIndex((s) => s.id === step);

  // Restore layoutAST from disk when navigating to preview without an in-memory AST
  useEffect(() => {
    if (
      step !== "preview" ||
      layoutAST ||
      !apiKey ||
      !selectedNamespace ||
      !selectedProposal
    )
      return;
    setLoadingAST(true);
    fetchMicrositeContent(
      apiKey,
      selectedNamespace,
      selectedProposal.fileName.replace(/\.md$/, ""),
    )
      .then(({ ast }) => {
        if (
          ast &&
          typeof ast === "object" &&
          (ast as { sections?: unknown[] }).sections?.length
        ) {
          setLayoutAST(ast as LayoutAST);
        }
      })
      .catch(() => {
        /* no saved AST — fallback message already shown */
      })
      .finally(() => setLoadingAST(false));
  }, [step, layoutAST, apiKey, selectedNamespace, selectedProposal]);

  const runPipeline = useCallback(async () => {
    if (!apiKey || !selectedNamespace) return;

    // Build stable refs before any state updates
    const proposalId =
      selectedProposal?.fileName.replace(/\.md$/, "") ?? selectedNamespace;
    // Build base brand config from brand setup
    const baseBrandConfig = {
      companyName: brand.companyName,
      tagline: brand.tagline,
      logoUrl: brand.logoUrl,
      logoText: brand.logoText,
      primaryColor: brand.primaryColor,
      secondaryColor: brand.secondaryColor,
    };

    // If URL design was extracted, convert its colors/typography into CSS variable overrides
    // so the microsite renders the extracted design from the very first skeleton frame.
    // The existing Pass 0.5 (image attachment) path still takes priority — it re-applies
    // extractedCssVariables at stream-complete time, overwriting these.
    const urlDesignOverride = (() => {
      if (!urlReferenceDesign) return {};
      const bg = urlReferenceDesign.colors.background;
      const isDark = (() => {
        const hex = bg.replace("#", "");
        if (hex.length < 6) return false;
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        const toLinear = (c: number) =>
          c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        const lum =
          0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
        return lum < 0.179;
      })();
      const radiusMap: Record<string, string> = {
        sharp: "4px",
        soft: "8px",
        rounded: "16px",
      };
      const cssVars: Record<string, string> = {
        "--ms-bg": bg,
        "--ms-bg2": urlReferenceDesign.colors.surface,
        "--ms-bg3": urlReferenceDesign.colors.surface,
        "--ms-surface": urlReferenceDesign.colors.surface,
        "--ms-accent": urlReferenceDesign.colors.primary,
        "--ms-accent2": urlReferenceDesign.colors.secondary,
        "--ms-text": urlReferenceDesign.colors.text,
        "--ms-text2": urlReferenceDesign.colors.textMuted,
        "--ms-text3": urlReferenceDesign.colors.textMuted,
        "--ms-border": urlReferenceDesign.colors.surface,
        "--ms-is-dark": isDark ? "1" : "0",
        "--ms-font-heading": urlReferenceDesign.typography.headingFont,
        "--ms-font-body": urlReferenceDesign.typography.bodyFont,
        "--ms-r-card":
          radiusMap[urlReferenceDesign.style.borderRadius] ?? "8px",
      };
      // Build Google Fonts URL for the extracted fonts
      const uniqueFonts = [
        ...new Set(
          [
            urlReferenceDesign.typography.headingFont,
            urlReferenceDesign.typography.bodyFont,
          ].filter(Boolean),
        ),
      ] as string[];
      const googleFontsUrl =
        uniqueFonts.length > 0
          ? `https://fonts.googleapis.com/css2?${uniqueFonts.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@300;400;500;600;700;800`).join("&")}&display=swap`
          : undefined;
      return {
        overrideTheme: true as const,
        extractedCssVariables: cssVars,
        ...(googleFontsUrl ? { googleFontsUrl } : {}),
      };
    })();

    const brandConfig = {
      ...baseBrandConfig,
      ...urlDesignOverride,
    };

    // ── Immediately switch to preview with an empty AST + skeletons ──────────
    // This gives the Gamma-like effect: all skeleton slides appear right away,
    // then fill in as sections arrive — no blank waiting screen.
    generationStartedAtRef.current = Date.now();
    userCancelledRef.current = false;
    setGenerating(true);
    setError(null);
    setProgress([
      { text: "Analyzing proposal — generating hero...", done: false },
      { text: "Planning section structure...", done: false },
    ]);
    setStreamingSections([]);
    setStreamingTotal(0);
    setPlanSectionTypes([]);
    referenceCssVarsRef.current = null;
    setLayoutAST({
      proposalId,
      generatedAt: new Date().toISOString(),
      meta: {
        title: selectedProposal?.client ?? selectedNamespace,
        client: selectedProposal?.client ?? "",
        date: "",
        author: "",
      },
      brief: {} as LayoutAST["brief"],
      brand: brandConfig,
      plugin: selectedPlugin ?? "ivory",
      sections: [],
    });
    // Stay on generate step — switch to preview only when first section arrives

    const execId = crypto.randomUUID();
    addExecution({
      id: execId,
      type: "microsite",
      status: "running",
      title: selectedProposal?.client ?? selectedNamespace,
    });

    const abortCtrl = new AbortController();
    abortCtrlRef.current = abortCtrl;

    try {
      setProgress([{ text: "Connecting to AI pipeline...", done: true }]);
      setProgress((p) => [
        ...p,
        { text: "Running design synthesis + section planning...", done: false },
      ]);

      const isCustomSynth =
        selectedPlugin === "custom-synthesized" && synthesizedDesign;
      const sourceMarkdown = generatedMarkdown ?? mdContent;

      await generateMicrositeStream(apiKey, selectedNamespace, proposalId, {
        proposalMarkdown: sourceMarkdown,
        plugin: selectedPlugin ?? "none",
        brand: brandConfig,
        ...((customPrompt || designBrief).trim()
          ? { customInstructions: (customPrompt || designBrief).trim() }
          : {}),
        ...((customPrompt || designBrief).trim()
          ? { fullDesignPrompt: (customPrompt || designBrief).trim() }
          : {}),
        ...(designBrief.trim() ? { designBrief: designBrief.trim() } : {}),
        ...(isCustomSynth
          ? {
              preSynthesizedDesignSystem: {
                rawTokens: synthesizedDesign.designSystem,
              },
            }
          : {}),
        ...(pdfFriendly ? { pdfFriendly: true } : {}),
        ...(referenceFile ? { referenceFile } : {}),
        // URL reference design — file tokens take priority if both provided
        ...(!referenceFile && urlReferenceDesign ? { urlReferenceDesign } : {}),
        signal: abortCtrl.signal,
        onEvent: (event: StreamEvent) => {
          console.log(
            "[stream]",
            event.type,
            event.type === "section"
              ? (event as { sectionType?: string }).sectionType
              : "",
          );
          if (event.type === "start") {
            setProgress((p) =>
              p.map((x, i) => (i === p.length - 1 ? { ...x, done: true } : x)),
            );
            setProgress((p) => [
              ...p,
              { text: "Generating sections...", done: false },
            ]);
          } else if (event.type === "plan") {
            const planEvent = event as {
              type: "plan";
              totalSections: number;
              sectionTypes?: string[];
              referenceCssVars?: Record<string, string>;
            };
            setStreamingTotal(planEvent.totalSections);
            if (planEvent.sectionTypes)
              setPlanSectionTypes(planEvent.sectionTypes);
            // If Pass 0.5 extracted design tokens from attached image, inject them as CSS overrides
            if (planEvent.referenceCssVars) {
              // Build a Google Fonts URL from the extracted font names so they actually load
              const headingFont = planEvent.referenceCssVars[
                "--ms-font-heading"
              ]
                ?.match(/['"]?([^'",]+)['"]?/)?.[1]
                ?.trim();
              const bodyFont = planEvent.referenceCssVars["--ms-font-body"]
                ?.match(/['"]?([^'",]+)['"]?/)?.[1]
                ?.trim();
              const uniqueFonts = [
                ...new Set([headingFont, bodyFont].filter(Boolean)),
              ] as string[];
              const googleFontsUrl =
                uniqueFonts.length > 0
                  ? `https://fonts.googleapis.com/css2?${uniqueFonts.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@300;400;500;600;700;800`).join("&")}&display=swap`
                  : undefined;

              referenceCssVarsRef.current = {
                cssVars: planEvent.referenceCssVars,
                googleFontsUrl,
              };

              setLayoutAST((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  brand: {
                    ...prev.brand,
                    overrideTheme: true,
                    extractedCssVariables: planEvent.referenceCssVars,
                    ...(googleFontsUrl ? { googleFontsUrl } : {}),
                  },
                };
              });
            }
            setProgress([
              { text: "Hero generated ✓", done: true },
              {
                text: `Generating ${planEvent.totalSections} sections...`,
                done: true,
              },
            ]);
          } else if (event.type === "section") {
            const sec = event;
            const newSection: LayoutSection = {
              id: sec.id,
              heading: sec.heading,
              sectionType: sec.sectionType as LayoutSection["sectionType"],
              content: sec.content as unknown as LayoutSection["content"],
              image: (sec.image as LayoutSection["image"]) ?? {
                source: "gradient",
                query: "",
                url: null,
                fallback: "gradient-mesh",
              },
              editable: sec.editable ?? true,
              version: sec.version ?? 1,
            };
            setStreamingSections((s) => [...s, sec.sectionType]);
            setStep("preview"); // Switch to preview on first section — user sees hero within 3-5s

            setLayoutAST((prev) => {
              if (!prev) return prev;
              const sections = [...prev.sections];
              const targetIdx = sec.index ?? sections.length;
              sections.splice(targetIdx, 0, newSection);
              return { ...prev, sections };
            });
          } else if (event.type === "image") {
            // Image resolved — update that section's URL in place
            setLayoutAST((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                sections: prev.sections.map((s) =>
                  s.id === event.sectionId
                    ? {
                        ...s,
                        image: {
                          ...s.image,
                          url: event.url,
                          source: "unsplash" as const,
                        },
                      }
                    : s,
                ),
              };
            });
          } else if (event.type === "complete") {
            const raw = (event as { type: "complete"; ast: unknown }).ast;
            if (raw && typeof raw === "object") {
              const ast = raw as LayoutAST;
              // Merge UI brand on top of agent brand, then re-apply reference CSS vars last so
              // brandConfig (plugin theme + primaryColor) cannot overwrite the extracted tokens.
              ast.brand = { ...(ast.brand ?? {}), ...brandConfig };
              if (referenceCssVarsRef.current) {
                ast.brand = {
                  ...ast.brand,
                  overrideTheme: true,
                  extractedCssVariables: referenceCssVarsRef.current.cssVars,
                  ...(referenceCssVarsRef.current.googleFontsUrl
                    ? {
                        googleFontsUrl:
                          referenceCssVarsRef.current.googleFontsUrl,
                      }
                    : {}),
                };
              }
              ast.plugin = selectedPlugin ?? "ivory";
              setLayoutAST(ast);
              const saved = addEntry(ast);
              currentHistoryIdRef.current = saved.id;
              setGeneratedMarkdown(sourceMarkdown);
            }
            setStep("preview");
            updateExecution(execId, { status: "completed" });
            clearSnapshot();
            // Prime the namespace panel store so the microsite appears immediately on return to /chat
            if (selectedNamespace) {
              fetchPresentations(apiKey, selectedNamespace)
                .then(ms => setPanelMicrosites(selectedNamespace, ms))
                .catch(() => {});
            }
          } else if (event.type === "error") {
            throw new Error(
              (event as { type: "error"; message: string }).message,
            );
          }
        },
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
        updateExecution(execId, {
          status: "failed",
          errorMessage: (e as Error).message,
        });
      }
    } finally {
      if (userCancelledRef.current) {
        // User cancelled — discard any partial entry already saved during streaming
        if (currentHistoryIdRef.current) {
          deleteEntry(currentHistoryIdRef.current);
          currentHistoryIdRef.current = null;
        }
      } else {
        // Safety net: if complete event never fired (e.g. server error during image fetch),
        // save whatever sections we have so history is never lost.
        const latestAST = layoutASTRef.current;
        if (latestAST?.sections?.length) {
          if (!currentHistoryIdRef.current) {
            const saved = addEntry(latestAST);
            currentHistoryIdRef.current = saved.id;
          }
          setStep("preview");
        }
      }
      setGenerating(false);
    }
  }, [
    apiKey,
    selectedNamespace,
    mdContent,
    generatedMarkdown,
    selectedPlugin,
    brand,
    customPrompt,
    designBrief,
    synthesizedDesign,
    addExecution,
    updateExecution,
    selectedProposal,
    addEntry,
    deleteEntry,
    pdfFriendly,
    referenceFile,
    urlReferenceDesign,
  ]);

  // ── Preview loading state ──────────────────────────────────────────────────
  // If not actively loading and still no AST, fall back to upload step.
  // Must be in a useEffect — calling setStep during render causes an infinite loop.
  useEffect(() => {
    if (step === "preview" && !loadingAST && !layoutAST) {
      clearSnapshot();
      setStep("upload");
    }
  }, [step, loadingAST, layoutAST]);

  // While the effect above transitions back to upload, render nothing
  if (step === "preview" && !loadingAST && !layoutAST) return null;

  if (step === "preview" && loadingAST) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--color-bg, #0a0a0a)",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: "3px solid var(--color-border, #333)",
            borderTopColor: "var(--color-accent, #7c6aff)",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <p
          style={{
            color: "var(--color-text-muted, #888)",
            fontFamily: "sans-serif",
            fontSize: 14,
          }}
        >
          {loadingAST ? "Loading microsite…" : "Building preview…"}
        </p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  // ── Preview mode: delegate entirely to Microsite (it handles fullscreen + portal buttons) ──
  if (step === "preview" && layoutAST) {
    if (showEditor) {
      return (
        <MicrositeEditor
          ast={layoutAST}
          namespace={selectedNamespace}
          proposalId={
            selectedProposal?.fileName.replace(/\.md$/, "") ?? selectedNamespace
          }
          onClose={() => setShowEditor(false)}
          onExport={(editedAst) => {
            setLayoutAST(editedAst);
            // Create a separate copy in history — original entry is preserved
            const saved = addEntry(editedAst);
            currentHistoryIdRef.current = saved.id;
            setShowEditor(false);
          }}
        />
      );
    }
    return (
      <Microsite
        ast={layoutAST}
        generating={generating}
        streamingTotal={generating ? streamingTotal : undefined}
        planSectionTypes={generating ? planSectionTypes : undefined}
        onBack={generating ? undefined : () => {
          if (lockedFromProposal) {
            if (selectedNamespace) setGlobalNamespace(selectedNamespace);
            router.push('/chat');
          } else {
            setStep("upload");
          }
        }}
        onRegenerate={generating ? undefined : () => setStep("generate")}
        onEdit={generating ? undefined : () => setShowEditor(true)}
        namespace={selectedNamespace}
        proposalId={layoutAST.proposalId}
      />
    );
  }

  // ── Wizard steps ─────────────────────────────────────────────────────────
  return (
    <>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "59px 24px 0" }}>
        {/* ── Header — same style as Proposals page ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 14 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginRight: "auto" }}>
            Microsites{totalHistoryCount > 0 ? ` (${totalHistoryCount})` : ""}
          </span>
          <button
            onClick={() => setShowGenerateModal(true)}
            style={{
              height: 30, padding: "0 14px",
              background: "var(--primary)", color: "#fff",
              border: "none", borderRadius: "var(--radius)",
              fontSize: 13, fontWeight: 500,
              cursor: "pointer",
              flexShrink: 0, whiteSpace: "nowrap",
            }}
          >
            + Generate Microsite
          </button>
        </div>
        <div style={{ height: 1, background: "var(--border)", marginBottom: 24 }} />

        {/* History — always visible */}
        <MicrositeHistory onCountChange={setTotalHistoryCount} />
      </div>

      {/* Generate Microsite modal — always mounted so wizard state persists */}
      <div style={{
        display: showGenerateModal ? "flex" : "none",
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(0,0,0,0.5)", zIndex: 200,
        alignItems: "flex-start", justifyContent: "center",
        padding: "24px", overflowY: "auto",
      }} onClick={() => { if (step === "generate" && generating) { setShowCancelConfirm(true); } else { setShowGenerateModal(false); } }}>
        <div style={{
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)", boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          width: "100%", maxWidth: 860, display: "flex", flexDirection: "column",
        }} onClick={(e) => e.stopPropagation()}>
          {/* Modal header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
            <h3 style={{ fontSize: 16, fontWeight: 400, margin: 0 }}>Generate Microsite</h3>
            <button
              className="chat-v2-panel-toggle"
              onClick={() => {
                if (step === "generate" && generating) {
                  setShowCancelConfirm(true);
                } else {
                  setShowGenerateModal(false);
                }
              }}
              aria-label="Close"
            >
              <Icon icon={X} size="sm" />
            </button>
          </div>
          {/* Modal body — wizard content */}
          <div style={{ padding: 24 }}>
        <div>
          {/* Stepper */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 0,
              marginBottom: 32,
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 17,
                left: "10%",
                right: "10%",
                height: 2,
                background: "var(--color-border)",
                zIndex: 0,
              }}
            />
            {STEPS.map((s, i) => {
              const isActive = s.id === step;
              const isDone = stepIdx > i;
              return (
                <div
                  key={s.id}
                  onClick={() => isDone && setStep(s.id)}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    position: "relative",
                    zIndex: 1,
                    cursor: isDone ? "pointer" : "default",
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 700,
                      flexShrink: 0,
                      background: isActive
                        ? "var(--color-primary)"
                        : isDone
                          ? "var(--color-success)"
                          : "var(--color-surface)",
                      border: `2px solid ${isActive ? "var(--color-primary)" : isDone ? "var(--color-success)" : "var(--color-border)"}`,
                      color:
                        isActive || isDone ? "#fff" : "var(--color-text-muted)",
                      transition: "all 0.2s",
                      boxShadow: isActive
                        ? "0 0 0 4px rgba(37,99,235,0.15)"
                        : "none",
                    }}
                  >
                    {isDone ? <Check size={16} strokeWidth={2.5} /> : i + 1}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <p
                      style={{
                        fontSize: 12,
                        fontWeight: isActive ? 700 : 500,
                        margin: 0,
                        lineHeight: 1.3,
                        color: isActive
                          ? "var(--color-primary)"
                          : isDone
                            ? "var(--color-text)"
                            : "var(--color-text-muted)",
                      }}
                    >
                      {s.label}
                    </p>
                    <p
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-muted)",
                        margin: 0,
                        marginTop: 2,
                      }}
                    >
                      {s.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Step card */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {/* Card header strip */}
            <div
              style={{
                padding: "14px 24px",
                borderBottom: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: "var(--color-primary)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {stepIdx + 1}
                </div>
                <div>
                  <p
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--color-text)",
                      margin: 0,
                      lineHeight: 1.2,
                    }}
                  >
                    {STEPS[stepIdx].label}
                  </p>
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-muted)",
                      margin: 0,
                    }}
                  >
                    {STEPS[stepIdx].description}
                  </p>
                </div>
              </div>
            </div>

            {/* Card body */}
            <div style={{ padding: 24 }}>
              {/* ═══ STEP 1: SELECT PROPOSAL ═══ */}
              {step === "upload" && (
                <div>
                  {/* Namespace */}
                  <div className="form-group">
                    <label>Namespace</label>
                    {lockedFromProposal ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "10px 14px",
                          background: "var(--color-surface)",
                          border: "1px solid var(--color-border)",
                          borderRadius: "var(--radius)",
                          cursor: "not-allowed",
                          opacity: 0.85,
                        }}
                      >
                        <span style={{ fontWeight: 500, color: "var(--color-text)", flex: 1 }}>
                          {selectedNamespace}
                        </span>
                        <span className="muted" style={{ fontSize: 11 }}>locked</span>
                      </div>
                    ) : (
                      <>
                        <div style={{ position: "relative" }}>
                          <select
                            className="select"
                            value={selectedNamespace}
                            disabled={namespacesLoading}
                            onChange={(e) => {
                              setSelectedNamespace(e.target.value);
                              localStorage.setItem("ms_namespace", e.target.value);
                            }}
                          >
                            <option value="">
                              {namespacesLoading
                                ? "Loading namespaces…"
                                : "Select a namespace…"}
                            </option>
                            {namespaces.map((ns) => (
                              <option key={ns} value={ns}>
                                {ns}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Proposal list */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label
                      style={{
                        color: !lockedFromProposal && !selectedNamespace
                          ? "var(--color-border)"
                          : undefined,
                      }}
                    >
                      Approved proposals
                    </label>

                    {lockedFromProposal && selectedProposal && (
                      <div className="proposal-card" style={{ borderColor: "var(--primary)" }}>
                        <div className="proposal-card-header">
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <span className="proposal-card-name">{selectedProposal.client || selectedProposal.fileName}</span>
                            {selectedProposal.createdAt && (
                              <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 3, lineHeight: 1.4 }}>
                                {new Date(selectedProposal.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}
                              </span>
                            )}
                            <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2, lineHeight: 1.4, wordBreak: "break-all" }}>
                              {selectedProposal.fileName.includes("::") ? selectedProposal.fileName.split("::")[1] : selectedProposal.fileName}
                            </span>
                          </div>
                          {selectedProposal.status && (
                            <span
                              className={
                                selectedProposal.status === "approved" ? "badge--approved" :
                                selectedProposal.status === "finalized" ? "badge--finalized" :
                                selectedProposal.status === "under_review" ? "badge--under-review" :
                                "badge--draft"
                              }
                              style={{ flexShrink: 0, fontSize: 10, fontWeight: 500, background: "transparent", border: "none" }}
                            >
                              {selectedProposal.status.replace("_", " ").toUpperCase()}
                            </span>
                          )}
                        </div>
                        {loadingContent && (
                          <p className="loading">Loading content…</p>
                        )}
                        {!loadingContent && mdContent && (
                          <p style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--color-success)" }}>
                            <Check size={12} strokeWidth={2.5} /> Ready
                          </p>
                        )}
                      </div>
                    )}

                    {!lockedFromProposal && !selectedNamespace && (
                      <div
                        style={{
                          padding: "2rem",
                          textAlign: "center",
                          border: "1px dashed var(--color-border)",
                          borderRadius: "var(--radius)",
                        }}
                      >
                        <p className="muted">Select a namespace first</p>
                      </div>
                    )}

                    {!lockedFromProposal && selectedNamespace && proposalsLoading && (
                      <p className="loading">Loading proposals…</p>
                    )}

                    {!lockedFromProposal && selectedNamespace &&
                      proposalsError &&
                      !proposalsLoading && (
                        <p className="error">{proposalsError}</p>
                      )}

                    {!lockedFromProposal && selectedNamespace &&
                      !proposalsLoading &&
                      !proposalsError &&
                      proposals.length === 0 && (
                        <div
                          style={{
                            padding: "2rem",
                            textAlign: "center",
                            border: "1px dashed var(--color-border)",
                            borderRadius: "var(--radius)",
                          }}
                        >
                          <p className="muted">
                            No approved proposals found in{" "}
                            <strong>{selectedNamespace}</strong>. Approve a
                            proposal first.
                          </p>
                        </div>
                      )}

                    {!lockedFromProposal && selectedNamespace &&
                      !proposalsLoading &&
                      proposals.length > 0 && (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fill, minmax(240px, 1fr))",
                            gap: "0.75rem",
                          }}
                        >
                          {proposals.map((p) => {
                            const isSelected =
                              selectedProposal?.fileName === p.fileName;
                            return (
                              <button
                                key={p.fileName}
                                className="proposal-card"
                                onClick={() => selectProposal(p)}
                                style={{
                                  textAlign: "left",
                                  cursor: "pointer",
                                  width: "100%",
                                  ...(isSelected ? { borderColor: "var(--primary)" } : {}),
                                }}
                              >
                                <div className="proposal-card-header">
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <span className="proposal-card-name">{p.client || p.fileName}</span>
                                    {p.createdAt && (
                                      <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 3, lineHeight: 1.4 }}>
                                        {new Date(p.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}
                                      </span>
                                    )}
                                    <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2, lineHeight: 1.4, wordBreak: "break-all" }}>
                                      {p.fileName.includes("::") ? p.fileName.split("::")[1] : p.fileName}
                                    </span>
                                  </div>
                                  {p.status && (
                                    <span
                                      className={
                                        p.status === "approved" ? "badge--approved" :
                                        p.status === "finalized" ? "badge--finalized" :
                                        p.status === "under_review" ? "badge--under-review" :
                                        "badge--draft"
                                      }
                                      style={{ flexShrink: 0, fontSize: 10, fontWeight: 500, background: "transparent", border: "none" }}
                                    >
                                      {p.status.replace("_", " ").toUpperCase()}
                                    </span>
                                  )}
                                </div>
                                {isSelected && loadingContent && (
                                  <p className="loading">Loading content…</p>
                                )}
                                {isSelected && !loadingContent && mdContent && (
                                  <p style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--color-success)" }}>
                                    <Check size={12} strokeWidth={2.5} /> Ready
                                  </p>
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
              {step === "brand" && (
                <div>
                  <div className="form-row">
                    {/* Company name */}
                    <div className="form-group">
                      <label>Client * <span style={{ color: "var(--color-text-muted)", fontWeight: 400, fontSize: 12 }}>(this name will appear on the microsite)</span></label>
                      <input
                        type="text"
                        className="input"
                        placeholder="e.g. Acme Corp"
                        maxLength={100}
                        value={brand.companyName}
                        onChange={(e) =>
                          setBrand((b) => ({
                            ...b,
                            companyName: e.target.value,
                          }))
                        }
                      />
                    </div>

                    {/* Logo upload — PNG & SVG only */}
                    <div className="form-group">
                      <label>Logo <span style={{ color: "var(--color-text-muted)", fontWeight: 400, fontSize: 12 }}>(this logo will appear on the microsite)</span></label>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        {brand.logoUrl && (
                          <div
                            style={{
                              width: 48,
                              height: 48,
                              borderRadius: "var(--radius)",
                              border: "1px solid var(--color-border)",
                              overflow: "hidden",
                              flexShrink: 0,
                              background: "var(--color-surface)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={brand.logoUrl}
                              alt="logo preview"
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
                              }}
                            />
                          </div>
                        )}
                        <label
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                            padding: "8px 10px",
                            borderRadius: "var(--radius)",
                            cursor: logoExtracting ? "not-allowed" : "pointer",
                            border: "1px dashed var(--color-border)",
                            background: "var(--color-surface)",
                            color: "var(--color-text-muted)",
                            fontSize: 13,
                            opacity: logoExtracting ? 0.6 : 1,
                          }}
                        >
                          {logoExtracting
                            ? "⏳ Extracting colors…"
                            : `↑ ${brand.logoUrl ? "Change logo" : "Upload logo"}`}
                          <input
                            type="file"
                            accept="image/png,image/svg+xml"
                            style={{ display: "none" }}
                            disabled={logoExtracting}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = async (ev) => {
                                const dataUrl = ev.target?.result as string;
                                setBrand((b) => ({ ...b, logoUrl: dataUrl }));
                                setLogoExtracting(true);
                                setColorsAutoExtracted(false);
                                try {
                                  const { primary, secondary } =
                                    await extractLogoColors(file, dataUrl);
                                  setBrand((b) => ({
                                    ...b,
                                    primaryColor: primary,
                                    secondaryColor: secondary,
                                  }));
                                  setColorsAutoExtracted(true);
                                } finally {
                                  setLogoExtracting(false);
                                }
                              };
                              reader.readAsDataURL(file);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {brand.logoUrl && !logoExtracting && (
                          <button
                            className="btn btn-sm"
                            onClick={() => {
                              setBrand((b) => ({ ...b, logoUrl: null }));
                              setColorsAutoExtracted(false);
                            }}
                            title="Remove logo"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {colorsAutoExtracted && !logoExtracting && (
                        <p
                          style={{
                            fontSize: 11,
                            color: "var(--color-success)",
                            marginTop: 4,
                          }}
                        >
                          ✓ Colors auto-extracted from logo — you can override
                          below
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Tagline</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. Strategy & Design Consultancy"
                      value={brand.tagline}
                      onChange={(e) =>
                        setBrand((b) => ({ ...b, tagline: e.target.value }))
                      }
                    />
                  </div>

                  <div className="form-row">
                    {/* Primary color */}
                    <div className="form-group">
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        Primary Color (accent)
                        {colorsAutoExtracted && (
                          <span
                            className="badge"
                            style={{
                              fontSize: 10,
                              background: "var(--color-success)",
                              color: "#fff",
                              border: "none",
                            }}
                          >
                            auto
                          </span>
                        )}
                      </label>
                      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                        <label
                          style={{
                            position: "relative",
                            width: 35,
                            flexShrink: 0,
                            borderRadius: 6,
                            border: "1px solid var(--color-border)",
                            background: brand.primaryColor || "#888888",
                            overflow: "hidden",
                            cursor: "pointer",
                            display: "block",
                          }}
                        >
                          <input
                            type="color"
                            value={brand.primaryColor || "#888888"}
                            onChange={(e) => {
                              setBrand((b) => ({
                                ...b,
                                primaryColor: e.target.value,
                              }));
                              setColorsAutoExtracted(false);
                            }}
                            style={{
                              position: "absolute",
                              inset: 0,
                              width: "100%",
                              height: "100%",
                              opacity: 0,
                              cursor: "pointer",
                              border: "none",
                              padding: 0,
                            }}
                          />
                        </label>
                        <input
                          type="text"
                          className="input"
                          value={brand.primaryColor}
                          onChange={(e) => {
                            setBrand((b) => ({
                              ...b,
                              primaryColor: e.target.value,
                            }));
                            setColorsAutoExtracted(false);
                          }}
                          style={{ fontFamily: "monospace" }}
                        />
                      </div>
                    </div>

                    {/* Secondary color */}
                    <div className="form-group">
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        Secondary Color
                        {colorsAutoExtracted && (
                          <span
                            className="badge"
                            style={{
                              fontSize: 10,
                              background: "var(--color-success)",
                              color: "#fff",
                              border: "none",
                            }}
                          >
                            auto
                          </span>
                        )}
                      </label>
                      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                        <label
                          style={{
                            position: "relative",
                            width: 35,
                            flexShrink: 0,
                            borderRadius: 6,
                            border: "1px solid var(--color-border)",
                            background: brand.secondaryColor || "#888888",
                            overflow: "hidden",
                            cursor: "pointer",
                            display: "block",
                          }}
                        >
                          <input
                            type="color"
                            value={brand.secondaryColor || "#888888"}
                            onChange={(e) => {
                              setBrand((b) => ({
                                ...b,
                                secondaryColor: e.target.value,
                              }));
                              setColorsAutoExtracted(false);
                            }}
                            style={{
                              position: "absolute",
                              inset: 0,
                              width: "100%",
                              height: "100%",
                              opacity: 0,
                              cursor: "pointer",
                              border: "none",
                              padding: 0,
                            }}
                          />
                        </label>
                        <input
                          type="text"
                          className="input"
                          value={brand.secondaryColor}
                          onChange={(e) => {
                            setBrand((b) => ({
                              ...b,
                              secondaryColor: e.target.value,
                            }));
                            setColorsAutoExtracted(false);
                          }}
                          style={{ fontFamily: "monospace" }}
                        />
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* ═══ STEP 3: CHOOSE STYLE ═══ */}
              {step === "plugin" && (
                <div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, 1fr)",
                      gap: 10,
                    }}
                  >
                    {/* ── Default 4 theme cards — same ThemePreviewCard as expanded panel ── */}
                    {THEME_REGISTRY.filter((t) =>
                      DEFAULT_PLUGIN_IDS.includes(t.id),
                    ).map((theme) => (
                      <ThemePreviewCard
                        key={theme.id}
                        theme={theme}
                        selected={selectedPlugin === theme.id}
                        onSelect={handleSelectPlugin}
                        onPreview={handlePreview}
                        size="default"
                      />
                    ))}

                    {/* ── More Themes card ── */}
                    <button
                      key="more-themes"
                      onClick={() => setIsThemeModalOpen(true)}
                      title="Browse all available themes"
                      style={{
                        background: "none",
                        padding: 0,
                        cursor: "pointer",
                        textAlign: "left",
                        border: "2px solid var(--color-border)",
                        borderRadius: 12,
                        overflow: "hidden",
                        boxShadow: "var(--shadow)",
                        transition: "border-color 0.2s",
                      }}
                    >
                      <div
                        style={{
                          height: 130,
                          position: "relative",
                          overflow: "hidden",
                          background: "var(--color-surface)",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                        }}
                      >
                        <div style={{ display: "flex", gap: 4 }}>
                          {["#6366f1", "#f59e0b", "#22c55e", "#ef4444"].map((c, i) => (
                            <span key={i} style={{ width: 16, height: 16, borderRadius: 4, background: c, opacity: 0.7 }} />
                          ))}
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", letterSpacing: "0.04em" }}>+{THEME_REGISTRY.filter((t) => !DEFAULT_PLUGIN_IDS.includes(t.id)).length} MORE</span>
                      </div>
                      <div
                        style={{
                          padding: "10px 12px",
                          background: "var(--color-surface)",
                          borderTop: "1px solid var(--color-border)",
                        }}
                      >
                        <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 2px", color: "var(--color-text)" }}>
                          More Themes
                        </p>
                        <p className="muted" style={{ fontSize: 11, lineHeight: 1.4, margin: 0 }}>
                          Browse all styles
                        </p>
                      </div>
                    </button>

                    {/* ── No Theme card ── */}
                    {(() => {
                      const noThemeActive = selectedPlugin === null;
                      return (
                        <button
                          key="no-theme"
                          onClick={() =>
                            handleSelectPlugin(
                              noThemeActive ? "obsidian" : null,
                            )
                          }
                          title="Generate without a design theme"
                          style={{
                            background: "none",
                            padding: 0,
                            cursor: "pointer",
                            textAlign: "left",
                            border: `2px solid ${noThemeActive ? "var(--color-primary)" : "var(--color-border)"}`,
                            borderRadius: 12,
                            overflow: "hidden",
                            boxShadow: noThemeActive
                              ? "0 0 0 3px #bfdbfe"
                              : "var(--shadow)",
                            transition: "border-color 0.2s",
                          }}
                        >
                          <div
                            style={{
                              height: 130,
                              position: "relative",
                              overflow: "hidden",
                              background:
                                "repeating-linear-gradient(45deg, var(--color-bg) 0px, var(--color-bg) 8px, var(--color-border) 8px, var(--color-border) 9px)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 32,
                                opacity: 0.2,
                                color: "var(--color-text)",
                              }}
                            >
                              ∅
                            </span>
                            {noThemeActive && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: 7,
                                  right: 7,
                                  width: 20,
                                  height: 20,
                                  borderRadius: "50%",
                                  background: "var(--color-primary)",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#fff",
                                }}
                              >
                                <Check size={10} strokeWidth={3} />
                              </div>
                            )}
                          </div>
                          <div
                            style={{
                              padding: "10px 12px",
                              background: "var(--color-surface)",
                              borderTop: "1px solid var(--color-border)",
                            }}
                          >
                            <p
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                margin: "0 0 2px",
                                color: noThemeActive
                                  ? "var(--color-primary)"
                                  : "var(--color-text)",
                              }}
                            >
                              No Theme
                            </p>
                            <p
                              className="muted"
                              style={{
                                fontSize: 11,
                                lineHeight: 1.4,
                                margin: 0,
                              }}
                            >
                              Clean default layout
                            </p>
                          </div>
                        </button>
                      );
                    })()}
                  </div>

                  {/* Custom prompt */}
                  <div
                    className="form-group"
                    style={{ marginTop: 24, marginBottom: 0 }}
                  >
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      Prompt & Design Instructions
                      {designBrief.trim() && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "2px 7px",
                            borderRadius: 4,
                            background: "var(--color-primary)",
                            color: "#fff",
                            letterSpacing: "0.03em",
                          }}
                        >
                          AI-customized
                        </span>
                      )}
                    </label>
                    <textarea
                      className="input"
                      rows={8}
                      placeholder="e.g. dark premium theme, 3 sections, remove pricing, add fade-in animations…"
                      value={designBrief}
                      onChange={(e) => setDesignBrief(e.target.value)}
                      style={{
                        resize: "vertical",
                        fontFamily: "inherit",
                        lineHeight: 1.6,
                      }}
                    />

                    {/* Reference file attachment */}
                    <input
                      id="ref-file-input"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,application/pdf"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 4 * 1024 * 1024) {
                          alert("File must be under 4 MB");
                          e.target.value = "";
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = () => {
                          const base64 = reader.result as string;
                          // Extract dominant colors via canvas for accurate hex sampling
                          if (file.type.startsWith("image/")) {
                            const img = new Image();
                            img.onload = () => {
                              try {
                                const canvas = document.createElement("canvas");
                                const MAX = 120; // downsample for speed
                                const scale = Math.min(
                                  1,
                                  MAX / Math.max(img.width, img.height),
                                );
                                canvas.width = Math.round(img.width * scale);
                                canvas.height = Math.round(img.height * scale);
                                const ctx = canvas.getContext("2d");
                                if (!ctx) {
                                  setReferenceFile({
                                    base64,
                                    mediaType: file.type,
                                    fileName: file.name,
                                  });
                                  return;
                                }
                                ctx.drawImage(
                                  img,
                                  0,
                                  0,
                                  canvas.width,
                                  canvas.height,
                                );
                                const { data } = ctx.getImageData(
                                  0,
                                  0,
                                  canvas.width,
                                  canvas.height,
                                );
                                const toHex = (v: number) =>
                                  Math.min(255, Math.max(0, v))
                                    .toString(16)
                                    .padStart(2, "0");
                                // Saturation helper — how vivid is a color (0=grey, 1=fully saturated)
                                const saturation = (
                                  r: number,
                                  g: number,
                                  b: number,
                                ) => {
                                  const max = Math.max(r, g, b),
                                    min = Math.min(r, g, b);
                                  return max === 0 ? 0 : (max - min) / max;
                                };
                                // Bucket pixels into 24-step bins — track count AND max saturation seen
                                const buckets = new Map<
                                  string,
                                  {
                                    r: number;
                                    g: number;
                                    b: number;
                                    count: number;
                                    sat: number;
                                  }
                                >();
                                for (let i = 0; i < data.length; i += 4) {
                                  if (data[i + 3] < 128) continue;
                                  const r = Math.min(
                                    255,
                                    Math.round(data[i] / 24) * 24,
                                  );
                                  const g = Math.min(
                                    255,
                                    Math.round(data[i + 1] / 24) * 24,
                                  );
                                  const b = Math.min(
                                    255,
                                    Math.round(data[i + 2] / 24) * 24,
                                  );
                                  const sat = saturation(r, g, b);
                                  const key = `${r},${g},${b}`;
                                  const entry = buckets.get(key);
                                  if (entry) {
                                    entry.count++;
                                    entry.sat = Math.max(entry.sat, sat);
                                  } else {
                                    buckets.set(key, {
                                      r,
                                      g,
                                      b,
                                      count: 1,
                                      sat,
                                    });
                                  }
                                }
                                const all = [...buckets.values()];
                                // Sort by frequency for background/dominant detection
                                const byFreq = [...all].sort(
                                  (a, b) => b.count - a.count,
                                );
                                // Sort by perceptual vividness = saturation × brightness.
                                // HSV saturation alone is 1.0 for near-black colors (e.g. #000018 = R0 G0 B24),
                                // which would rank dark navies above magenta. Multiplying by min(lum/128, 1)
                                // penalises dark colors so only truly bright+saturated accents rank first.
                                const bySat = [...all]
                                  .map((c) => {
                                    const lum =
                                      0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
                                    return {
                                      ...c,
                                      lum,
                                      vivid: c.sat * Math.min(lum / 128, 1),
                                    };
                                  })
                                  .filter((c) => c.sat > 0.35 && c.vivid > 0.2)
                                  .sort((a, b) => b.vivid - a.vivid);

                                const lightColors: string[] = []; // backgrounds (high luminance)
                                const darkColors: string[] = []; // dark backgrounds
                                const brandColors: string[] = []; // mid-tone frequent colors
                                const vividColors: string[] = []; // high saturation accents

                                // Collect vivid colors first (these are neon accents regardless of frequency)
                                for (const { r, g, b } of bySat.slice(0, 4)) {
                                  vividColors.push(
                                    `#${toHex(r)}${toHex(g)}${toHex(b)}`,
                                  );
                                }
                                // Classify frequent colors by luminance
                                for (const { r, g, b } of byFreq.slice(0, 14)) {
                                  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                                  const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
                                  if (lum > 180) {
                                    if (lightColors.length < 3)
                                      lightColors.push(hex);
                                  } else if (lum < 30) {
                                    if (darkColors.length < 2)
                                      darkColors.push(hex);
                                  } else {
                                    if (brandColors.length < 4)
                                      brandColors.push(hex);
                                  }
                                }

                                // Determine if this is a dark-background image
                                const isDarkImage = lightColors.length === 0;
                                // Layout: [bg candidates] [vivid accents] [mid-tone brand]
                                const dominantColors = isDarkImage
                                  ? [
                                      ...darkColors.slice(0, 1),
                                      ...vividColors.slice(0, 4),
                                      ...brandColors.slice(0, 3),
                                    ]
                                  : [
                                      ...lightColors,
                                      ...vividColors.slice(0, 3),
                                      ...brandColors.slice(0, 3),
                                    ];
                                setReferenceFile({
                                  base64,
                                  mediaType: file.type,
                                  fileName: file.name,
                                  dominantColors,
                                });
                              } catch {
                                setReferenceFile({
                                  base64,
                                  mediaType: file.type,
                                  fileName: file.name,
                                });
                              }
                            };
                            img.src = base64;
                          } else {
                            setReferenceFile({
                              base64,
                              mediaType: file.type,
                              fileName: file.name,
                            });
                          }
                        };
                        reader.readAsDataURL(file);
                        e.target.value = "";
                      }}
                    />
                    {/* ── Attach + URL in one row ── */}
                    <div style={{ display: "flex", alignItems: "stretch", gap: 8, marginTop: 8 }}>
                      {/* Attach button */}
                      <button
                        type="button"
                        onClick={() => document.getElementById("ref-file-input")?.click()}
                        style={{
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 14,
                          padding: "8px 10px",
                          background: "var(--color-surface)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 6,
                          color: "var(--color-text-muted)",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <Paperclip size={12} />
                        {referenceFile ? referenceFile.fileName.slice(0, 18) + (referenceFile.fileName.length > 18 ? "…" : "") : "Attach design screenshot"}
                        {referenceFile && (
                          <span
                            onMouseDown={(e) => { e.stopPropagation(); setReferenceFile(null); }}
                            style={{ marginLeft: 2, lineHeight: 1, cursor: "pointer", color: "var(--color-text-muted, #888)" }}
                          >
                            <X size={10} />
                          </span>
                        )}
                      </button>

                      {/* URL input */}
                      <div style={{ position: "relative", flex: 1 }}>
                        <span
                          style={{
                            position: "absolute",
                            left: 8,
                            top: "50%",
                            transform: "translateY(-50%)",
                            color: "var(--color-text-muted, #888)",
                            pointerEvents: "none",
                            display: "flex",
                          }}
                        >
                          <Globe size={12} />
                        </span>
                        <input
                          type="url"
                          className="input"
                          placeholder="Paste a website URL to extract design tokens"
                          value={urlInput}
                          onChange={(e) => {
                            const val = e.target.value;
                            setUrlInput(val);
                            if (!val.trim()) {
                              setUrlReferenceDesign(null);
                              setUrlExtractionState("idle");
                              if (urlDebounceRef.current)
                                clearTimeout(urlDebounceRef.current);
                              return;
                            }
                            setUrlExtractionState("loading");
                            if (urlDebounceRef.current)
                              clearTimeout(urlDebounceRef.current);
                            urlDebounceRef.current = setTimeout(async () => {
                              try {
                                const result = await extractUrlDesign(apiKey, val.trim());
                                if (result.tokens) {
                                  setUrlReferenceDesign(result.tokens);
                                  setUrlExtractionState("success");
                                } else {
                                  setUrlReferenceDesign(null);
                                  setUrlExtractionState(
                                    result.error === "blocked_by_bot_protection" ? "blocked" : "error",
                                  );
                                }
                              } catch {
                                setUrlReferenceDesign(null);
                                setUrlExtractionState("error");
                              }
                            }, 800);
                          }}
                          style={{ paddingLeft: 28, paddingRight: 28 }}
                        />
                        {urlInput && (
                          <button
                            type="button"
                            onClick={() => {
                              setUrlInput("");
                              setUrlReferenceDesign(null);
                              setUrlExtractionState("idle");
                              if (urlDebounceRef.current) clearTimeout(urlDebounceRef.current);
                            }}
                            style={{
                              position: "absolute",
                              right: 6,
                              top: "50%",
                              transform: "translateY(-50%)",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: "var(--color-text-muted, #888)",
                              display: "flex",
                              alignItems: "center",
                              padding: 2,
                            }}
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                      {urlExtractionState === "loading" && (
                        <span
                          style={{
                            fontSize: 13,
                            color: "var(--color-text-muted, #888)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          extracting…
                        </span>
                      )}
                      {urlExtractionState === "success" &&
                        urlReferenceDesign && (
                          <span
                            style={{
                              fontSize: 13,
                              color: "#4ade80",
                              whiteSpace: "nowrap",
                            }}
                            title={urlReferenceDesign.style.vibe}
                          >
                            ✓ tokens ready
                          </span>
                        )}
                      {urlExtractionState === "error" && (
                        <span
                          style={{
                            fontSize: 13,
                            color: "#f87171",
                            whiteSpace: "nowrap",
                          }}
                        >
                          ⚠ could not extract
                        </span>
                      )}
                      {urlExtractionState === "blocked" && (
                        <span
                          style={{
                            fontSize: 13,
                            color: "#fb923c",
                            whiteSpace: "nowrap",
                          }}
                          title="This site uses bot protection (e.g. Cloudflare) that blocks server-side CSS fetching. Try another URL or use the brand color fields instead."
                        >
                          ⊘ blocked by site
                        </span>
                      )}
                    </div>
                    {urlReferenceDesign && (
                      <div
                        style={{
                          marginTop: 6,
                          display: "flex",
                          gap: 6,
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        {[
                          urlReferenceDesign.colors.primary,
                          urlReferenceDesign.colors.secondary,
                          urlReferenceDesign.colors.accent,
                          urlReferenceDesign.colors.background,
                        ]
                          .filter(Boolean)
                          .map((color, i) => (
                            <span
                              key={i}
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: 3,
                                background: color,
                                border: "1px solid var(--color-border, #333)",
                                display: "inline-block",
                              }}
                              title={color}
                            />
                          ))}
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--color-text-muted, #888)",
                            marginLeft: 4,
                          }}
                        >
                          {urlReferenceDesign.typography.headingFont} ·{" "}
                          {urlReferenceDesign.style.borderRadius}
                        </span>
                      </div>
                    )}

                  </div>
                </div>
              )}

              {/* ═══ STEP 4: GENERATING ═══ */}
              {step === "generate" && (
                <div style={{ padding: "4px 0" }}>
                  {/* Restored-from-navigation banner */}
                  {!generating && progress.length > 0 && !layoutAST && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        marginBottom: 16,
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius)",
                        gap: 12,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--color-text-muted)",
                        }}
                      >
                        {wasGenerating
                          ? "Checking for results…"
                          : "Generation interrupted while you were away."}
                      </span>
                      {!wasGenerating && (
                        <button
                          className="btn btn-sm btn-primary"
                          style={{ flexShrink: 0 }}
                          onClick={() => {
                            setStep("plugin");
                            setError(null);
                            setProgress([]);
                            setStreamingSections([]);
                          }}
                        >
                          ↺ Restart
                        </button>
                      )}
                    </div>
                  )}

                  {/* Pipeline progress */}
                  <div style={{ marginBottom: 20 }}>
                    {progress.map((p, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          marginBottom: 8,
                          opacity: p.done ? 1 : 0.6,
                          transition: "opacity 0.3s",
                        }}
                      >
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            flexShrink: 0,
                            background: p.done
                              ? "var(--color-primary)"
                              : "var(--color-surface)",
                            border: p.done
                              ? "none"
                              : "1px solid var(--color-border)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 9,
                            color: "#fff",
                            transition: "background 0.3s",
                          }}
                        >
                          {p.done ? "✓" : ""}
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            color: p.done
                              ? "var(--color-text)"
                              : "var(--color-text-muted)",
                          }}
                        >
                          {p.text}
                        </span>
                        {!p.done && (generating || wasGenerating) && (
                          <div
                            style={{
                              width: 11,
                              height: 11,
                              borderRadius: "50%",
                              flexShrink: 0,
                              border: "1.5px solid var(--color-border)",
                              borderTopColor: "var(--color-primary)",
                              animation: "spin 0.8s linear infinite",
                            }}
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  {error && (
                    <div
                      style={{
                        marginTop: 16,
                        padding: "12px 14px",
                        background: "#fef2f2",
                        border: "1px solid #fecaca",
                        borderRadius: "var(--radius)",
                      }}
                    >
                      <p className="error" style={{ marginTop: 0 }}>
                        {error}
                      </p>
                      <button
                        className="btn btn-sm"
                        style={{
                          marginTop: 8,
                          borderColor: "#fecaca",
                          color: "var(--color-error)",
                        }}
                        onClick={() => {
                          setStep("plugin");
                          setError(null);
                        }}
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
          {step !== "generate" && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 20,
              }}
            >
              {step !== "upload" && (
                <button
                  className="btn"
                  onClick={() => {
                    const prev: Record<StepId, StepId | null> = {
                      upload: null,
                      brand: "upload",
                      plugin: "brand",
                      generate: "plugin",
                      preview: "plugin",
                    };
                    const p = prev[step];
                    if (p) setStep(p);
                  }}
                  style={{ minWidth: 96 }}
                >
                  ← Back
                </button>
              )}
              {step === "upload" && <span />}


              {step === "upload" && (
                <button
                  className="btn btn-primary"
                  onClick={() => setStep("brand")}
                  disabled={!mdContent.trim() || loadingContent}
                  style={{ minWidth: 120, width: "auto" }}
                >
                  Next →
                </button>
              )}
              {step === "brand" && (
                <button
                  className="btn btn-primary"
                  onClick={() => setStep("plugin")}
                  disabled={!brand.companyName.trim()}
                  style={{ minWidth: 120, width: "auto" }}
                >
                  Next →
                </button>
              )}
              {step === "plugin" && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 8,
                  }}
                >
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setStep("generate");
                      setTimeout(runPipeline, 100);
                    }}
                    disabled={urlExtractionState === "loading"}
                    style={{
                      minWidth: 140,
                      width: "auto",
                      opacity: urlExtractionState === "loading" ? 0.5 : 1,
                      cursor:
                        urlExtractionState === "loading"
                          ? "not-allowed"
                          : "pointer",
                    }}
                  >
                    {urlExtractionState === "loading"
                      ? "Extracting design…"
                      : "⚡ Generate Microsite"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
          </div>
        </div>
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

      {/* Cancel generation confirmation dialog */}
      {showCancelConfirm && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 20000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCancelConfirm(false); }}
        >
          <div style={{ background: "var(--panel, var(--color-surface))", border: "1px solid var(--border, var(--color-border))", borderRadius: 12, width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.35)", overflow: "hidden" }}>
            <div style={{ padding: "20px 24px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <p style={{ fontSize: 16, fontWeight: 600, color: "var(--text, var(--color-text))", margin: 0, lineHeight: 1.5 }}>Cancel microsite creation?</p>
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted, var(--color-text-muted))", padding: 2, display: "flex", alignItems: "center" }}
                ><Icon icon={X} size="md" /></button>
              </div>
            </div>
            <div style={{ height: 1, background: "var(--border, var(--color-border))" }} />
            <div style={{ padding: 24 }}>
              <p style={{ fontSize: 14, color: "var(--text, var(--color-text))", marginBottom: 20, lineHeight: 1.5 }}>
                Your microsite is still being generated. If you cancel now, the current progress will be lost and you&apos;ll need to start over.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border, var(--color-border))", background: "var(--panel-soft, var(--color-surface))", color: "var(--text, var(--color-text))", fontSize: 14, cursor: "pointer" }}
                >Keep waiting</button>
                <button
                  onClick={() => {
                    userCancelledRef.current = true;
                    abortCtrlRef.current?.abort();
                    setShowCancelConfirm(false);
                    setShowGenerateModal(false);
                    setStep("plugin");
                    setGenerating(false);
                    setProgress([]);
                    setStreamingSections([]);
                    setError(null);
                  }}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--danger, #ef4444)", color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" }}
                >Cancel creation</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unified fullscreen theme preview — z-index 10000, above ThemeModal */}
      {previewTheme && (
        <ThemeFullPreview
          theme={previewTheme}
          allThemes={THEME_REGISTRY}
          onSelect={(id) => {
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
