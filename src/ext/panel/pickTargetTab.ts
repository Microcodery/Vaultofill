export interface TabPickDeps {
  getTab: (tabId: number) => Promise<{ id?: number; url?: string } | undefined>;
  queryActiveTab: () => Promise<{ id?: number; url?: string } | undefined>;
}

export async function pickTargetTab(
  explicitTabId: number | undefined,
  deps: TabPickDeps,
): Promise<{ id: number; domain: string } | undefined> {
  const t = typeof explicitTabId === "number" ? await deps.getTab(explicitTabId) : await deps.queryActiveTab();
  if (t?.id === undefined) return undefined;
  const domain = t.url ? new URL(t.url).hostname : "";
  return { id: t.id, domain };
}
