import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import { PluginActions, PluginInstallButton } from "@/components/forms/plugin-forms";
import { listPlugins } from "@/modules/plugins/service";
import { CORE_VERSION, PLUGIN_REGISTRY } from "@/modules/plugins/registry";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Plugins" };
export const dynamic = "force-dynamic";

export default async function PluginsPage() {
  const session = await requireSession();
  assertPermission(session, "plugin.manage");

  const plugins = await listPlugins(session.businessId);
  const installed = plugins.filter((plugin) => plugin.installed);
  const enabled = installed.filter((plugin) => plugin.status === "ENABLED");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plugins"
        description="Plugins in this build are explicitly registered extensions that ship with the application. The database stores which plugin you installed, its configuration and whether it is on — it never stores or runs code."
      />

      <Alert variant="info">
        <p className="font-medium">Nothing from the database is ever executed</p>
        <p className="text-sm">
          A plugin row can only reference a key that exists in the registry ({PLUGIN_REGISTRY.length} registered, core {CORE_VERSION}). Unknown keys are rejected at install
          time, compatibility ranges are checked against this build, and a plugin marked untrusted cannot be enabled at all — there is deliberately no upload-and-run path.
        </p>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-slate-500">Registered</p>
            <p className="text-2xl font-semibold">{plugins.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-slate-500">Installed</p>
            <p className="text-2xl font-semibold">{installed.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-slate-500">Enabled</p>
            <p className="text-2xl font-semibold">{enabled.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {plugins.map((plugin) => (
          <Card key={plugin.key}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {plugin.name}
                  <span className="text-sm font-normal text-slate-500">v{plugin.version}</span>
                  {plugin.trusted ? <Badge variant="success">trusted</Badge> : <Badge variant="danger">untrusted</Badge>}
                  <Badge variant={plugin.status === "ENABLED" ? "success" : plugin.status === "INCOMPATIBLE" ? "danger" : plugin.status === "DISABLED" ? "warning" : "neutral"}>
                    {plugin.status.toLowerCase()}
                  </Badge>
                </CardTitle>
                <p className="text-sm text-slate-600">{plugin.description}</p>
                <p className="text-xs text-slate-500">
                  {plugin.author} · {plugin.source}
                  {plugin.enabledAt ? ` · enabled ${formatDateTime(plugin.enabledAt)}` : ""}
                  {plugin.disabledAt && !plugin.enabledAt ? ` · disabled ${formatDateTime(plugin.disabledAt)}` : ""}
                </p>
              </div>
              <PluginInstallButton pluginKey={plugin.key} installed={plugin.installed} />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Capabilities</p>
                  <ul className="mt-1 space-y-1 text-sm text-slate-600">
                    {plugin.capabilities.map((capability) => (
                      <li key={capability}>{capability}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Permissions it uses</p>
                  <ul className="mt-1 space-y-1 font-mono text-xs text-slate-600">
                    {plugin.permissions.map((permission) => (
                      <li key={permission}>{permission}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <PluginActions
                pluginKey={plugin.key}
                installed={plugin.installed}
                enabled={plugin.status === "ENABLED"}
                configFields={Object.keys(((PLUGIN_REGISTRY.find((entry) => entry.key === plugin.key)?.configSchema ?? {}) as { properties?: Record<string, unknown> }).properties ?? {})}
                config={plugin.config}
                lastError={plugin.lastError}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
