import type { HelpTopic } from "@/components/help/contextual-help";

type PortalHelpContent = { title: string; intro: string; topics: HelpTopic[] };

export const MINE_KONTRAKTER_HELP: HelpTopic[] = [
  {
    title: "Upload kontrakt",
    body: "Upload en eller flere kontrakter. Systemet aflæser kontrakterne og udfylder forslag til blandt andet værktitel, datoer, produktionsselskab og rettigheder.",
    tips: [
      "Du kan uploade op til 15 kontrakter ad gangen.",
      "Kontroller de aflæste oplysninger, da du altid selv skal sikre, at de er korrekte.",
      "Når du uploader flere kontrakter, forsøger systemet at forbinde dem med de rigtige værker.",
    ],
  },
  {
    title: "AI-aflæste oplysninger",
    body: "Systemet bruger kontraktens tekst og en lokal PDF-kontrol til at foreslå oplysninger, herunder om kontrakten ser håndskrevet eller digitalt underskrevet ud. AI-forslag kan være usikre, så oplysningerne skal altid kontrolleres mod selve kontrakten.",
  },
  {
    title: "Forbind med værk",
    body: "En kontrakt skal være forbundet med det værk, den handler om. Kontroller især kontrakter med mærket Mangler værk.",
    tips: [
      "Åbn kontrakten for at søge efter værket eller oprette det, hvis det ikke findes endnu.",
      "En forkert eller manglende forbindelse kan betyde, at kontrakten ikke indgår korrekt i beregningen af rettigheder.",
    ],
  },
  {
    title: "Status på kontrakten",
    body: "Mærkerne viser, om kontrakten mangler et værk, afventer gennemgang eller er færdigbehandlet. Hvis der står Mangler værk, skal du først forbinde kontrakten med det rigtige værk.",
  },
  {
    title: "Rettigheder",
    body: "Rettighedsmærkerne giver et hurtigt overblik over de forhold, systemet har aflæst i kontrakten, for eksempel overenskomst, kreditering, Copydan, streaming, datamining og fremtidige rettigheder.",
    tips: ["Åbn kontrakten for at kontrollere oplysningerne og se flere detaljer."],
  },
  {
    title: "Beskeder til DFKS",
    body: "Du kan skrive til DFKS direkte på den enkelte kontrakt. Svar vises i samme samtale, og nye beskeder markeres, indtil du har åbnet dem.",
  },
];

export const MINE_VAERKER_HELP: HelpTopic[] = [
  {
    title: "Tilføj værk",
    body: "Her kan du tilknytte film, serier og andre værker, som du har arbejdet på. Søg efter titlen, vælg værket og angiv din rolle. For serier vælger du også de afsnit, du har arbejdet på.",
    tips: [
      "Vælg et eksisterende værk, når den rigtige titel allerede findes.",
      "Hvis titlen ikke kan findes, kan du indtaste værkets oplysninger manuelt.",
    ],
  },
  {
    title: "Værkssøgning",
    body: "Søgningen viser først værker, der allerede er registreret hos DFKS. Den kan også hente titeloplysninger fra Det Danske Filminstitut (DFI) og den internationale filmdatabase TMDB, så du kan finde og tilknytte det rigtige værk.",
    tips: [
      "Under din profil kan du søge efter nye titler, som du har arbejdet på.",
      "Kontroller titel, premiereår og værktype, før du tilføjer værket.",
    ],
  },
  {
    title: "Rediger serier og sæsoner",
    body: "En serie vises som én linje for hver sæson. Klik på sæsonens titel eller billede for at redigere sæsonens fælles oplysninger, medklippere og vælge præcist hvilke afsnit du har klippet.",
    tips: [
      "Brug pilen ved sæsonen til at folde de enkelte afsnit ud eller sammen.",
      "Klik på et udfoldet afsnit for at ændre oplysninger eller medklippere, der kun gælder det afsnit.",
      "Boksen Dine afsnit findes kun i sæsonredigeringen, så afsnit vælges ét samlet sted.",
      "De nuværende fælles værksoplysninger bliver stående, mens et rettelsesforslag behandles.",
    ],
  },
  {
    title: "Kontrakter på serier",
    body: "En kontrakt kan gælde hele sæsonen eller bestemte afsnit. I listen vises Tilknyttet på de afsnit, der er dækket af enten en sæsonkontrakt eller en afsnitskontrakt.",
  },
  {
    title: "Godkendelse og beskeder",
    body: "Nye eller ændrede oplysninger kan kræve godkendelse fra administrator. Det gælder blandt andet, hvis du ændrer oplysninger hentet fra en filmdatabase, eller hvis en manuel oprettelse ligner et værk, der allerede findes.",
    tips: [
      "Skriv en kort bemærkning til administrator, når du sender en rettelse eller manuel oprettelse til godkendelse.",
      "Klik på værket for at følge status og læse eller besvare administratorens kommentarer.",
    ],
  },
];

