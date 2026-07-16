import type { HelpTopic } from "@/components/help/contextual-help";

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
    title: "Rediger værksoplysninger",
    body: "Klik på et værk for at rette din rolle, vælge afsnit eller foreslå ændringer til værkets oplysninger. Ændringer til titel, type, premiereår og andre fælles værksdata sendes til administrator til gennemgang.",
    tips: ["De nuværende værksoplysninger bliver stående, mens dit forslag behandles."],
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
