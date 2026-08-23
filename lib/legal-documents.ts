export const LEGAL_DOCUMENT_TYPES = [
  "privacy_notice",
  "terms_of_service",
  "ai_transparency_notice",
  "contract_analysis_notice",
] as const;

export const LEGAL_DOCUMENT_AUDIENCES = ["member", "non_member"] as const;
export const PRIVACY_POLICY_URL = "https://danskfilmklipperselskab.dk/privatlivspolitik/";

export type LegalDocumentType = (typeof LEGAL_DOCUMENT_TYPES)[number];
export type LegalDocumentAudience = (typeof LEGAL_DOCUMENT_AUDIENCES)[number];

export type LegalDocumentRecord = {
  id: string | null;
  document_type: LegalDocumentType;
  audience: LegalDocumentAudience;
  title: string;
  body: string;
  version: number;
  content_hash: string | null;
  published_at: string | null;
};

export const LEGAL_DOCUMENT_TYPE_LABELS: Record<LegalDocumentType, string> = {
  privacy_notice: "Privatliv og data",
  terms_of_service: "Brugervilkår",
  ai_transparency_notice: "AI-transparens",
  contract_analysis_notice: "Kontraktanalyse",
};

export const LEGAL_DOCUMENT_AUDIENCE_LABELS: Record<LegalDocumentAudience, string> = {
  member: "Medlemmer",
  non_member: "Ikke-medlemmer",
};

const DANISH_LEGAL_SPELLING: ReadonlyArray<readonly [string, string]> = [
  ["Brugervilkaar", "Brugervilkår"],
  ["raadgivningsafgoerelser", "rådgivningsafgørelser"],
  ["raadgivende", "rådgivende"],
  ["raadgivning", "rådgivning"],
  ["raadgiver", "rådgiver"],
  ["loenoplysninger", "lønoplysninger"],
  ["arbejdsvilkaar", "arbejdsvilkår"],
  ["vaerktoejer", "værktøjer"],
  ["ansaettelses", "ansættelses"],
  ["traeningsklausuler", "træningsklausuler"],
  ["diskretionsgraenser", "diskretionsgrænser"],
  ["understoetter", "understøtter"],
  ["beslutningsstoettende", "beslutningsstøttende"],
  ["gennemsoger", "gennemsøger"],
  ["fremhaeves", "fremhæves"],
  ["gennemgaa", "gennemgå"],
  ["udtraekker", "udtrækker"],
  ["udtraek", "udtræk"],
  ["stoette", "støtte"],
  ["afgoerelser", "afgørelser"],
  ["hjaelpe", "hjælpe"],
  ["laeser", "læser"],
  ["traene", "træne"],
  ["vaelge", "vælge"],
  ["indgaa", "indgå"],
  ["vilkaar", "vilkår"],
  ["foerst", "først"],
  ["foer", "før"],
  ["Naar", "Når"],
  ["Laes", "Læs"],
  ["loen", "løn"],
  [" saa ", " så "],
  [" maa ", " må "],
];

export function normalizeDanishLegalText(value: string) {
  return DANISH_LEGAL_SPELLING.reduce(
    (text, [source, replacement]) => text.replaceAll(source, replacement),
    value,
  );
}

export function isLegalDocumentType(value: unknown): value is LegalDocumentType {
  return LEGAL_DOCUMENT_TYPES.includes(value as LegalDocumentType);
}

export function isLegalDocumentAudience(value: unknown): value is LegalDocumentAudience {
  return LEGAL_DOCUMENT_AUDIENCES.includes(value as LegalDocumentAudience);
}

