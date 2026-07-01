'use client';

import { Suspense } from 'react';
import { ArtifactsPage } from '@/components/ArtifactsPage';

export default function ArtifactsRoute() {
  return (
    <Suspense>
      <ArtifactsPage />
    </Suspense>
  );
}
