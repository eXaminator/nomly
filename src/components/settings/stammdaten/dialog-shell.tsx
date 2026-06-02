"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/cn";

export type DialogShellProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  mode: "edit" | "create";
  children: React.ReactNode;
  /** Called when user clicks the "Löschen" button (edit mode only). */
  onDelete?: () => void;
  /** Footer right-aligned save button label override. */
  saveLabel?: string;
  onSave: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  error?: string | null;
  /** Pin the dialog to a tall fixed height on desktop so content-height
   *  changes (e.g. switching tabs) scroll the body instead of resizing the
   *  whole dialog. Leave off for short single-section forms. */
  fillHeight?: boolean;
};

/**
 * Shared shell for the Stammdaten / article edit forms. A centered modal
 * dialog (fullscreen on mobile) with a header, a scrollable body holding the
 * form, and a sticky footer with the save/cancel/delete actions.
 *
 * Backdrop clicks are intentionally inert — these forms hold unsaved input, so
 * dismissing must be deliberate (Abbrechen, the ✕, or Escape). This is set here
 * rather than on the shared DialogContent so the app's other dialogs keep their
 * normal click-outside-to-close behaviour.
 */
export function DialogShell({
  open,
  onClose,
  title,
  mode,
  children,
  onDelete,
  saveLabel = "Speichern",
  onSave,
  saving,
  saveDisabled,
  error,
  fillHeight,
}: DialogShellProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent
        className={cn("sm:max-w-2xl", fillHeight && "sm:h-[85vh]")}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="pr-10">
          <span className="text-xs uppercase tracking-wider text-[var(--color-muted-fg)]">
            {mode === "edit" ? "Bearbeiten" : "Neu anlegen"}
          </span>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <DialogBody>{children}</DialogBody>

        {error && (
          <div className="border-t border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger),transparent_88%)] px-6 py-2 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <DialogFooter>
          {mode === "edit" && onDelete ? (
            <Button
              variant="ghost"
              onClick={onDelete}
              className="text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger),transparent_88%)] sm:mr-auto"
            >
              <Trash2 className="size-4" /> Löschen
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={onSave} disabled={saveDisabled || saving} type="submit">
            {saving ? "Speichert…" : saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
