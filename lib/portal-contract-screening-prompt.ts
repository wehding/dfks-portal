export function buildPortalContractScreeningPrompt(roles: string[]): string {
  const safeRoles = roles
    .map(role => role.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map(role => role.slice(0, 80));
  const roleList = safeRoles.length > 0
    ? safeRoles.map(role => JSON.stringify(role)).join(", ")
    : '"Klipper"';

  return `Du er assistent der hjælper klippere med at udfylde en uploadformular baseret på deres kontrakt.

Returner KUN gyldig JSON uden markdown-backticks — præcis denne struktur:

{
  "title": "produktionens titel (string eller null)",
  "isDevelopmentContract": "true hvis kontrakten er en udviklingskontrakt — dvs. indeholder udtryk som 'Klipper (udvikling)', 'Film Editor (development)', 'udviklingskontrakt', 'optionsaftale', 'i udviklingsfasen', 'i udvikling', 'udviklingsfase', 'development deal', 'development agreement' eller lignende. Ellers false.",
  "productionType": "feature|short|tvSeries|documentary|docSeries|tvEntertainment|reality|sport eller null",
  "creditedRole": "VÆLG præcis én af disse roller baseret på kontraktens funktionsbetegnelse: ${roleList} — eller null hvis rollen ikke fremgår",
  "duration": "samlet varighed i hele minutter som tal — 0 for serier eller hvis ukendt",
  "premiereDate": "YYYY-MM-DD eller null",
  "productionCompany": "produktionsselskab/producer/opdragsgiver for produktionen som string eller null",
  "director": "instruktør som string eller null",
  "seasonNumber": "sæsonnummer som heltal eller null",
  "episodes": [{"number": 1, "title": "Afsnit 1", "duration": 45}]
}

Regler:
- creditedRole: returner ALTID præcis ét af de listede rollnavne — kopiér stavningen nøjagtigt. "Editor", "Film Editor", "Supervising Editor", "Monteur", "Montage", "Cutter" og "Picture Editor" er synonymer for "Klipper".
- isDevelopmentContract: sæt til true hvis titlen på klipperens funktion indeholder "(udvikling)" / "(development)" eller kontrakten i øvrigt tydeligt er en optionsaftale/udviklingsaftale.
- productionType baseres på værkets type: spillefilm/feature film → feature, tv-serie/dramaserie → tvSeries, dokumentarfilm → documentary, dokumentarserie → docSeries, kortfilm → short, tv-show/underholdning → tvEntertainment, reality → reality, sport → sport.
- productionType skal udfyldes, når typen fremgår eller med høj sandsynlighed kan udledes. Returner kun null, når typen reelt ikke kan bestemmes.
- productionCompany skal være selve produktionsselskabet/producerende selskab, ikke personens arbejdsgiver hvis det tydeligt er noget andet.
- director skal kun udfyldes, hvis instruktøren fremgår tydeligt.
- seasonNumber skal kun udfyldes for serier, når sæsonen fremgår tydeligt.
- episodes skal kun udfyldes for en serie med konkrete afsnit. Ellers returneres [].
- duration for serier sættes til summen af episodes, hvis de er kendte, ellers 0.
- Returner null for felter, du ikke kan finde i kontrakten.`;
}
