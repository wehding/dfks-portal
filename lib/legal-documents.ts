export const LEGAL_DOCUMENT_TYPES = [
  "privacy_notice",
  "terms_of_service",
  "ai_transparency_notice",
  "contract_analysis_notice",
] as const;

export const LEGAL_DOCUMENT_AUDIENCES = ["member", "non_member"] as const;

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
  terms_of_service: "Brugervilkaar",
  ai_transparency_notice: "AI-transparens",
  contract_analysis_notice: "Kontraktanalyse",
};

export const LEGAL_DOCUMENT_AUDIENCE_LABELS: Record<LegalDocumentAudience, string> = {
  member: "Medlemmer",
  non_member: "Ikke-medlemmer",
};

export function isLegalDocumentType(value: unknown): value is LegalDocumentType {
  return LEGAL_DOCUMENT_TYPES.includes(value as LegalDocumentType);
}

export function isLegalDocumentAudience(value: unknown): value is LegalDocumentAudience {
  return LEGAL_DOCUMENT_AUDIENCES.includes(value as LegalDocumentAudience);
}

export const DEFAULT_LEGAL_DOCUMENT_COPY: Record<LegalDocumentAudience, Record<LegalDocumentType, { title: string; body: string }>> = {
  member: {
    privacy_notice: {
      title: "Velkommen til DFKS portalen - Din data, dine rettigheder",
      body: `For at give dig den skarpeste raadgivning om din loen og dine rettigheder bruger vi AI til at scanne din kontrakt. Din sikkerhed kommer foerst.

Inden systemet laeser dokumentet, maskerer vi automatisk CPR-nummer og bankoplysninger. Kontrakten behandles i et lukket system, som ikke bruges til at traene offentlige AI-modeller.

Som medlem er du oplyst om, at foreningen bruger overordnede kontrakt- og loenoplysninger til anonymiseret statistikarbejde. Statistikken bruges kun samlet og under faste diskretionsgraenser.`,
    },
    terms_of_service: {
      title: "Brugervilkaar for Portalen",
      body: `Portalen leverer digital softwareinfrastruktur, der understoetter organisationens sagsbehandling og raadgivning. Platformen, herunder AI-baserede kontraktanalyse- og statistikvaerktoejer, leverer alene raadgivende og beslutningsstoettende analyser.

Portalen er ikke aftalepartner i dine ansaettelses-, freelance- eller ophavsretskontrakter. Alle raadgivningsafgoerelser, overenskomstvurderinger og juridiske skridt foretages og godkendes af organisationens sagsbehandlere.

AI-genererede udtraek er vejledende og skal altid verificeres mod det originale kildedokument foer endelig sagsafslutning eller underskrift.`,
    },
    ai_transparency_notice: {
      title: "EU AI Act transparensdeklaration",
      body: `Kontraktanalysen er udarbejdet med stoette fra kunstig intelligens i form af en sprogmodel. AI-systemet gennemsoger teksten for specifikke klausuler, for eksempel loen, pension, buyout, AI-forbehold og overenskomstafvigelser.

Systemet foretager ingen automatiske afgoerelser. Fundne passager fremhaeves, saa du eller din faglige konsulent aktivt kan gennemgaa, verificere og godkende analysen.`,
    },
    contract_analysis_notice: {
      title: "Kontraktanalyse og maskering",
      body: `Naar du uploader en kontrakt, udtraekker systemet tekst og maskerer CPR-nummer, bankoplysninger og andre oplagte personlige kontaktoplysninger, foer teksten sendes til AI-analyse.

Analysen bruges til at finde relevante kontraktpunkter og mulige risici. En faglig raadgiver eller administrator skal kunne verificere fundene, foer de bruges som grundlag for raadgivning.`,
    },
  },
  non_member: {
    privacy_notice: {
      title: "Tjek din kontrakt og sikr dine rettigheder",
      body: `Vi scanner din kontrakt i vores lukkede system for at hjaelpe dig med at opdage skjulte faldgruber, for eksempel urimelige AI-traeningsklausuler eller manglende streaming-kreditering.

Da du ikke er medlem, opbevarer vi din kontrakt sikkert som juridisk dokumentation, saa vi kan varetage dine ophavsrettigheder og sikre udbetaling af dine Copydan- og streamingmidler.

Dit CPR-nummer og dine bankoplysninger maskeres automatisk, inden systemet analyserer dokumentet. Din kontrakt behandles i et lukket system og benyttes aldrig til at traene offentlige AI-modeller.`,
    },
    terms_of_service: {
      title: "Brugervilkaar for Portalen",
      body: `Portalen leverer digital softwareinfrastruktur, der understoetter organisationens rettighedsarbejde og raadgivning. Platformen, herunder AI-baserede kontraktanalyse- og statistikvaerktoejer, leverer alene raadgivende og beslutningsstoettende analyser.

Portalen er ikke aftalepartner i dine ansaettelses-, freelance- eller ophavsretskontrakter. Alle raadgivningsafgoerelser, overenskomstvurderinger og juridiske skridt foretages og godkendes af organisationens sagsbehandlere.

AI-genererede udtraek er vejledende og skal altid verificeres mod det originale kildedokument foer endelig sagsafslutning eller underskrift.`,
    },
    ai_transparency_notice: {
      title: "EU AI Act transparensdeklaration",
      body: `Kontraktanalysen er udarbejdet med stoette fra kunstig intelligens i form af en sprogmodel. AI-systemet gennemsoger teksten for specifikke klausuler, for eksempel loen, pension, buyout, AI-forbehold og overenskomstafvigelser.

Systemet foretager ingen automatiske afgoerelser. Fundne passager fremhaeves, saa du eller en faglig konsulent aktivt kan gennemgaa, verificere og godkende analysen.`,
    },
    contract_analysis_notice: {
      title: "Kontraktanalyse og anonym markedsstatistik",
      body: `Naar du uploader en kontrakt, udtraekker systemet tekst og maskerer CPR-nummer, bankoplysninger og andre oplagte personlige kontaktoplysninger, foer teksten sendes til AI-analyse.

Du kan frivilligt vaelge, om dine overordnede loen- og arbejdsvilkaar maa indgaa i anonymiseret markedsstatistik. Hvis du vaelger nej, bruges kontrakten kun som dokumentation for dine rettigheder og udbetalinger.`,
    },
  },
};
