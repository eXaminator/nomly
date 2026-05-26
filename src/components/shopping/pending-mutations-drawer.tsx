"use client";

import * as React from "react";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";
import { readPendingQueue } from "@/lib/shopping/offline/store";
import { kickSync } from "@/lib/shopping/offline/sync";
import type { OfflineMutation } from "@/lib/shopping/offline/db";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemNameById: Record<number, string>;
};

export function PendingMutationsDrawer({ open, onOpenChange, itemNameById }: Props) {
  const [entries, setEntries] = React.useState<OfflineMutation[]>([]);
  const [syncing, setSyncing] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const q = await readPendingQueue();
    setEntries(q);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await kickSync();
      await refresh();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 mt-24 flex flex-col rounded-t-[16px] bg-[var(--color-card)] p-4">
          <div className="mx-auto mb-4 h-1.5 w-12 flex-shrink-0 rounded-full bg-[var(--color-muted)]" />
          <Drawer.Title className="text-base font-semibold">Synchronisation</Drawer.Title>
          <Drawer.Description className="text-xs text-[var(--color-muted-fg)]">
            Diese Änderungen warten auf den Server.
          </Drawer.Description>

          {entries.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-muted-fg)]">Keine ausstehenden Änderungen.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {entries.map((e) => (
                <li
                  key={e.mutationId}
                  className="flex items-center justify-between rounded border border-[var(--color-border)] px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{itemNameById[e.itemId] ?? `Item #${e.itemId}`}</div>
                    <div className="text-xs text-[var(--color-muted-fg)]">
                      {e.type === "check" ? "abgehakt" : "wiederhergestellt"}
                      {e.attempts > 0 ? ` · ${e.attempts} Versuch${e.attempts === 1 ? "" : "e"}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Schließen</Button>
            <Button onClick={handleSyncNow} disabled={syncing || entries.length === 0}>
              {syncing ? "Synchronisiere…" : "Jetzt synchronisieren"}
            </Button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
