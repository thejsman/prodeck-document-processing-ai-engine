'use client';

import type { PricingDefaultsApi, PricingTierApi } from '@/lib/api';
import { AIAssistBlock } from './AIAssistBlock';

interface PricingTabProps {
  pricing: PricingDefaultsApi | undefined;
  onChange: (pricing: PricingDefaultsApi | undefined) => void;
  onAIAssist: (instruction: string) => Promise<void>;
}

const DEFAULT_PRICING: PricingDefaultsApi = {
  model: 'tiered',
  currency: 'USD',
  rates: {},
  tiers: [],
  discounts: [],
};

function fieldStyle(): React.CSSProperties {
  return {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '5px 8px',
    color: 'var(--text)',
    fontSize: 12,
    boxSizing: 'border-box',
    outline: 'none',
    fontFamily: 'inherit',
  };
}

function TierCard({
  tier,
  index,
  onUpdate,
  onDelete,
}: {
  tier: PricingTierApi;
  index: number;
  onUpdate: (t: PricingTierApi) => void;
  onDelete: () => void;
}) {
  const [featInput, setFeatInput] = useState('');
  const upd = (patch: Partial<PricingTierApi>) => onUpdate({ ...tier, ...patch });

  const addFeature = () => {
    const trimmed = featInput.trim();
    if (!trimmed) return;
    upd({ features: [...(tier.features ?? []), trimmed] });
    setFeatInput('');
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 10, background: 'var(--panel)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Tier {index + 1}: {tier.name || <span style={{ fontStyle: 'italic', fontWeight: 400, color: 'var(--muted)' }}>Unnamed</span>}</span>
        <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger, #e53e3e)', fontSize: 13 }}>Remove</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Tier Name</label>
          <input value={tier.name} onChange={(e) => upd({ name: e.target.value })} placeholder="MVP" style={{ ...fieldStyle(), width: '100%' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Price Range</label>
          <input value={tier.priceRange ?? ''} onChange={(e) => upd({ priceRange: e.target.value || undefined })} placeholder="$50k – $80k" style={{ ...fieldStyle(), width: '100%' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Duration</label>
          <input value={tier.duration ?? ''} onChange={(e) => upd({ duration: e.target.value || undefined })} placeholder="8–12 weeks" style={{ ...fieldStyle(), width: '100%' }} />
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Description</label>
        <textarea value={tier.description} onChange={(e) => upd({ description: e.target.value })} rows={2} placeholder="Core platform with essential features" style={{ ...fieldStyle(), width: '100%', resize: 'vertical' }} />
      </div>

      <div>
        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Features</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 5 }}>
          {(tier.features ?? []).map((f, fi) => (
            <span key={fi} style={{ background: 'var(--primary)', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
              {f}
              <button onClick={() => upd({ features: tier.features.filter((_, i) => i !== fi) })} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 11 }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={featInput} onChange={(e) => setFeatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFeature(); } }} placeholder="Add feature + Enter" style={{ ...fieldStyle(), flex: 1 }} />
          <button onClick={addFeature} style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>+ Add</button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';

export function PricingTab({ pricing, onChange, onAIAssist }: PricingTabProps) {
  const p = pricing ?? DEFAULT_PRICING;
  const upd = (patch: Partial<PricingDefaultsApi>) => onChange({ ...p, ...patch });

  const [rateRole, setRateRole] = useState('');
  const [rateVal, setRateVal] = useState('');
  const [discountInput, setDiscountInput] = useState('');

  const addRate = () => {
    const role = rateRole.trim();
    const val = Number(rateVal);
    if (!role || !val) return;
    upd({ rates: { ...(p.rates ?? {}), [role]: val } });
    setRateRole('');
    setRateVal('');
  };

  const removeRate = (role: string) => {
    const { [role]: _, ...rest } = p.rates ?? {};
    upd({ rates: rest });
  };

  const addTier = () => {
    upd({ tiers: [...(p.tiers ?? []), { name: '', description: '', features: [] }] });
  };

  const updateTier = (index: number, tier: PricingTierApi) => {
    const next = [...(p.tiers ?? [])];
    next[index] = tier;
    upd({ tiers: next });
  };

  const deleteTier = (index: number) => {
    upd({ tiers: (p.tiers ?? []).filter((_, i) => i !== index) });
  };

  const addDiscount = () => {
    const trimmed = discountInput.trim();
    if (!trimmed) return;
    upd({ discounts: [...(p.discounts ?? []), trimmed] });
    setDiscountInput('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>
        These defaults pre-fill pricing when generating proposals. They can be overridden per-proposal.
      </p>

      {/* Model + Currency */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 20, alignItems: 'start' }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Model</label>
          {(['hourly', 'fixed', 'tiered', 'retainer'] as const).map((model) => (
            <label key={model} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 5, cursor: 'pointer' }}>
              <input type="radio" checked={p.model === model} onChange={() => upd({ model })} />
              {model.charAt(0).toUpperCase() + model.slice(1)}
            </label>
          ))}
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Currency</label>
          <input
            value={p.currency}
            onChange={(e) => upd({ currency: e.target.value.toUpperCase().slice(0, 3) })}
            placeholder="USD"
            style={{ ...fieldStyle(), width: 80 }}
          />
        </div>
      </div>

      {/* Rates */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rates /hr</label>
        {Object.entries(p.rates ?? {}).map(([role, rate]) => (
          <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 13, minWidth: 100 }}>{role}</span>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>${rate}/hr</span>
            <button onClick={() => removeRate(role)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger, #e53e3e)', fontSize: 12 }}>Remove</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={rateRole} onChange={(e) => setRateRole(e.target.value)} placeholder="Role (e.g. Senior)" style={{ ...fieldStyle(), width: 140 }} />
          <input type="number" value={rateVal} onChange={(e) => setRateVal(e.target.value)} placeholder="Rate" style={{ ...fieldStyle(), width: 80 }} />
          <button onClick={addRate} style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>+ Role</button>
        </div>
      </div>

      {/* Tiers */}
      {(p.model === 'tiered') && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pricing Tiers</label>
            <button onClick={addTier} style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>+ Tier</button>
          </div>
          {(p.tiers ?? []).map((tier, i) => (
            <TierCard key={i} tier={tier} index={i} onUpdate={(t) => updateTier(i, t)} onDelete={() => deleteTier(i)} />
          ))}
        </div>
      )}

      {/* Discounts */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Discounts</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
          {(p.discounts ?? []).map((d, di) => (
            <span key={di} style={{ background: 'var(--primary)', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
              {d}
              <button onClick={() => upd({ discounts: (p.discounts ?? []).filter((_, i) => i !== di) })} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0 }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDiscount(); } }} placeholder="10% for annual commitment" style={{ ...fieldStyle(), flex: 1 }} />
          <button onClick={addDiscount} style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>+ Add</button>
        </div>
      </div>

      <AIAssistBlock placeholder={`e.g. "Add a fourth tier for long-term retainer clients"`} onApply={onAIAssist} />
    </div>
  );
}
