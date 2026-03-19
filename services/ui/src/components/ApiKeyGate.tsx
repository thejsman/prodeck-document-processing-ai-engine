'use client';

import { useState } from 'react';

interface Props {
  onSubmit: (key: string) => void;
}

export function ApiKeyGate({ onSubmit }: Props) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) {
      setError('API key is required');
      return;
    }
    setError('');
    onSubmit(trimmed);
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
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn btn-primary">
          Connect
        </button>
      </form>
    </div>
  );
}
