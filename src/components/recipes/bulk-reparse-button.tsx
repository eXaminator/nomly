"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BulkReparseDialog } from "./bulk-reparse-dialog";

/** Settings entry that opens the bulk re-parse review modal. */
export function BulkReparseButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RefreshCw className="size-4" />
        Alle Rezepte neu parsen
      </Button>
      <BulkReparseDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
