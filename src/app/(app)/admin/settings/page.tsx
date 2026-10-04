import { pageContext } from "@/lib/dal/context";
import { getAdminSettings, getAdminSettingsExtras } from "@/lib/dal/admin";
import { getDataHealth } from "@/lib/dal/imports";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { PageHeader, StatusBadge } from "@/components/ui";
import { SettingsForm } from "@/components/admin/settings-form";

export const metadata = { title: "Paramètres — People Analytics AJIR" };

export default async function SettingsPage() {
  const ctx = await pageContext(["ADMIN"]);
  const settings = getAdminSettings(ctx);
  const extras = getAdminSettingsExtras(ctx);
  // Agrégats sans donnée nominative (déjà visibles par l'administrateur dans Santé des données) : effet concret des réglages
  const health = getDataHealth(ctx);
  const run = health.scoring.currentRun;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Paramètres"
        badge={
          <StatusBadge tone="info" dot={false}>
            Effet au prochain calcul ou import
          </StatusBadge>
        }
      />
      <SettingsForm
        fields={settings.map((s) => ({
          key: s.key,
          value: s.value,
          defaultValue: DEFAULT_SETTINGS[s.key] ?? null,
          min: s.min,
          max: s.max,
          step: s.step,
          int: s.int,
          updatedAt: s.updatedAt,
          updatedBy: s.updatedBy,
        }))}
        context={{ nScored: run?.nScored ?? null, asOf: run?.asOf ?? null, lastQuality: health.lastImport?.qualityScore ?? null }}
        smig={extras.smig}
        budgets={extras.budgets}
      />
    </>
  );
}