const DEFAULT_PORTAL_HELP: PortalHelpContent = {
  title: "Hjælp til portalen",
  intro: "Sådan bruger du den aktuelle side.",
  topics: [{
    title: "Find og rediger oplysninger",
    body: "Brug søgning og filtre til at finde det, du skal arbejde med. Klik på en titel for at åbne den, og kontrollér oplysningerne før du gemmer.",
  }],
};

const PORTAL_HELP_BY_SECTION: Record<string, PortalHelpContent> = {
  "": {
    title: "Hjælp til overblik",
    intro: "Overblikket samler dine værker, kontrakter, beskeder og næste opgaver.",
    topics: [
      { title: "Dine næste skridt", body: "Kort og mærker viser, hvor der mangler oplysninger, en forbindelse eller et svar." },
      { title: "Lønstatistik", body: "Det er frivilligt at bidrage med løndata. Du kan ændre dit valg under Min profil." },
    ],
  },
  "mine-vaerker": { title: "Hjælp til Mine værker", intro: "Sådan finder, tilføjer og retter du de værker, du har arbejdet på.", topics: MINE_VAERKER_HELP },
  "mine-kontrakter": { title: "Hjælp til Mine kontrakter", intro: "Sådan uploader, forbinder og følger du dine kontrakter.", topics: MINE_KONTRAKTER_HELP },
  okonomi: {
    title: "Hjælp til økonomi",
    intro: "Se beregninger og udbetalinger knyttet til dine rettigheder.",
    topics: [{ title: "Beløb og status", body: "Åbn en post for at se beregningsgrundlag og status. Kontakt DFKS via Beskeder, hvis oplysningerne ikke stemmer." }],
  },
  "mine-visninger": {
    title: "Hjælp til Mine visninger",
    intro: "Kontrollér visninger, som kan være relevante for dine værker.",
    topics: [{ title: "Indberet en visning", body: "Kontrollér titel, kanal og tidspunkt, og indsend kun visninger for værker, du har arbejdet på." }],
  },
  kontraktgennemgang: {
    title: "Hjælp til kontraktgennemgang",
    intro: "Indsend en kontrakt og følg DFKS’ vurdering.",
    topics: [{ title: "Før du sender", body: "Kontrollér fil og kontaktoplysninger. Du kan følge sagen og besvare spørgsmål på samme side." }],
  },
  "min-profil": {
    title: "Hjælp til Min profil",
    intro: "Vedligehold dine kontaktoplysninger og personlige valg.",
    topics: [{ title: "Statistikvalg", body: "Det er frivilligt at bidrage med løndata. Dit valg kan ændres her, når du ønsker det." }],
  },
  beskeder: {
    title: "Hjælp til beskeder",
    intro: "Læs og besvar beskeder fra DFKS.",
    topics: [{ title: "Samtaler", body: "Åbn en tråd for at se hele samtalen. Svar i den samme tråd, så beskeden fortsat er knyttet til det relevante værk, den relevante kontrakt eller den relevante visning." }],
  },
  aftalelicens: {
    title: "Hjælp til aftalelicens",
    intro: "Se og indberet visninger, som kan være relevante for dine værker.",
    topics: [{ title: "Kontrollér visningen", body: "Kontrollér titel, kanal, dato og tidspunkt, før du sender visningen til DFKS." }],
  },
};

export function portalHelpForPath(pathname: string) {
  const section = pathname.replace(/^\/portal\/?/, "").split("/")[0] ?? "";
  return { section, content: PORTAL_HELP_BY_SECTION[section] ?? DEFAULT_PORTAL_HELP };
}