export const DEFAULT_LEGAL_DOCUMENT_COPY: Record<LegalDocumentAudience, Record<LegalDocumentType, { title: string; body: string }>> = {
  member: {
    privacy_notice: {
      title: "Velkommen til DFKS-portalen – dine data, dine rettigheder",
      body: `For at give dig den skarpeste rådgivning om din løn og dine rettigheder bruger vi AI til at gennemgå din kontrakt. Din sikkerhed kommer først.

Inden systemet læser dokumentet, maskerer vi automatisk CPR-nummer og bankoplysninger. Kontrakten behandles i et lukket system, som ikke bruges til at træne offentlige AI-modeller.

Som medlem er du oplyst om, at foreningen bruger overordnede kontrakt- og lønoplysninger til anonymiseret statistikarbejde. Statistikken bruges kun samlet og under faste diskretionsgrænser.

Læs den fulde privatlivspolitik: ${PRIVACY_POLICY_URL}`,
    },
    terms_of_service: {
      title: "Brugervilkår for portalen",
      body: `Portalen leverer digital softwareinfrastruktur, der understøtter organisationens sagsbehandling og rådgivning. Platformen, herunder AI-baserede kontraktanalyse- og statistikværktøjer, leverer alene rådgivende og beslutningsstøttende analyser.

Portalen er ikke aftalepartner i dine ansættelses-, freelance- eller ophavsretskontrakter. Alle rådgivningsafgørelser, overenskomstvurderinger og juridiske skridt foretages og godkendes af organisationens sagsbehandlere.

AI-genererede udtræk er vejledende og skal altid verificeres mod det originale kildedokument før endelig sagsafslutning eller underskrift.`,
    },
    ai_transparency_notice: {
      title: "EU AI Act transparensdeklaration",
      body: `Kontraktanalysen er udarbejdet med støtte fra kunstig intelligens i form af en sprogmodel. AI-systemet gennemsøger teksten for specifikke klausuler, for eksempel løn, pension, buyout, AI-forbehold og overenskomstafvigelser.

Systemet foretager ingen automatiske afgørelser. Fundne passager fremhæves, så du eller din faglige konsulent aktivt kan gennemgå, verificere og godkende analysen.`,
    },
    contract_analysis_notice: {
      title: "Kontraktanalyse og maskering",
      body: `Når du uploader en kontrakt, udtrækker systemet tekst og maskerer CPR-nummer, bankoplysninger og andre oplagte personlige kontaktoplysninger, før teksten sendes til AI-analyse.

Analysen bruges til at finde relevante kontraktpunkter og mulige risici. En faglig rådgiver eller administrator skal kunne verificere fundene, før de bruges som grundlag for rådgivning.`,
    },
  },
  non_member: {
    privacy_notice: {
      title: "Tjek din kontrakt og sikr dine rettigheder",
      body: `Vi gennemgår din kontrakt i vores lukkede system for at hjælpe dig med at opdage skjulte faldgruber, for eksempel urimelige AI-træningsklausuler eller manglende streamingkreditering.

Da du ikke er medlem, opbevarer vi din kontrakt sikkert som juridisk dokumentation, så vi kan varetage dine ophavsrettigheder og sikre udbetaling af dine Copydan- og streamingmidler.

Dit CPR-nummer og dine bankoplysninger maskeres automatisk, inden systemet analyserer dokumentet. Din kontrakt behandles i et lukket system og benyttes aldrig til at træne offentlige AI-modeller.

Læs den fulde privatlivspolitik for rettighedshavere: ${PRIVACY_POLICY_URL}`,
    },
    terms_of_service: {
      title: "Brugervilkår for portalen",
      body: `Portalen leverer digital softwareinfrastruktur, der understøtter organisationens rettighedsarbejde og rådgivning. Platformen, herunder AI-baserede kontraktanalyse- og statistikværktøjer, leverer alene rådgivende og beslutningsstøttende analyser.

Portalen er ikke aftalepartner i dine ansættelses-, freelance- eller ophavsretskontrakter. Alle rådgivningsafgørelser, overenskomstvurderinger og juridiske skridt foretages og godkendes af organisationens sagsbehandlere.

AI-genererede udtræk er vejledende og skal altid verificeres mod det originale kildedokument før endelig sagsafslutning eller underskrift.`,
    },
    ai_transparency_notice: {
      title: "EU AI Act transparensdeklaration",
      body: `Kontraktanalysen er udarbejdet med støtte fra kunstig intelligens i form af en sprogmodel. AI-systemet gennemsøger teksten for specifikke klausuler, for eksempel løn, pension, buyout, AI-forbehold og overenskomstafvigelser.

Systemet foretager ingen automatiske afgørelser. Fundne passager fremhæves, så du eller en faglig konsulent aktivt kan gennemgå, verificere og godkende analysen.`,
    },
    contract_analysis_notice: {
      title: "Kontraktanalyse og anonym markedsstatistik",
      body: `Når du uploader en kontrakt, udtrækker systemet tekst og maskerer CPR-nummer, bankoplysninger og andre oplagte personlige kontaktoplysninger, før teksten sendes til AI-analyse.

Du kan frivilligt vælge, om dine overordnede løn- og arbejdsvilkår må indgå i anonymiseret markedsstatistik. Hvis du vælger nej, bruges kontrakten kun som dokumentation for dine rettigheder og udbetalinger.`,
    },
  },
};
