'use client';

import { useState } from 'react';

interface Props {
  onSubmit: (key: string) => void;
}

export function ApiKeyGate({ onSubmit }: Props) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) {
      setError('API key is required');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/namespaces', {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (!res.ok) {
        setError('Invalid or missing API key');
        return;
      }
      onSubmit(trimmed);
    } catch {
      setError('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="gate">
      <form className="card" onSubmit={handleSubmit}>
        <h1>AI Engine</h1>
        <p>Enter your API key to connect</p>
        <input
          type="password"
          className="input"
          placeholder="Bearer API key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
          disabled={loading}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </div>
  );
}
