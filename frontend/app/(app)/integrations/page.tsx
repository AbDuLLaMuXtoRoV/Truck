"use client";

import { Suspense } from "react";
import { IntegrationsView } from "@/components/crm/Integrations";

export default function IntegrationsPage() {
  return (
    <Suspense fallback={null}>
      <IntegrationsView />
    </Suspense>
  );
}
