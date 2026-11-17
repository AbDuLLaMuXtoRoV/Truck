"use client";

import { AdvancedTaskPage } from "@/components/AdvancedTaskDetail";
import { SimpleTaskPage } from "@/components/simple/SimpleTaskPage";
import { useMode } from "@/lib/mode";

/** /tasks/{id} works in both modes (Telegram and notification links point here). */
export default function TaskPage() {
  return useMode() === "simple" ? <SimpleTaskPage /> : <AdvancedTaskPage />;
}
