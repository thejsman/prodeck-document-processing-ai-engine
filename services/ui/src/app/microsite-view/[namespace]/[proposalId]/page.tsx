'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, AlertTriangle, Zap } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { fetchMicrositeContent, fetchMicrositeDirectHtml, generateMicrositeDirectStream, getSuperClientMicrosite } from '@/lib/api';
import { Microsite } from '@/components/microsite/Microsite';
import { MicrositePro } from '@/components/microsite/MicrositePro';
import { buildHtml } from '@/components/MicrositeV2';
import type { LayoutAST } from '@/types/presentation';

type ViewMode = 'direct' | 'ast';

export default function MicrositeViewPage() {
  const { namespace, proposalId } = useParams<{ namespace: string; proposalId: string }>();
  const searchParams = useSearchParams();
  const entryId = searchParams.get('entryId') ?? undefined;
  const modeParam = searchParams.get('mode') as 'pro' | 'classic' | null;
  const scClient = searchParams.get('scClient') ?? undefined;
  const scId = searchParams.get('scId') ?? undefined;
  const { apiKey } = useAuth();
  const router = useRouter();

  const [ast, setAst] = useState<LayoutAST | null>(null);
  const [directHtml, setDirectHtml] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('direct');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Fast generation state
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);   // 0-100
  const [genMsg, setGenMsg]           = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!namespace || !proposalId) return;
    setLoading(true);

    // Super-client microsite: load directly from the SC API
    if (scClient && scId) {
      getSuperClientMicrosite(apiKey, scClient, scId)
        .then((loadedAst) => {
          setAst(loadedAst);
          setDirectHtml(null);
          setViewMode('ast');
          setLoading(false);
        })
        .catch(err => {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
      return;
    }

    // When entryId is provided, skip directHtml and load the specific AST entry.
    const tasks = entryId
      ? [Promise.resolve(null), fetchMicrositeContent(apiKey, namespace, proposalId, undefined, entryId).catch(() => ({ ast: null }))]
      : [fetchMicrositeDirectHtml(apiKey, namespace, proposalId).catch(() => null), fetchMicrositeContent(apiKey, namespace, proposalId, modeParam ?? undefined).catch(() => ({ ast: null }))];
    Promise.all(tasks)
      .then(([html, astResult]) => {
        const data = (astResult as { ast: unknown } | null)?.ast ?? null;
        setDirectHtml(html as string | null);
        setAst(data as LayoutAST | null);
        setViewMode(html ? 'direct' : 'ast');
        setLoading(false);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [namespace, proposalId, entryId, modeParam, scClient, scId, apiKey]);

  async function startFastGeneration() {
    if (!apiKey || !namespace || !proposalId || generating) return;
    abortRef.current = new AbortController();
    setGenerating(true);
    setGenProgress(2);
    setGenMsg('Reading proposal…');

    let accumulated = '';
    let charCount   = 0;
    const EXPECTED_CHARS = 120_000; // ~32 000 tokens × ~3.75 chars/token

    try {
      await generateMicrositeDirectStream(
        apiKey,
        namespace,
        proposalId,
        { signal: abortRef.current.signal },
        (event) => {
          if (event.type === 'start') {
            setGenMsg('Generating microsite…');
            setGenProgress(5);
          } else if (event.type === 'html_chunk' && event.chunk) {
            accumulated += event.chunk;
            charCount   += event.chunk.length;
            // Progress: 5 % start → 95 % near end, based on expected output size
            const pct = Math.min(95, 5 + Math.round((charCount / EXPECTED_CHARS) * 90));
            setGenProgress(pct);
            setGenMsg(`Writing HTML… (${Math.round(charCount / 1000)} KB)`);
          } else if (event.type === 'complete') {
            setGenProgress(100);
            setGenMsg(`Done — ${Math.round((event.size ?? charCount) / 1000)} KB in ${Math.round((event.elapsed ?? 0) / 1000)} s`);
            setDirectHtml(accumulated);
            setViewMode('direct');
            setGenerating(false);
          } else if (event.type === 'error') {
            setGenMsg(`Error: ${event.message ?? 'Generation failed'}`);
            setGenerating(false);
          }
        },
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setGenMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      setGenerating(false);
    }
  }

  function cancelGeneration() {
    abortRef.current?.abort();
    setGenerating(false);
    setGenMsg('');
    setGenProgress(0);
  }

  // ── Loading / error screens ────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a', color: '#fff' }}>
        <div style={{ textAlign: 'center' }}>
          <Icon icon={LoaderCircle} size="xl" style={{ marginBottom: 12, animation: 'spin 1s linear infinite', display: 'inline-block' }} />
          <p style={{ fontSize: 14, color: '#888' }}>Loading microsite…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a', color: '#fff' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <Icon icon={AlertTriangle} size="xl" style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 16, fontWeight: 400, marginBottom: 8, lineHeight: 1.5, letterSpacing: '0em' }}>Failed to load microsite</p>
          <p style={{ fontSize: 13, color: '#888', lineHeight: 1.5, letterSpacing: '0.01em' }}>{error}</p>
        </div>
      </div>
    );
  }

  // ── Nothing generated yet ──────────────────────────────────────────────────
  if (!directHtml && !ast) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a', color: '#fff' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 48, marginBottom: 12, lineHeight: 1.1 }}>📄</p>
          <p style={{ fontSize: 16, fontWeight: 400, lineHeight: 1.5, letterSpacing: '0em' }}>No microsite generated yet</p>
          <p style={{ fontSize: 13, color: '#888', marginTop: 8, lineHeight: 1.5, letterSpacing: '0.01em' }}>Generate from the presentation builder or use fast mode below.</p>
          <button
            onClick={startFastGeneration}
            disabled={generating}
            style={{
              marginTop: 20, display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: '#f59e0b', color: '#000', fontWeight: 600, fontSize: 14,
            }}
          >
            <Icon icon={Zap} size="sm" /> Generate Fast (~20 s)
          </button>
        </div>
      </div>
    );
  }

  // ── Fast-generation progress overlay ──────────────────────────────────────
  const genOverlay = generating ? (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100000,
      background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16, color: '#fff',
    }}>
      <p style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.02em' }}>⚡ Fast Generation</p>
      <div style={{ width: 320, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 3, background: '#f59e0b',
          width: `${genProgress}%`, transition: 'width 0.4s ease',
        }} />
      </div>
      <p style={{ fontSize: 13, color: '#aaa' }}>{genMsg}</p>
      <button onClick={cancelGeneration} style={{
        marginTop: 4, padding: '6px 16px', borderRadius: 6, border: '1px solid #444',
        background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 12,
      }}>Cancel</button>
    </div>
  ) : null;

  // ── Toolbar (view toggle + generate fast button) ───────────────────────────
  // Hidden entirely for v2 microsites — no actions apply.
  const isV2 = ast?.generationMode === 'v2';
  const toolbar = isV2 ? null : (
    <div style={{
      position: 'fixed', top: 12, right: 16, zIndex: 99999,
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)',
      borderRadius: 8, padding: '4px 6px',
    }}>
      {/* View toggle — only when both versions exist */}
      {directHtml && ast && (['direct', 'ast'] as ViewMode[]).map(mode => (
        <button
          key={mode}
          onClick={() => setViewMode(mode)}
          style={{
            padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 500,
            background: viewMode === mode ? '#fff' : 'transparent',
            color: viewMode === mode ? '#000' : '#aaa',
          }}
        >
          {mode === 'direct' ? 'Direct HTML' : 'Editor View'}
        </button>
      ))}

      {/* Generate Fast button */}
      <button
        onClick={startFastGeneration}
        disabled={generating}
        title="Generate a new single-pass microsite (~20 s)"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', borderRadius: 6, border: 'none', cursor: generating ? 'default' : 'pointer',
          background: generating ? 'rgba(245,158,11,0.3)' : '#f59e0b',
          color: generating ? '#aaa' : '#000', fontSize: 12, fontWeight: 600,
          opacity: generating ? 0.6 : 1,
        }}
      >
        <Icon icon={Zap} size="sm" />
        {generating ? `${genProgress}%` : '⚡ Generate Fast'}
      </button>
    </div>
  );

  if (viewMode === 'direct' && directHtml) {
    return (
      <>
        {genOverlay}
        {toolbar}
        <iframe
          srcDoc={directHtml}
          sandbox="allow-scripts allow-same-origin"
          style={{ width: '100%', height: '100vh', border: 'none', display: 'block' }}
          title="Generated Microsite"
        />
      </>
    );
  }

  // v2 microsites — full-viewport iframe + floating pill buttons (Back + Download)
  // matching the same control bar style used by the Microsite component.
  if (ast?.generationMode === 'v2') {
    const rawHtml = buildHtml(ast);
    const bodyOpen = rawHtml.search(/<body[^>]*>/i);
    const NAV_FIX = `<style id="__fs-layout-fix__">body{display:block!important;}[data-section-id]{margin-left:auto!important;margin-right:auto!important;}</style><script>document.addEventListener('click',function(e){var a=e.target.closest('a[href^="#"]');if(!a)return;e.preventDefault();var id=a.getAttribute('href').slice(1);var el=document.getElementById(id)||document.querySelector('[name="'+id+'"]');if(el)el.scrollIntoView({behavior:'smooth'});},true);</script>`;
    const tagEnd = bodyOpen !== -1 ? rawHtml.indexOf('>', bodyOpen) + 1 : -1;
    const fsHtml = tagEnd > 0 ? rawHtml.slice(0, tagEnd) + NAV_FIX + rawHtml.slice(tagEnd) : rawHtml;

    const pillStyle: React.CSSProperties = {
      padding: '9px 18px',
      borderRadius: 100,
      border: '1px solid rgba(0,0,0,0.15)',
      background: 'rgba(255,255,255,0.95)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      color: '#111',
      fontSize: '0.8rem',
      fontWeight: 400,
      cursor: 'pointer',
      boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    };

    function downloadV2Html() {
      const blob = new Blob([rawHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${ast!.meta?.client || 'microsite'}.html`;
      a.click();
      URL.revokeObjectURL(url);
    }

    return (
      <>
        {genOverlay}
        <iframe
          srcDoc={fsHtml}
          style={{ width: '100%', height: '100vh', border: 'none', display: 'block' }}
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          title="Generated Microsite"
        />
        <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', alignItems: 'center', gap: 8, zIndex: 99999 }}>
          <button onClick={() => router.back()} style={pillStyle}>← Back</button>
          <button onClick={downloadV2Html} style={pillStyle}>↓ Download</button>
        </div>
      </>
    );
  }

  const isPro = ast?.generationMode !== 'classic';
  const entryParam = entryId ? `?entryId=${encodeURIComponent(entryId)}` : '';
  const editorPath = isPro
    ? `/microsite-editor-pro/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}${entryParam}`
    : `/microsite-editor/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}${entryParam}`;
  const MicrositeComponent = isPro ? MicrositePro : Microsite;

  return (
    <>
      {genOverlay}
      {toolbar}
      <MicrositeComponent
        ast={ast!}
        mode="fullscreen"
        onBack={() => router.back()}
        onEdit={() => router.push(editorPath)}
      />
    </>
  );
}
