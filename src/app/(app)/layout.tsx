import { RegisterSW } from "@/components/pwa/register-sw";
import { PullToRefresh } from "@/components/pwa/pull-to-refresh";
import { RequestGuard } from "@/components/auth/request-guard";
import { AppShell } from "@/components/layout/app-shell";

/**
 * Layout for the main application. Carries the nav chrome and PWA helpers.
 * Routes outside this group (e.g. `/embed/**`) inherit only the minimal root
 * layout, so the Home Assistant recipe iframe renders without nav.
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <RequestGuard />
      <RegisterSW />
      <PullToRefresh />
      <AppShell>{children}</AppShell>
    </>
  );
}
