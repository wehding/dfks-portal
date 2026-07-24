import type { HelpTopic } from "@/components/help/contextual-help";

type AdminHelpContent = { title: string; intro: string; topics: HelpTopic[] };

const DEFAULT_HELP: AdminHelpContent = {
  title: "Hjælp til administration",
  intro: "Sådan bruger du den aktuelle administrationsside.",
  topics: [{ title: "Arbejd sikkert", body: "Brug søgning og filtre til at finde posten, åbn den for at redigere, og kontrollér oplysningerne før du gemmer." }],
};

const HELP_BY_SECTION: Record<string, AdminHelpContent> = {
  "": { title: "Hjælp til Admin-overblik", intro: "Overblikket samler opgaver, der kræver handling.", topics: [{ title: "Opgaver", body: "Kortene åbner de filtrerede kontrakter, værker, visninger og gennemgange, der afventer behandling." }, { title: "Beskeder", body: "Ulæste medlemshenvendelser vises nederst og i menubadges." }] },
  kontrakter: { title: "Hjælp til kontrakter", intro: "Find, forbind og validér organisationens kontrakter.", topics: [{ title: "Forbind med værk", body: "Søg først efter et eksisterende værk. Kontrakttype, overenskomst og datoer redigeres efter værkforbindelsen." }, { title: "Serieafsnit", body: "Vælg de afsnit kontrakten gælder. En kontrakt kan gælde enkelte afsnit eller hele sæsonen." }] },
  vaerker: { title: "Hjælp til værker", intro: "Administrér fælles værkdata og de tilknyttede personer.", topics: [{ title: "Serier", body: "Fold en sæson ud for at se afsnit. Redigér sæsonen for fælles data og hvert afsnit for individuelle krediteringer." }, { title: "Kontrakter", body: "Under tilknyttede kontrakter kan du åbne rettighedshaverens konkrete kontrakt eller forbinde en ny." }] },
  producenter: { title: "Hjælp til producenter", intro: "Producenten er en fælles identitet med en eller flere juridiske enheder.", topics: [{ title: "DFI og CVR", body: "Brug DFI til producentnavn og DFI-id. CVR, adresse og telefon hentes fra CVR-registeret eller indtastes manuelt." }, { title: "Flere CVR-numre", body: "Tilføj flere juridiske enheder, når samme producent bruger forskellige selskaber eller produktionsenheder." }] },
  rettighedshavere: { title: "Hjælp til rettighedshavere", intro: "Administrér medlemmer, portaladgang og relationer.", topics: [{ title: "Søg og vælg", body: "Rettighedshavere vælges med autocomplete, som er afgrænset til organisationen." }, { title: "Relationer", body: "Fold relationer ud for at åbne personens værker og kontrakter uden at miste den aktuelle side." }] },
  brugere: { title: "Hjælp til brugere", intro: "Administrér login, administratorroller og portaladgang separat.", topics: [{ title: "Roller", body: "Administratorroller styrer adminmenuen. Rettighedshaveradgang er en separat systemrolle og bevares ved ændring af administratorroller." }, { title: "Organisation", body: "En bruger kan kun redigeres i den organisation, som den aktuelle admin-kontekst er knyttet til." }] },
  kontraktgennemgang: { title: "Hjælp til kontraktgennemgang", intro: "Prioritér sager og dokumentér den juridiske vurdering.", topics: [{ title: "Køen", body: "Filtrér efter status og åbn den ældste sag først. Gem svar og markér sagen færdig, når medlemmet har fået en vurdering." }] },
  aftalelicens: { title: "Hjælp til visningsadministration", intro: "Kontrollér og godkend indberettede visninger.", topics: [{ title: "Kontrol", body: "Sammenhold værk, kanal, tidspunkt og dokumentation før godkendelse eller afvisning." }] },
  udbetalinger: { title: "Hjælp til udbetalinger", intro: "Forbered og kontrollér rettighedsbetalinger.", topics: [{ title: "Kontrol før betaling", body: "Kontrollér modtager, beregningsgrundlag og status før en udbetaling markeres klar." }] },
  organisation: { title: "Hjælp til organisation", intro: "Vedligehold organisationens profil og fælles opsætning.", topics: [{ title: "Ændringer", body: "Branding, afsenderoplysninger og integrationer påvirker alle brugere i organisationen." }] },
};

export function adminHelpForPath(pathname: string) {
  const section = pathname.replace(/^\/admin\/?/, "").split("/")[0] ?? "";
  return { section, content: HELP_BY_SECTION[section] ?? DEFAULT_HELP };
}
