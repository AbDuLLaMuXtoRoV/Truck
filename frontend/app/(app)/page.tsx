"use client";

import { AdvancedOverview } from "@/components/AdvancedOverview";
import { SimpleHome } from "@/components/simple/Homes";
import { useMode } from "@/lib/mode";

/** Home: the role's simple page by default, the full overview in advanced mode. */
export default function HomePage() {
  return useMode() === "simple" ? <SimpleHome /> : <AdvancedOverview />;
}
