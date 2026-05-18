'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useSearchParams } from 'next/navigation';
import {
  listSkills,
  getSkillDetail,
  createSkillApi,
  updateSkillApi,
  deleteSkillApi,
  generateSkillApi,
  applySkillAssistApi,
  uploadSkillAssetApi,
  deleteSkillAssetApi,
  listSkillAssetsApi,
  listDesignSkillsApi,
  getDesignSkillApi,
  createDesignSkillApi,
  updateDesignSkillApi,
  deleteDesignSkillApi,
  type SkillSummaryApi,
  type SkillDetailApi,
  type SkillApi,
  type SectionDefinitionApi,
  type MicrositeDefaultsApi,
  type PricingDefaultsApi,
  type GeneratedSkillApi,
  type AssetInfoApi,
  type DesignSkillApi,
  type DesignSkillSummaryApi,
} from '@/lib/api';
import { OverviewTab } from '@/components/SkillEditor/OverviewTab';
import { SectionsTab } from '@/components/SkillEditor/SectionsTab';
import { InstructionsTab } from '@/components/SkillEditor/InstructionsTab';
import { PricingTab } from '@/components/SkillEditor/PricingTab';
import { BrandingTab } from '@/components/SkillEditor/BrandingTab';
import { DesignSkillEditor } from '@/components/DesignSkillEditor';

type TabKey = 'overview' | 'sections' | 'instructions' | 'pricing' | 'branding';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'sections', label: 'Sections' },
  { key: 'instructions', label: 'Writing' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'branding', label: 'Branding' },
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'new-skill';
}

