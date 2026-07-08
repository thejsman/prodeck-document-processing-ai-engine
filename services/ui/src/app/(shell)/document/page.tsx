"use client";

import { Suspense } from "react";
import { DocumentViewerPage } from "@/components/DocumentViewerPage";

export default function DocumentRoute() {
  return (
    <Suspense>
      <DocumentViewerPage />
    </Suspense>
  );
}
