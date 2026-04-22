'use client';

import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';
import {
  useExecutionStats,
  useProposalStats,
  useTemplateCount,
  useKnowledgeStats,
  useRecentActivity,
} from '@/lib/use-dashboard-stats';
import { StatCard } from '@/components/dashboard/StatCard';
import { ActivityTimeline } from '@/components/dashboard/ActivityTimeline';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { KnowledgeStats } from '@/components/dashboard/KnowledgeStats';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';

export default function DashboardPage() {
  const { apiKey } = useAuth();
  const { namespaces, isLoading: nsLoading } = useNamespace();

  const execStats = useExecutionStats();
  const proposalStats = useProposalStats(apiKey);
  const templateCount = useTemplateCount(apiKey);
  const knowledgeStats = useKnowledgeStats(apiKey);
  const { items: activityItems, loading: activityLoading } = useRecentActivity(apiKey);

  return (
    <PageContainer>
      <PageHeader title="Dashboard" subtitle="AI document processing overview" />

      {/* Stat cards */}
      <div className="dash-stat-grid">
        <StatCard
          icon="⚡"
          label="Active Executions"
          value={execStats.activeExecutions}
          trend="Live"
          accent="blue"
          loading={execStats.loading}
        />
        <StatCard
          icon="⬆"
          label="Ingestion Jobs"
          value={execStats.ingestionJobs}
          accent="green"
          loading={execStats.loading}
        />
        <StatCard
          icon="◧"
          label="Proposals this week"
          value={proposalStats.last7Days}
          trend={`${proposalStats.total} total`}
          accent="purple"
          loading={proposalStats.loading}
        />
        <StatCard
          icon="☰"
          label="Templates"
          value={templateCount.count}
          accent="orange"
          loading={templateCount.loading}
        />
      </div>

      {/* Main content area */}
      <div className="dash-main-grid">
        {/* Left column */}
        <div className="dash-col-main">
          <ActivityTimeline items={activityItems} loading={activityLoading} />
        </div>

        {/* Right column */}
        <div className="dash-col-side">
          <QuickActions />
          <KnowledgeStats stats={knowledgeStats} />

          {/* Namespace summary */}
          <div className="dash-ns-card card">
            <h3 className="dash-ns-title">Projects</h3>
            {nsLoading ? (
              <span className="muted">Loading…</span>
            ) : namespaces.length === 0 ? (
              <span className="muted">No namespaces configured</span>
            ) : (
              <ul className="dash-ns-list">
                {namespaces.map((ns) => (
                  <li key={ns} className="dash-ns-item">
                    <span className="dash-ns-dot" />
                    {ns}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
