'use client';

import Link from 'next/link';
import type { ActivityItem } from '@/lib/use-dashboard-stats';

const TYPE_DOT: Record<ActivityItem['type'], string> = {
  proposal:  'dot--blue',
  ingestion: 'dot--green',
  microsite: 'dot--purple',
  agent:     'dot--orange',
};

interface Props {
  items: ActivityItem[];
  loading?: boolean;
}

const SKELETON_COUNT = 5;

export function ActivityTimeline({ items, loading = false }: Props) {
  return (
    <div className="activity-timeline">
      <h3 className="activity-timeline-title">Recent Activity</h3>
      {loading ? (
        <ul className="activity-list">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <li key={i} className="activity-item activity-item--skeleton" style={{ '--item-index': i } as React.CSSProperties}>
              <span className="activity-dot dot--skeleton" />
              <div className="activity-text">
                <span className="activity-skel activity-skel--label" />
                <span className="activity-skel activity-skel--detail" />
              </div>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="activity-empty">No recent activity</p>
      ) : (
        <ul className="activity-list">
          {items.map((item, i) => (
            <li
              key={item.id}
              className="activity-item"
              style={{ '--item-index': i } as React.CSSProperties}
            >
              <span className={`activity-dot ${TYPE_DOT[item.type] ?? 'dot--blue'}`} />
              <div className="activity-text">
                <span className="activity-label">
                  {item.href ? <Link href={item.href}>{item.label}</Link> : item.label}
                </span>
                <span className="activity-detail">{item.detail}</span>
              </div>
              <span className="activity-ts">{item.timestamp}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
