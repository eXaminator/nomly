import { PlannerSettingsForm } from "@/components/settings/planner-settings-form";
import { getPlannerSettings } from "@/lib/settings/planner";

export const dynamic = "force-dynamic";

export const metadata = { title: "Planer" };

export default function PlannerSettingsPage() {
  const settings = getPlannerSettings();
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Planer</h1>
        <p className="text-[var(--color-muted-fg)]">
          Wie viele Tage angezeigt werden und auf welchen Wochentag „Heute“
          den sichtbaren Bereich setzt.
        </p>
      </div>
      <div className="mt-6 max-w-lg">
        <PlannerSettingsForm initial={settings} />
      </div>
    </>
  );
}
