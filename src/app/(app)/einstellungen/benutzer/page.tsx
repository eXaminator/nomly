import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { UserListClient } from "@/components/settings/users/user-list-client";
import { listUsers } from "@/lib/users/service";

export const dynamic = "force-dynamic";

export const metadata = { title: "Benutzer" };

export default function UsersSettingsPage() {
  const users = listUsers();
  return (
    <>
      <div className="flex flex-col gap-2">
        <Link
          href="/einstellungen"
          className="inline-flex w-fit items-center gap-1 text-sm text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]"
        >
          <ChevronLeft className="size-4" />
          Einstellungen
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Benutzer</h1>
        <p className="text-[var(--color-muted-fg)]">
          Per Login automatisch angelegt. Entfernen löscht den Benutzer und seine
          Favoriten aus der lokalen Datenbank — beim nächsten Login wird er neu
          angelegt.
        </p>
      </div>
      <div className="mt-6">
        <UserListClient initialUsers={users} />
      </div>
    </>
  );
}
