'use client';

import { CheckCircle, FileText, Loader2 } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';

export interface ChatFileUploadProps {
  fileName: string;
  fileSize: number;
  progress: number;
  status: 'uploading' | 'processing' | 'done' | 'error';
  stage?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatFileUpload({ fileName, fileSize, progress, status, stage }: ChatFileUploadProps) {
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

  if (status === 'processing') {
    return (
      <div className="chat-file-upload">
        <div className="chat-file-upload__header">
          <Icon icon={FileText} size="sm" className="chat-file-upload__icon chat-file-upload__icon--primary" />
          <span className="chat-file-upload__name">{fileName}</span>
          <span className="chat-file-upload__size">{formatSize(fileSize)}</span>
        </div>
        <div className="chat-file-upload__stage-row">
          <Icon icon={Loader2} size="sm" className="chat-file-upload__spinner" />
          <span className="chat-file-upload__status">{stage ?? 'Processing…'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-file-upload">
      <div className="chat-file-upload__header">
        <Icon icon={FileText} size="sm" className="chat-file-upload__icon" />
        <span className="chat-file-upload__name">{fileName}</span>
        <span className="chat-file-upload__size">{formatSize(fileSize)}</span>
      </div>
      <div className="chat-file-upload__track">
        <div
          className={`chat-file-upload__fill${status === 'error' ? ' chat-file-upload__fill--error' : ''}`}
          style={{ width: status === 'error' ? '100%' : `${progress}%` }}
        />
      </div>
      <div className={`chat-file-upload__status${status === 'error' ? ' chat-file-upload__status--error' : ''}`}>
        {status === 'uploading' ? `Uploading… ${progress}%` : 'Upload failed'}
      </div>
    </div>
  );
}
