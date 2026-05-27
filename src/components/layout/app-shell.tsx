import Link from "next/link";
import { getSession } from "@/lib/server-session";
import { TopNav } from "./top-nav";
import { BottomNav } from "./bottom-nav";
import { UserMenu, UserMenuFallback } from "./user-menu";
import { ConnectivityStatus } from "./connectivity-status";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const name = session.name ?? "";
  const email = session.email;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg)]/80">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="text-lg font-semibold tracking-tight text-[var(--color-fg)]"
            >
              nomly
            </Link>
            <TopNav />
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <ConnectivityStatus />
            {name ? <UserMenu name={name} email={email} /> : <UserMenuFallback />}
          </div>
        </div>
      </header>
      <main className="flex-1 pb-24 md:pb-12">
        <div className="mx-auto max-w-screen-2xl px-4 py-6 md:px-6">{children}</div>
      </main>
      <BottomNav />
    </div>
  );
}
