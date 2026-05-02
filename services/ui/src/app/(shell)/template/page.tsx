'use client';

import { Suspense } from 'react';
import { TemplatePage } from '@/components/TemplatePage';

export default function TemplateRoute() {
  return (
    <Suspense>
      <TemplatePage />
    </Suspense>
  );
}
