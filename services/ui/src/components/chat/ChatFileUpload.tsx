'use client';

import { CheckCircle, FileText } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';

export interface ChunkProgress {
  stage: string;
  processed?: number;
  total?: number;
}

export interface ChatFileUploadProps {
  fileName: string;
  fileSize: number;
  progress: number;
  status: 'uploading' | 'processing' | 'done' | 'error';
  stage?: string;
  chunkProgress?: ChunkProgress;
  errorMessage?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PROCESSING_STEPS = [
  { key: 'read', label: 'Reading document' },
  { key: 'extract', label: 'Extracting information' },
  { key: 'index', label: 'Building search index' },
] as const;

function getActiveStepIndex(stage?: string, chunkStage?: string): number {
  const s = (chunkStage ?? stage ?? '').toLowerCase();
  if (s.includes('chunk') || s.includes('embed') || s.includes('stor') || s.includes('index')) return 2;
  if (s.includes('excerpt') || s.includes('extract') || s.includes('detect')) return 1;
  return 0; // default → Reading document
}

export function ChatFileUpload({
  fileName,
  fileSize,
  progress,
  status,
  stage,
  chunkProgress,
  errorMessage,
}: ChatFileUploadProps) {
  // ── Done: collapsed pill ──────────────────────────────────────────
  if (status === 'done') {
    return (
      <div className="chat-file-upload chat-file-upload--done">
        <Icon icon={FileText} size="sm" className="chat-file-upload__icon chat-file-upload__icon--primary" />
        <span className="chat-file-upload__name chat-file-upload__name--inline">{fileName}</span>
        <span className="chat-file-upload__size">&middot;&nbsp;{formatSize(fileSize)}</span>
        <Icon icon={CheckCircle} size="sm" className="chat-file-upload__check-icon" />
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────
  if (status === 'error') {
    const errorLabel = errorMessage
      ? errorMessage.length > 80 ? errorMessage.slice(0, 80) + '…' : errorMessage
      : 'Upload failed';
    return (
      <div className="chat-file-upload">
        <div className="chat-file-upload__header">
          <Icon icon={FileText} size="sm" className="chat-file-upload__icon" />
          <span className="chat-file-upload__name">{fileName}</span>
          <span className="chat-file-upload__size">{formatSize(fileSize)}</span>
        </div>
        <div className="chat-file-upload__track">
          <div className="chat-file-upload__fill chat-file-upload__fill--error" style={{ width: '100%' }} />
        </div>
        <div className="chat-file-upload__status chat-file-upload__status--error">{errorLabel}</div>
      </div>
    );
  }

  // ── Uploading: progress bar + pending steps ───────────────────────
  if (status === 'uploading') {
    return (
      <div className="chat-file-upload">
        <div className="chat-file-upload__header">
          <Icon icon={FileText} size="sm" className="chat-file-upload__icon chat-file-upload__icon--primary" />
          <span className="chat-file-upload__name">{fileName}</span>
          <span className="chat-file-upload__size">{formatSize(fileSize)}</span>
        </div>
        <div className="chat-file-upload__track">
          <div className="chat-file-upload__fill" style={{ width: `${Math.max(progress, 4)}%` }} />
        </div>
        <div className="chat-file-upload__steps">
          <div className="chat-file-upload__step chat-file-upload__step--active">
            <span className="chat-file-upload__step-icon">
              <span className="chat-file-upload__step-spinner" />
            </span>
            <span>Uploading{progress > 0 && progress < 100 ? ` ${progress}%` : '…'}</span>
          </div>
          {PROCESSING_STEPS.map((step) => (
            <div key={step.key} className="chat-file-upload__step chat-file-upload__step--pending">
              <span className="chat-file-upload__step-icon">
                <span className="chat-file-upload__step-dot-pending" />
              </span>
              <span>{step.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Processing: step-by-step visualization ────────────────────────
  const activeIdx = getActiveStepIndex(stage, chunkProgress?.stage);
  const chunkPct = chunkProgress?.total
    ? Math.round(((chunkProgress.processed ?? 0) / chunkProgress.total) * 100)
    : null;

  return (
    <div className="chat-file-upload">
      <div className="chat-file-upload__header">
        <Icon icon={FileText} size="sm" className="chat-file-upload__icon chat-file-upload__icon--primary" />
        <span className="chat-file-upload__name">{fileName}</span>
        <span className="chat-file-upload__size">{formatSize(fileSize)}</span>
      </div>
      <div className="chat-file-upload__steps">
        {/* Upload step is always complete by the time we reach processing */}
        <div className="chat-file-upload__step chat-file-upload__step--done">
          <span className="chat-file-upload__step-icon">
            <Icon icon={CheckCircle} size="sm" className="chat-file-upload__step-check" />
          </span>
          <span>Uploaded</span>
        </div>

        {PROCESSING_STEPS.map((step, idx) => {
          const isDone = idx < activeIdx;
          const isActive = idx === activeIdx;
          return (
            <div
              key={step.key}
              className={`chat-file-upload__step${isDone ? ' chat-file-upload__step--done' : isActive ? ' chat-file-upload__step--active' : ' chat-file-upload__step--pending'}`}
            >
              <span className="chat-file-upload__step-icon">
                {isDone ? (
                  <Icon icon={CheckCircle} size="sm" className="chat-file-upload__step-check" />
                ) : isActive ? (
                  <span className="chat-file-upload__step-spinner" />
                ) : (
                  <span className="chat-file-upload__step-dot-pending" />
                )}
              </span>
              <span>{step.label}{isActive ? '…' : ''}</span>
              {isActive && chunkPct !== null && (
                <span className="chat-file-upload__step-pct">{chunkPct}%</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Chunk progress bar (only visible when chunking/embedding with known total) */}
      {chunkProgress?.total != null && chunkProgress.total > 0 && chunkPct !== null && (
        <div className="chat-file-upload__chunk-progress">
          <div className="chat-file-upload__chunk-bar">
            <div className="chat-file-upload__chunk-fill" style={{ width: `${chunkPct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
