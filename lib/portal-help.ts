import type { HelpTopic } from "@/components/help/contextual-help";

export const MINE_KONTRAKTER_HELP: HelpTopic[] = [
  {
    title: "Upload kontrakt",
    body: "Upload en eller flere kontrakter. Systemet AI-læser kontrakterne og prøver at finde arbejdstitel, datoer, produktionsselskab og rettighedsmarkeringer.",
    tips: [
      "Du kan uploade op til 15 kontrakter ad gangen.",
      "Ved flere kontrakter prøver systemet selv at koble dem til dine værker.",
    ],
  },
  {
    title: "Forbind med værk",
    body: "Kontrakten skal være forbundet med det rigtige værk for at kunne indgå korrekt i rettighedssystemet. Kontroller især kontrakter med mærket Mangler værk.",
    tips: [
      "Hvis en kontrakt er koblet forkert eller slet ikke er koblet, kan den ikke danne grundlag for rettighedsbetaling.",
      "Du kan forbinde værket i kontraktens redigeringsvindue.",
    ],
  },
  {
    title: "Mærker på kontrakter",
    body: "Mangler værk vises før Afventer validering, fordi DFKS ikke kan validere kontrakten korrekt, før værket er valgt. Når værket er koblet, kan valideringsstatus vises.",
  },
  {
    title: "Rettigheder",
    body: "Rettighedsmærkerne viser de AI-fundne forhold, f.eks. overenskomst, kreditering, Copydan, streaming, AI/datamining og fremtidige rettigheder.",
  },
  {
    title: "Kommentarer",
    body: "Du kan skrive en kommentar til DFKS på den enkelte kontrakt. Svar fra DFKS vises samme sted og markeres i menuen, indtil du har åbnet dem.",
  },
];

export const MINE_VAERKER_HELP: HelpTopic[] = [
  {
    title: "Tilføj værk",
    body: "Brug søgning først, så systemet kan genbruge værker, der allerede findes. Hvis værket er en serie, kan du vælge præcis de afsnit, du har klippet, inden du sender oprettelsen.",
    tips: [
      "Lokale match kobler dig direkte på det eksisterende værk.",
      "DFI/TMDB-oprettelser og manuelle oprettelser kan kræve administratorgodkendelse.",
    ],
  },
  {
    title: "Importer fra DFI",
    body: "DFI-guiden finder dine krediteringer og frasorterer værker, der allerede er knyttet til dig. Lokale værker bliver koblet til dig uden at overskrive eksisterende data.",
  },
  {
    title: "Kontraktstatus",
    body: "Mangler kontrakt betyder, at systemet ikke kan se en valideret kontrakt på værket endnu. Klik på mærket for at uploade en kontrakt direkte til værket.",
    tips: ["Værk tilknyttet betyder, at der findes en kontraktforbindelse til værket."],
  },
  {
    title: "Rettelser og admin-kommentarer",
    body: "Når du retter værksdata, sendes ændringen til administrator. Klik på værket for at se status, kommentarer og hvilken type request kommentaren handler om.",
  },
];
