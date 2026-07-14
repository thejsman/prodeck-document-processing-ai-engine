'use client';

import { Suspense, useEffect } from 'react';
import { ProposalPage } from '@/components/ProposalPage';
import { transitionOverlay } from '@/components/system/TransitionOverlay';

export default function ProposalRoute() {
  // Claim the shell-level transition overlay shown when a proposal card is
  // tapped on /artifacts — the route swap is complete once this mounts, and
  // ProposalPage renders its own loading state from here on. Without this the
  // overlay strands until its safety timeout (nothing else on this route hides it).
  useEffect(() => {
    transitionOverlay.hide();
  }, []);

  return (
    <Suspense>
      <ProposalPage />
    </Suspense>
  );
}
