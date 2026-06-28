import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type BroadcasterSeed = {
  name: string;
  slug: string;
  sourceUrls: string[];
};

const LOGO_DIR = path.join(process.cwd(), "public", "assets", "logos");

const BROADCASTERS: BroadcasterSeed[] = [
  { name: "DR1", slug: "dr1", sourceUrls: ["https://commons.wikimedia.org/wiki/Special:FilePath/DR1-Logo.svg"] },
  { name: "DR2", slug: "dr2", sourceUrls: ["https://commons.wikimedia.org/wiki/Special:FilePath/DR2-Logo_(D%C3%A4nemark).svg"] },
  { name: "TV 2", slug: "tv-2", sourceUrls: ["https://logo.clearbit.com/tv2.dk", "https://www.google.com/s2/favicons?domain=tv2.dk&sz=128"] },
  { name: "TV 3", slug: "tv-3", sourceUrls: ["https://commons.wikimedia.org/wiki/Special:FilePath/TV3_logo.svg"] },
  { name: "SVT", slug: "svt", sourceUrls: ["https://logo.clearbit.com/svt.se", "https://www.google.com/s2/favicons?domain=svt.se&sz=128"] },
  { name: "NRK", slug: "nrk", sourceUrls: ["https://logo.clearbit.com/nrk.no", "https://www.google.com/s2/favicons?domain=nrk.no&sz=128"] },
  { name: "ARD", slug: "ard", sourceUrls: ["https://logo.clearbit.com/ard.de", "https://www.google.com/s2/favicons?domain=ard.de&sz=128"] },
  { name: "ZDF", slug: "zdf", sourceUrls: ["https://logo.clearbit.com/zdf.de", "https://www.google.com/s2/favicons?domain=zdf.de&sz=128"] },
  { name: "HBO", slug: "hbo", sourceUrls: ["https://logo.clearbit.com/hbo.com", "https://www.google.com/s2/favicons?domain=hbo.com&sz=128"] },
  { name: "Netflix", slug: "netflix", sourceUrls: ["https://logo.clearbit.com/netflix.com", "https://www.google.com/s2/favicons?domain=netflix.com&sz=128"] },
  { name: "TV2 Play", slug: "tv2-play", sourceUrls: ["https://commons.wikimedia.org/wiki/Special:FilePath/TV_2_Play_Logo.png"] },
  { name: "Amazon Prime", slug: "amazon-prime", sourceUrls: ["https://logo.clearbit.com/primevideo.com", "https://www.google.com/s2/favicons?domain=primevideo.com&sz=128"] },
  { name: "DR Ramasjang", slug: "dr-ramasjang", sourceUrls: ["https://commons.wikimedia.org/wiki/Special:FilePath/DR_Ramasjang_Logo_2020.svg"] },
  { name: "TV 2 Charlie", slug: "tv-2-charlie", sourceUrls: ["https://commons.wikimedia.org/wiki/Special:FilePath/TV_2_Charlie_2023.svg"] },
  { name: "TV 2 News", slug: "tv-2-news", sourceUrls: ["https://commons.wikimedia.org/wiki/Special:FilePath/TV_2_News_2023.svg"] },
  { name: "TV3+", slug: "tv3-plus", sourceUrls: ["https://commons.wikimedia.org/wiki/Special:FilePath/TV3%2B_logo.svg"] },
  { name: "Kanal 4", slug: "kanal-4", sourceUrls: ["https://commons.wikimedia.org/wiki/Special:FilePath/Kanal_4_Logo_2024.svg"] },
  { name: "Kanal 5", slug: "kanal-5", sourceUrls: ["https://commons.wikimedia.org/wiki/Special:FilePath/Kanal_5_%26_TV5_Logo_2024.svg"] },
];

function readEnvFile() {
  return readFile(path.join(process.cwd(), ".env.local"), "utf8")
    .then(content => Object.fromEntries(
      content
        .split(/\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith("#") && line.includes("="))
        .map(line => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        })
    ));
}

function extensionFrom(contentType: string | null, sourceUrl: string) {
  if (contentType?.includes("svg")) return "svg";
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return "jpg";
  if (sourceUrl.toLowerCase().includes(".svg")) return "svg";
  return "png";
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(sourceUrl: string) {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(sourceUrl, {
      headers: {
        "user-agent": "DFKS Portal broadcaster logo seed script",
      },
    });
    lastResponse = response;
    if (response.status !== 429) return response;
    await sleep(1500 * (attempt + 1));
  }
  if (!lastResponse) throw new Error("Intet svar fra serveren");
  return lastResponse;
}

async function downloadLogo(broadcaster: BroadcasterSeed) {
  let lastError: unknown = null;

  for (const sourceUrl of broadcaster.sourceUrls) {
    try {
      const response = await fetchWithRetry(sourceUrl);

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type");
      const ext = extensionFrom(contentType, sourceUrl);
      const fileName = `${broadcaster.slug}.${ext}`;
      const publicPath = `/assets/logos/${fileName}`;
      const filePath = path.join(LOGO_DIR, fileName);
      const buffer = Buffer.from(await response.arrayBuffer());

      await writeFile(filePath, buffer);

      return {
        fileName,
        publicPath,
        contentType,
        sourceUrl,
        byteLength: buffer.byteLength,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`${broadcaster.name}: ${lastError instanceof Error ? lastError.message : "Kunne ikke hente logo"}`);
}

async function run() {
  const downloadOnly = process.argv.includes("--download-only");
  await mkdir(LOGO_DIR, { recursive: true });

  const downloaded = [];
  for (const broadcaster of BROADCASTERS) {
    const logo = await downloadLogo(broadcaster);
    downloaded.push({ broadcaster, logo });
    console.log(`✓ ${broadcaster.name} -> ${logo.publicPath} (${logo.byteLength} bytes)`);
    await sleep(250);
  }

  if (downloadOnly) return;

  const env = await readEnvFile();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Mangler NEXT_PUBLIC_SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY i .env.local");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  for (const { broadcaster, logo } of downloaded) {
    const { error } = await supabase
      .from("broadcasters")
      .upsert({
        org_id: null,
        name: broadcaster.name,
        slug: broadcaster.slug,
        logo_source_url: logo.sourceUrl,
        logo_path: logo.publicPath,
        content_type: logo.contentType,
        updated_at: new Date().toISOString(),
      }, { onConflict: "slug" });

    if (error) throw new Error(`${broadcaster.name}: ${error.message}`);
  }

  console.log(`Upsertede ${downloaded.length} broadcaster-logoer i databasen.`);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
