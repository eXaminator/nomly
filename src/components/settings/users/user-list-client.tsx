"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type UserItem = { id: number; name: string; lastLoginAt: number };

function formatLastLogin(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Settings list of household users (auto-created from OIDC logins). Shows name +
 * last login and lets you remove a user — which cascades their favorites. The
 * row drops out optimistically; the server view re-renders on refresh.
 */
export function UserListClient({ initialUsers }: { initialUsers: UserItem[] }) {
  const router = useRouter();
  const [users, setUsers] = React.useState(initialUsers);
  const [confirmId, setConfirmId] = React.useState<number | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);

  React.useEffect(() => setUsers(initialUsers), [initialUsers]);

  async function remove(id: number) {
    setBusyId(id);
    const prev = users;
    setUsers((u) => u.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/v1/users/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status}`);
      router.refresh();
    } catch {
      setUsers(prev); // revert on failure
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  if (users.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted-fg)]">
        Noch keine Benutzer — sie erscheinen nach dem ersten Login.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)]">
      {users.map((u) => (
        <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-medium text-[var(--color-fg)]">{u.name}</div>
            <div className="text-xs text-[var(--color-muted-fg)]">
              Zuletzt angemeldet: {formatLastLogin(u.lastLoginAt)}
            </div>
          </div>
          {confirmId === u.id ? (
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmId(null)}
                disabled={busyId === u.id}
              >
                Abbrechen
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => remove(u.id)}
                disabled={busyId === u.id}
              >
                Entfernen
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setConfirmId(u.id)}
              aria-label={`${u.name} entfernen`}
              title="Benutzer entfernen"
              className="shrink-0"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
