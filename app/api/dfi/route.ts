import { NextRequest, NextResponse } from "next/server";

// GET /api/dfi?type=person|film|film_details&q=<query>&id=<dfi_id>
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type") || "film";
  const query = searchParams.get("q");
  const id = searchParams.get("id");

  const username = process.env.DFI_API_USERNAME;
  const password = process.env.DFI_API_PASSWORD;
  if (!username || !password) {
    return NextResponse.json({ error: "DFI API-legitimationsoplysninger mangler" }, { status: 500 });
  }

  const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  async function dfiGet(endpoint: string) {
    const res = await fetch(`https://data.dfi.dk${endpoint}`, {
      headers: { Authorization: authHeader, Accept: "application/json", "Accept-Language": "da-DK" },
    });
    if (!res.ok) throw new Error(`DFI API status ${res.status}`);
    return res.json();
  }

  try {
    if (type === "person" && query) {
      const parts = query.trim().split(/\s+/);
      const endpoint = parts.length > 1
        ? `/v1/person?FirstName=${encodeURIComponent(parts.slice(0, -1).join(" "))}&LastName=${encodeURIComponent(parts.at(-1)!)}`
        : `/v1/person?Name=${encodeURIComponent(query)}`;
      const data = await dfiGet(endpoint);
      return NextResponse.json({ results: data.PersonList || [] });
    }

    if (type === "film" && query) {
      const data = await dfiGet(`/v1/film?Title=${encodeURIComponent(query)}`);
      return NextResponse.json({ results: data.FilmList || [] });
    }

    if (type === "film_details" && id) {
      const data = await dfiGet(`/v1/film/${id}`);
      return NextResponse.json({ film: data });
    }

    return NextResponse.json({ error: "Ugyldige parametre" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
