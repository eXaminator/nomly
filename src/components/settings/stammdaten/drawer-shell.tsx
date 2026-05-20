"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export type DrawerShellProps = {
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
};

export function DrawerShell({
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
}: DrawerShellProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-[var(--color-card)] shadow-2xl",
            "sm:max-w-[520px]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
            "duration-200",
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
            <div className="flex flex-col">
              <span className="text-xs uppercase tracking-wider text-[var(--color-muted-fg)]">
                {mode === "edit" ? "Bearbeiten" : "Neu anlegen"}
              </span>
              <h2 className="text-lg font-semibold leading-tight">{title}</h2>
            </div>
            <div className="flex items-center gap-1">
              {mode === "edit" && onDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onDelete}
                  aria-label="Löschen"
                  title="Löschen"
                  className="text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger),transparent_88%)]"
                >
                  <Trash2 />
                </Button>
              )}
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Schließen">
                  <X />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {error && (
            <div className="border-t border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger),transparent_88%)] px-5 py-2 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Abbrechen
            </Button>
            <Button
              onClick={onSave}
              disabled={saveDisabled || saving}
              type="submit"
            >
              {saving ? "Speichert…" : saveLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
