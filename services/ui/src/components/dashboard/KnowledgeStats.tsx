'use client';

import type { KnowledgeStats as KStats } from '@/lib/use-dashboard-stats';
import { Database, Layers } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';

interface Props {
  stats: KStats;
}

export function KnowledgeStats({ stats }: Props) {
  return (
    <div className="knowledge-stats">
      <h3 className="knowledge-stats-title">Knowledge Base</h3>
      <div className="knowledge-stats-grid">
        <div className="knowledge-stat-item">
          <span className="knowledge-stat-icon"><Icon icon={Database} size="md" /></span>
          <div className="knowledge-stat-body">
            <span className="knowledge-stat-value">
              {stats.loading ? <span className="stat-card-skeleton" /> : stats.docCount}
            </span>
            <span className="knowledge-stat-label">Documents</span>
          </div>
        </div>
        <div className="knowledge-stat-item">
          <span className="knowledge-stat-icon"><Icon icon={Layers} size="md" /></span>
          <div className="knowledge-stat-body">
            <span className="knowledge-stat-value">
              {stats.loading ? <span className="stat-card-skeleton" /> : stats.chunkCount}
            </span>
            <span className="knowledge-stat-label">Chunks indexed</span>
          </div>
        </div>
      </div>
    </div>
  );
}
