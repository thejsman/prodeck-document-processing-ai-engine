'use client';

import { FileText } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';

export interface ChatFileUploadProps {
  fileName: string;
  fileSize: number;
  progress: number;
  status: 'uploading' | 'processing' | 'done' | 'error';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_LABEL: Record<ChatFileUploadProps['status'], string> = {
  uploading:  'Uploading…',
  processing: 'Processing…',
  done:       'Ready',
  error:      'Upload failed',
};

export function ChatFileUpload({ fileName, fileSize, progress, status }: ChatFileUploadProps) {
  if (status === 'done') {
    return (
      <div className="chat-file-upload chat-file-upload--done">
        <Icon icon={FileText} size="sm" className="chat-file-upload__icon chat-file-upload__icon--primary" />
        <span className="chat-file-upload__name chat-file-upload__name--inline">{fileName}</span>
        <span className="chat-file-upload__size">&middot;&nbsp;{formatSize(fileSize)}</span>
        <span className="chat-file-upload__check">&#10003;</span>
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
        {STATUS_LABEL[status]}
      </div>
    </div>
  );
}
