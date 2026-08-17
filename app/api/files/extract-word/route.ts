import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractWordText } from "@/lib/word-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WORD_FILE_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Ingen Word-fil modtaget" }, { status: 400 });
    if (file.size > MAX_WORD_FILE_BYTES) return NextResponse.json({ error: "Word-filen må højst fylde 25 MB" }, { status: 413 });

    const text = await extractWordText(Buffer.from(await file.arrayBuffer()), file.name);
    return NextResponse.json({ text });
  } catch (error) {
    console.error("[extract-word] Word-udtræk fejlede", error);
    console.error("[extract-word] failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Word-filen kunne ikke læses" }, { status: 422 });
  }
}
