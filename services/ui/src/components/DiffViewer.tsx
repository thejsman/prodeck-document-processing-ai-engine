'use client';

import type { SectionDiff } from '@/lib/api';

interface Props {
  diffs: SectionDiff[];
  onClose: () => void;
}

const STATUS_LABELS: Record<SectionDiff['status'], string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  unchanged: 'Unchanged',
};

export function DiffViewer({ diffs, onClose }: Props) {
  return (
    <div className="diff-overlay" onClick={onClose}>
      <div className="diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diff-header">
          <h2>Version Comparison</h2>
          <button className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="diff-body">
          {diffs.length === 0 ? (
            <p className="muted">No sections to compare</p>
          ) : (
            diffs.map((diff) => (
              <div
                key={diff.title}
                className={`diff-section diff-${diff.status}`}
              >
                <div className="diff-section-header">
                  <span className="diff-section-title">{diff.title}</span>
                  <span className={`badge badge--diff-${diff.status}`}>
                    {STATUS_LABELS[diff.status]}
                  </span>
                </div>

                {diff.status === 'changed' && (
                  <div className="diff-content-pair">
                    <div className="diff-content-old">
                      <div className="diff-content-label">Previous</div>
                      <pre>{diff.oldContent}</pre>
                    </div>
                    <div className="diff-content-new">
                      <div className="diff-content-label">Current</div>
                      <pre>{diff.newContent}</pre>
                    </div>
                  </div>
                )}

                {diff.status === 'added' && diff.newContent && (
                  <div className="diff-content-single diff-content-new">
                    <pre>{diff.newContent}</pre>
                  </div>
                )}

                {diff.status === 'removed' && diff.oldContent && (
                  <div className="diff-content-single diff-content-old">
                    <pre>{diff.oldContent}</pre>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
