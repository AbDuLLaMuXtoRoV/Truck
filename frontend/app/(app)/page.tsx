"use client";

import { CrmDashboard } from "@/components/crm/Dashboard";
import { SimpleHome } from "@/components/simple/Homes";
import { useMode } from "@/lib/mode";

/** Home: agents start on their simple "My tasks"; supervisors and above on the CRM dashboard. */
export default function HomePage() {
  return useMode() === "simple" ? <SimpleHome /> : <CrmDashboard />;
}
