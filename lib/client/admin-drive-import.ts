export type AdminDriveImportRun = {
  id: string;
  status: "queued" | "discovering" | "processing" | "completed" | "partially_failed" | "failed" | "cancelled";
  discovered_count: number;
  imported_count: number;
  duplicate_count: number;
  failed_count: number;
  last_error: string | null;
};

export type AdminDriveImportStart = {
  runId: string;
  status: string;
  resumed: boolean;
};

const TERMINAL_STATUSES = new Set(["completed", "partially_failed", "failed", "cancelled"]);

async function responseJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      globalThis.clearTimeout(timeout);
      reject(new DOMException("Polling afbrudt", "AbortError"));
    };
    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function startAdminDriveImport(sourceId: string): Promise<AdminDriveImportStart> {
  const response = await fetch(`/api/admin/import-sources/${encodeURIComponent(sourceId)}/sync`, { method: "POST" });
  const json = await responseJson(response);
  if (!response.ok || typeof json.runId !== "string") {
    throw new Error(typeof json.error === "string" ? json.error : "Importen kunne ikke startes");
  }
  return {
    runId: json.runId,
    status: typeof json.status === "string" ? json.status : "queued",
    resumed: json.resumed === true,
  };
}

export async function waitForAdminDriveImport(
  sourceId: string,
  runId: string,
  options: { signal?: AbortSignal; attempts?: number; intervalMs?: number } = {},
): Promise<AdminDriveImportRun | null> {
  const attempts = options.attempts ?? 120;
  const intervalMs = options.intervalMs ?? 2_000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await delay(intervalMs, options.signal);
    const response = await fetch(`/api/admin/import-sources/${encodeURIComponent(sourceId)}/sync`, {
      cache: "no-store",
      signal: options.signal,
    });
    const json = await responseJson(response);
    if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "Importstatus kunne ikke hentes");
    const run = json.run as AdminDriveImportRun | null | undefined;
    if (!run || run.id !== runId) return null;
    if (TERMINAL_STATUSES.has(run.status)) return run;
  }
  return null;
}
