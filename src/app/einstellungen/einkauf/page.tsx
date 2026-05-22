import { AppShell } from "@/components/layout/app-shell";
import { ShoppingSettingsForm } from "@/components/settings/shopping-settings-form";
import { getShoppingSettings } from "@/lib/shopping/settings";

export const dynamic = "force-dynamic";

export default function ShoppingSettingsPage() {
  const settings = getShoppingSettings();
  return (
    <AppShell>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Einkauf</h1>
        <p className="text-[var(--color-muted-fg)]">
          Voreinstellungen für die Einkaufsliste.
        </p>
      </div>
      <div className="mt-6 max-w-lg">
        <ShoppingSettingsForm initial={settings} />
      </div>
    </AppShell>
  );
}
