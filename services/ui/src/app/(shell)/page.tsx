'use client';

import { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { CreateNamespaceModal } from '@/components/shell/CreateNamespaceModal';

export default function WelcomePage() {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          maxWidth: 520,
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: 20,
            background: 'linear-gradient(145deg, #6366f1 0%, #5b8cff 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 28,
            boxShadow: '0 8px 32px rgba(91, 140, 255, 0.2)',
          }}
        >
          <LayoutGrid size={34} color="#fff" strokeWidth={1.5} />
        </div>

        {/* Heading */}
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: 'var(--text)',
            margin: '0 0 16px',
            lineHeight: 1.3,
            letterSpacing: '-0.02em',
          }}
        >
          Stack the deck.
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: 14,
            fontWeight: 400,
            color: 'var(--muted)',
            lineHeight: 1.75,
            margin: '0 0 32px',
            maxWidth: 440,
          }}
        >
          Create a namespace to get started. Each one is an isolated workspace where you can ingest documents, generate proposals, and chat with your knowledge base.
        </p>

        {/* CTA */}
        <button
          onClick={() => setShowCreate(true)}
          style={{
            padding: '9px 20px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--primary)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 400,
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
        >
          Create namespace
        </button>
      </div>

      {showCreate && <CreateNamespaceModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
