import { NextRequest, NextResponse } from "next/server";

// GET /api/dfi/company?name=<query>
// Søger efter produktionsselskaber i DFI
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ companies: [] });

  const username = process.env.DFI_API_USERNAME;
  const password = process.env.DFI_API_PASSWORD;
  if (!username || !password) {
    return NextResponse.json({ error: "DFI API-legitimationsoplysninger mangler" }, { status: 500 });
  }

  const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  try {
    const res = await fetch(
      `https://data.dfi.dk/v1/company?Name=${encodeURIComponent(name)}`,
      {
        headers: { Authorization: authHeader, Accept: "application/json", "Accept-Language": "da-DK" },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return NextResponse.json({ companies: [] });
    const data = await res.json();
    const companies = (data.CompanyList ?? []).map((c: any) => ({
      id: c.Id,
      name: c.Name ?? c.CompanyName ?? "",
    }));
    return NextResponse.json({ companies });
  } catch {
    return NextResponse.json({ companies: [] });
  }
}