export default function SkillsPage() {
  const { apiKey } = useAuth();
  const searchParams = useSearchParams();

  // ── Skills list ─────────────────────────────────────────────────
  const [skills, setSkills] = useState<SkillSummaryApi[]>([]);
  const [listLoading, setListLoading] = useState(true);

  // ── Selection ────────────────────────────────────────────────────
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetailApi | null>(null);
  const [assets, setAssets] = useState<AssetInfoApi[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // ── Draft state (unsaved edits) ──────────────────────────────────
  const [draftSkill, setDraftSkill] = useState<Partial<SkillApi>>({});
  const [draftSections, setDraftSections] = useState<SectionDefinitionApi[]>([]);
  const [draftInstructions, setDraftInstructions] = useState('');

  // ── UI state ─────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── New skill modal ──────────────────────────────────────────────
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const newInputRef = useRef<HTMLInputElement>(null);

  // ── Mode toggle: proposal skills vs design skills ────────────────
  const [skillMode, setSkillMode] = useState<'proposal' | 'design'>('proposal');

  // ── Design skills state ──────────────────────────────────────────
  const [designSkills, setDesignSkills] = useState<DesignSkillSummaryApi[]>([]);
  const [designSkillsLoading, setDesignSkillsLoading] = useState(false);
  const [selectedDSSlug, setSelectedDSSlug] = useState<string | null>(null);
  const [draftDS, setDraftDS] = useState<Partial<DesignSkillApi>>({});
  const [dsIsNew, setDsIsNew] = useState(false);
  const [dsSaving, setDsSaving] = useState(false);
  const [dsSaveError, setDsSaveError] = useState<string | null>(null);
  const [dsSaveSuccess, setDsSaveSuccess] = useState(false);

  // ── Right panel resize ───────────────────────────────────────────
  const [rightPanelWidth, setRightPanelWidth] = useState(260);
  const [listPanelOpen, setListPanelOpen] = useState(true);
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(260);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = rightPanelWidth;
    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = resizeStartX.current - ev.clientX;
      setRightPanelWidth(Math.min(480, Math.max(180, resizeStartWidth.current + delta)));
    };
    const onMouseUp = () => {
      isResizing.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [rightPanelWidth]);

  // Close the list panel on mobile at initial mount only
  useEffect(() => {
    if (window.matchMedia('(max-width: 768px)').matches) {
      setListPanelOpen(false);
    }
  }, []);

  // ── Load skills ──────────────────────────────────────────────────
  const loadSkillList = useCallback(async () => {
    if (!apiKey) return;
    setListLoading(true);
    try {
      const list = await listSkills(apiKey);
      setSkills(list);
    } catch {
      // ok
    } finally {
      setListLoading(false);
    }
  }, [apiKey]);

  useEffect(() => { void loadSkillList(); }, [loadSkillList]);

  // ── Load design skills ───────────────────────────────────────────
  const loadDesignSkillList = useCallback(async () => {
    if (!apiKey) return;
    setDesignSkillsLoading(true);
    try {
      const list = await listDesignSkillsApi(apiKey);
      setDesignSkills(list);
    } catch { /* ok */ } finally {
      setDesignSkillsLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    if (skillMode === 'design') void loadDesignSkillList();
  }, [skillMode, loadDesignSkillList]);

  const selectDesignSkill = useCallback(async (slug: string) => {
    if (!apiKey) return;
    setSelectedDSSlug(slug);
    setDsIsNew(false);
    try {
      const ds = await getDesignSkillApi(apiKey, slug);
      setDraftDS(ds);
    } catch { /* ok */ }
  }, [apiKey]);

  const handleDSSave = async () => {
    if (!apiKey) return;
    setDsSaving(true);
    setDsSaveError(null);
    setDsSaveSuccess(false);
    try {
      if (dsIsNew) {
        const created = await createDesignSkillApi(apiKey, { displayName: draftDS.displayName ?? 'New Design Skill', ...draftDS });
        setDsIsNew(false);
        setSelectedDSSlug(created.slug);
        setDraftDS(created);
        await loadDesignSkillList();
      } else if (selectedDSSlug) {
        const updated = await updateDesignSkillApi(apiKey, selectedDSSlug, draftDS);
        setDraftDS(updated);
        await loadDesignSkillList();
      }
      setDsSaveSuccess(true);
      setTimeout(() => setDsSaveSuccess(false), 2000);
    } catch (err: unknown) {
      setDsSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setDsSaving(false);
    }
  };

  const handleDSDelete = async () => {
    if (!apiKey || !selectedDSSlug || !confirm(`Delete design skill "${selectedDSSlug}"?`)) return;
    await deleteDesignSkillApi(apiKey, selectedDSSlug);
    setSelectedDSSlug(null);
    setDraftDS({});
    await loadDesignSkillList();
  };

  const handleNewDesignSkill = () => {
    setSelectedDSSlug(null);
    setDraftDS({ displayName: '', aestheticTone: 'editorial/magazine', themeClass: 'light', animations: 'minimal', customInstructions: '', colorPalette: { primary: '#3b82f6' }, typography: { headingFont: 'Syne', bodyFont: 'DM Sans', headingStyle: 'bold' } });
    setDsIsNew(true);
  };

  // Auto-select from ?skill= query param
  useEffect(() => {
    const slug = searchParams.get('skill');
    if (slug && !selectedSlug) setSelectedSlug(slug);
  }, [searchParams, selectedSlug]);

  // ── Select skill ─────────────────────────────────────────────────
  const selectSkill = useCallback(async (slug: string) => {
    if (!apiKey) return;
    setSelectedSlug(slug);
    setDetail(null);
    setAssets([]);
    try {
      const [d, a] = await Promise.all([
        getSkillDetail(apiKey, slug),
        listSkillAssetsApi(apiKey, slug),
      ]);
      setDetail(d);
      setAssets(a);
      setDraftSkill(d.skill);
      setDraftSections(d.sections);
      setDraftInstructions(d.instructionsMd);
      setActiveTab('overview');
    } catch {
      // ok
    }
  }, [apiKey]);

  useEffect(() => {
    if (selectedSlug) void selectSkill(selectedSlug);
  }, [selectedSlug, selectSkill]);

  // ── Save ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!apiKey || !selectedSlug) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await updateSkillApi(apiKey, selectedSlug, {
        ...draftSkill,
        instructionsMd: draftInstructions,
        sections: draftSections,
      });
      setSaveSuccess(true);
      await loadSkillList();
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── New skill ────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!apiKey || !newName.trim()) return;
    setCreating(true);
    try {
      const slug = slugify(newName.trim());
      await createSkillApi(apiKey, {
        slug,
        displayName: newName.trim(),
        description: '',
        industries: [],
        projectTypes: [],
        tags: [],
        toneDescription: '',
        micrositeDefaults: {},
        scope: 'global',
        author: 'user',
        version: '1.0',
        instructionsMd: '',
        sections: [],
      });
      setShowNewModal(false);
      setNewName('');
      await loadSkillList();
      setSelectedSlug(slug);
    } catch {
      // ok
    } finally {
      setCreating(false);
    }
  };

  // ── AI: full generation ──────────────────────────────────────────
  const handleAIGenerate = async (description: string) => {
    if (!apiKey) return;
    setGenerating(true);
    try {
      const generated: GeneratedSkillApi = await generateSkillApi(apiKey, description);
      const slug = selectedSlug ?? slugify(generated.displayName);
      setDraftSkill((prev) => ({
        ...prev,
        displayName: generated.displayName,
        description: generated.description,
        industries: generated.industries,
        projectTypes: generated.projectTypes,
        tags: generated.tags,
        toneDescription: generated.toneDescription,
        micrositeDefaults: generated.micrositeDefaults ?? prev.micrositeDefaults ?? {},
        pricingDefaults: generated.pricingDefaults ?? prev.pricingDefaults,
        slug,
      }));
      setDraftSections(generated.sections);
      setDraftInstructions(generated.instructions);
    } finally {
      setGenerating(false);
    }
  };

  // ── AI: per-tab assist ───────────────────────────────────────────
  const handleTabAssist = async (instruction: string) => {
    if (!apiKey || !selectedSlug) return;
    let currentContent: unknown;
    switch (activeTab) {
      case 'overview': currentContent = draftSkill; break;
      case 'sections': currentContent = draftSections; break;
      case 'instructions': currentContent = draftInstructions; break;
      case 'pricing': currentContent = draftSkill.pricingDefaults; break;
      case 'branding': currentContent = draftSkill.micrositeDefaults; break;
    }
    const result = await applySkillAssistApi(apiKey, selectedSlug, activeTab, currentContent, instruction);
    if (result.sections) setDraftSections(result.sections as SectionDefinitionApi[]);
    if (result.instructions !== undefined) setDraftInstructions(result.instructions);
    if (result.pricingDefaults) setDraftSkill((p) => ({ ...p, pricingDefaults: result.pricingDefaults as PricingDefaultsApi }));
    if (result.micrositeDefaults) setDraftSkill((p) => ({ ...p, micrositeDefaults: result.micrositeDefaults as MicrositeDefaultsApi }));
    if (result.displayName || result.description || result.industries || result.toneDescription) {
      setDraftSkill((p) => ({ ...p, ...result }));
    }
  };

  // ── Asset operations ─────────────────────────────────────────────
  const handleAssetUpload = async (file: File) => {
    if (!apiKey || !selectedSlug) return;
    await uploadSkillAssetApi(apiKey, selectedSlug, file);
    const updated = await listSkillAssetsApi(apiKey, selectedSlug);
    setAssets(updated);
  };

  const handleAssetDelete = async (fileName: string) => {
    if (!apiKey || !selectedSlug) return;
    await deleteSkillAssetApi(apiKey, selectedSlug, fileName);
    setAssets((prev) => prev.filter((a) => a.fileName !== fileName));
  };

  // ── Delete skill ─────────────────────────────────────────────────
  const handleDeleteSkill = async (slug: string) => {
    if (!apiKey || !confirm(`Delete skill "${slug}"?`)) return;
    await deleteSkillApi(apiKey, slug);
    if (selectedSlug === slug) {
      setSelectedSlug(null);
      setDetail(null);
    }
    await loadSkillList();
  };

  const hasDetail = detail !== null && selectedSlug !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Topbar ── */}
      <div style={{
        height: 48,
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 12,
        flexShrink: 0,
      }}>
        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {(['proposal', 'design'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setSkillMode(mode)}
              style={{
                padding: '5px 14px',
                border: 'none',
                background: skillMode === mode ? 'var(--primary)' : 'transparent',
                color: skillMode === mode ? '#fff' : 'var(--text2)',
                fontSize: 12,
                fontWeight: skillMode === mode ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >
              {mode === 'proposal' ? 'Proposal Skills' : '🎨 Design Skills'}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button className="skills-list-toggle" onClick={() => setListPanelOpen((v) => !v)}>
          Skills
        </button>
        {skillMode === 'proposal' ? (
          <button
            onClick={() => { setShowNewModal(true); setTimeout(() => newInputRef.current?.focus(), 50); }}
            style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
          >
            + New Skill
          </button>
        ) : (
          <button
            onClick={handleNewDesignSkill}
            style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
          >
            + New Design Skill
          </button>
        )}
      </div>

      {/* ── Two-panel body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* LEFT: editor */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Design Skills editor */}
          {skillMode === 'design' && (dsIsNew || selectedDSSlug) ? (
            <DesignSkillEditor
              draft={draftDS}
              onChange={(updates) => setDraftDS((prev) => ({ ...prev, ...updates, colorPalette: updates.colorPalette ? { ...prev.colorPalette, ...updates.colorPalette } : prev.colorPalette, typography: updates.typography ? { ...(prev.typography ?? {}), ...updates.typography } as DesignSkillApi['typography'] : prev.typography }))}
              onSave={handleDSSave}
              onDelete={!dsIsNew ? handleDSDelete : undefined}
              saving={dsSaving}
              saveError={dsSaveError}
              saveSuccess={dsSaveSuccess}
              isNew={dsIsNew}
            />
          ) : skillMode === 'design' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', gap: 10 }}>
              <span style={{ fontSize: 32 }}>🎨</span>
              <p style={{ fontSize: 14, fontWeight: 500 }}>
                {designSkillsLoading ? 'Loading design skills…' : designSkills.length === 0 ? 'No design skills yet' : 'Select a design skill to edit'}
              </p>
              {!designSkillsLoading && designSkills.length === 0 && (
                <button onClick={handleNewDesignSkill} style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 16px', fontSize: 13, cursor: 'pointer' }}>Create your first Design Skill</button>
              )}
            </div>
          ) : hasDetail ? (
            <>
              {/* Tab bar + save */}
              <div style={{
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                padding: '0 16px',
                gap: 4,
                flexShrink: 0,
                height: 44,
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginRight: 8 }}>
                  {draftSkill.displayName || selectedSlug}
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>v{draftSkill.version ?? detail.skill.version}</span>
                </span>
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    style={{
                      background: 'none',
                      border: 'none',
                      borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
                      padding: '0 10px',
                      height: 44,
                      fontSize: 13,
                      fontWeight: activeTab === tab.key ? 600 : 400,
                      color: activeTab === tab.key ? 'var(--primary)' : 'var(--muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                {saveError && <span style={{ fontSize: 12, color: 'var(--danger, #e53e3e)' }}>{saveError}</span>}
                {saveSuccess && <span style={{ fontSize: 12, color: '#38a169' }}>Saved!</span>}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    background: 'var(--primary)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '5px 14px',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: saving ? 'wait' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                {activeTab === 'overview' && (
                  <OverviewTab
                    skill={draftSkill}
                    onChange={setDraftSkill}
                    onAIGenerate={handleAIGenerate}
                    generating={generating}
                  />
                )}
                {activeTab === 'sections' && (
                  <SectionsTab
                    sections={draftSections}
                    assets={assets}
                    onChange={setDraftSections}
                    onAIAssist={handleTabAssist}
                  />
                )}
                {activeTab === 'instructions' && (
                  <InstructionsTab
                    instructionsMd={draftInstructions}
                    onChange={setDraftInstructions}
                    onAIAssist={handleTabAssist}
                  />
                )}
                {activeTab === 'pricing' && (
                  <PricingTab
                    pricing={draftSkill.pricingDefaults}
                    onChange={(p) => setDraftSkill((prev) => ({ ...prev, pricingDefaults: p }))}
                    onAIAssist={handleTabAssist}
                  />
                )}
                {activeTab === 'branding' && (
                  <BrandingTab
                    micrositeDefaults={draftSkill.micrositeDefaults ?? {}}
                    assets={assets}
                    onChange={(m) => setDraftSkill((prev) => ({ ...prev, micrositeDefaults: m }))}
                    onAssetUpload={handleAssetUpload}
                    onAssetDelete={handleAssetDelete}
                    onAIAssist={handleTabAssist}
                  />
                )}
              </div>
            </>
          ) : (
            /* Proposal skills empty state */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', gap: 10 }}>
              <span style={{ fontSize: 32 }}>⚡</span>
              <p style={{ fontSize: 14, fontWeight: 500 }}>
                {listLoading ? 'Loading skills…' : skills.length === 0 ? 'No skills yet' : 'Select a skill to edit'}
              </p>
              {!listLoading && skills.length === 0 && (
                <p style={{ fontSize: 12 }}>Click &quot;+ New Skill&quot; to create one, or describe it in the Chat.</p>
              )}
            </div>
          )}
        </div>

        {/* RESIZE HANDLE */}
        <div
          className="skills-resize-handle"
          onMouseDown={handleResizeMouseDown}
          style={{
            width: 5,
            cursor: 'col-resize',
            background: 'var(--border)',
            flexShrink: 0,
            transition: 'background 0.1s',
          }}
        />

        {/* RIGHT: skill list */}
        <div className={`skills-list-panel${listPanelOpen ? ' is-open' : ''}`} style={{ width: rightPanelWidth, flexShrink: 0, overflowY: 'auto', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
          {skillMode === 'proposal' ? (
            <>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                My Skills ({skills.length})
              </div>
              {skills.length === 0 && !listLoading && (
                <p style={{ padding: 16, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>No skills yet</p>
              )}
              {skills.map((skill) => (
                <div
                  key={skill.slug}
                  onClick={() => setSelectedSlug(skill.slug)}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    background: selectedSlug === skill.slug ? 'var(--primary-soft, rgba(0,0,0,0.06))' : 'transparent',
                    borderLeft: selectedSlug === skill.slug ? '3px solid var(--primary)' : '3px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {skill.displayName}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {skill.slug} · v{skill.version}
                      </p>
                      {skill.industries.length > 0 && (
                        <p style={{ fontSize: 10, color: 'var(--muted)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {skill.industries.slice(0, 3).join(', ')}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDeleteSkill(skill.slug); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12, padding: '2px 4px', flexShrink: 0 }}
                      title="Delete skill"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Design Skills ({designSkills.length})
              </div>
              {designSkills.length === 0 && !designSkillsLoading && (
                <p style={{ padding: 16, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>No design skills yet</p>
              )}
              {designSkills.map((ds) => (
                <div
                  key={ds.slug}
                  onClick={() => void selectDesignSkill(ds.slug)}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    background: selectedDSSlug === ds.slug ? 'var(--primary-soft, rgba(0,0,0,0.06))' : 'transparent',
                    borderLeft: selectedDSSlug === ds.slug ? '3px solid var(--primary)' : '3px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: ds.colorPalette.primary, flexShrink: 0 }} />
                        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ds.displayName}
                        </p>
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                        {ds.aestheticTone} · {ds.themeClass}
                      </p>
                    </div>
                    <button
                      onClick={async (e) => { e.stopPropagation(); if (!apiKey || !confirm(`Delete design skill "${ds.slug}"?`)) return; await deleteDesignSkillApi(apiKey, ds.slug); if (selectedDSSlug === ds.slug) { setSelectedDSSlug(null); setDraftDS({}); } await loadDesignSkillList(); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12, padding: '2px 4px', flexShrink: 0 }}
                      title="Delete design skill"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Mobile backdrop for skill list panel */}
      {listPanelOpen && (
        <div className="skills-panel-backdrop" onClick={() => setListPanelOpen(false)} />
      )}

      {/* ── New skill modal ── */}
      {showNewModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 24,
            width: 360,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>New Skill</h2>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Skill Name</label>
            <input
              ref={newInputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); if (e.key === 'Escape') setShowNewModal(false); }}
              placeholder="Fintech SaaS Proposals"
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1px solid var(--border)', borderRadius: 6,
                padding: '8px 10px', fontSize: 13,
                background: 'var(--bg)', color: 'var(--text)',
                outline: 'none', marginBottom: 6,
              }}
            />
            {newName && (
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
                Slug: <code>{slugify(newName)}</code>
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={() => { setShowNewModal(false); setNewName(''); }}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer', color: 'var(--text)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                style={{
                  background: 'var(--primary)', color: '#fff', border: 'none',
                  borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 500,
                  cursor: creating || !newName.trim() ? 'not-allowed' : 'pointer',
                  opacity: creating || !newName.trim() ? 0.7 : 1,
                }}
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
