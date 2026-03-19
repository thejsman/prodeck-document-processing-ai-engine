'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/lib/auth-context';
import { useSSE } from '@/lib/use-sse';
import { NamespaceSelector } from './NamespaceSelector';

export function StreamingQuery() {
  const { apiKey } = useAuth();
  const [question, setQuestion] = useState('');
  const [namespace, setNamespace] = useState('');
  const { chunks, isStreaming, error, startStream, reset } = useSSE(
    apiKey,
    '/api/query',
  );

  function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || isStreaming) return;
    startStream({ question: question.trim(), namespace: namespace || 'default' });
  }

  return (
    <details className="streaming-section">
      <summary>Streaming Query Preview</summary>

      <NamespaceSelector value={namespace} onChange={setNamespace} />

      <form className="streaming-row" onSubmit={handleAsk}>
        <input
          className="input"
          type="text"
          placeholder="Ask a question..."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={isStreaming}
        />
        <button type="submit" className="btn" disabled={isStreaming || !question.trim()}>
          {isStreaming ? <span className="spinner" /> : 'Ask'}
        </button>
        {chunks && (
          <button type="button" className="btn btn-sm" onClick={reset}>
            Clear
          </button>
        )}
      </form>

      {error && <p className="error">{error}</p>}

      {chunks && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="prose">
            <ReactMarkdown>{chunks}</ReactMarkdown>
          </div>
          {isStreaming && (
            <p className="loading" style={{ marginTop: 8 }}>
              Streaming...
            </p>
          )}
        </div>
      )}
    </details>
  );
}
