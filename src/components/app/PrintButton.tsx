"use client";

import { Button } from "@/components/ui";

/** Uses the browser's print dialog ("Save as PDF"). Server-side PDF generation is planned for Phase 3. */
export function PrintButton() {
  return <Button size="sm" onClick={() => window.print()}>Print / save as PDF</Button>;
}
