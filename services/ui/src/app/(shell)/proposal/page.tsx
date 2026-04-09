'use client';

import { Suspense } from 'react';
import { ProposalPage } from '@/components/ProposalPage';

export default function ProposalRoute() {
  return (
    <Suspense>
      <ProposalPage />
    </Suspense>
  );
}
