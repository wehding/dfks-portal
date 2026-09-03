import "server-only";
import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/service";

export type CachedBroadcaster = {
  name: string;
  logo_path: string | null;
};

export const getCachedBroadcasters = cache(async (): Promise<CachedBroadcaster[]> => {
  const db = createServiceClient();
  const res = await db.from("broadcasters").select("name,logo_path").order("name", { ascending: true });
  return res.data ?? [];
});
