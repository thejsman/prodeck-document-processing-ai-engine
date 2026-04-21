'use client';

interface Props {
  namespace: string;
  onSuggestion: (text: string) => void;
  /** Dynamic suggestions from namespace intelligence scan. When provided,
   *  these replace the static fallbacks and appear above the generic chips. */
  insights?: string[];
}

const STATIC_SUGGESTIONS = [
  'Generate a proposal from my documents',
  'Summarize the knowledge base',
  'Create a presentation microsite',
  'What documents are currently indexed?',
];

export function ChatEmptyState({ namespace, onSuggestion, insights }: Props) {
  const hasDynamicInsights = insights && insights.length > 0;

  return (
    <div className="chat-empty-state">
      <div className="chat-empty-icon">⌥</div>
      <h2 className="chat-empty-title">How can I help you today?</h2>
      <p className="chat-empty-sub">
        Ask questions about the <strong>{namespace || 'default'}</strong> namespace
        or trigger AI workflows.
      </p>

<div className="chat-empty-suggestions">
        {STATIC_SUGGESTIONS.map((s) => (
          <button
            key={s}
            className="chat-suggestion-chip"
            onClick={() => onSuggestion(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
