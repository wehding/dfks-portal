# Kontraktejerskab: kontrol, evidens og adgang

## Formål

`contracts.rights_holder_id` bestemmer, hvilken rettighedshaver der kan se en
kontrakt. Feltet er derfor både en sagsoplysning og en adgangsbeslutning. Det må
ikke ændres som en sideeffekt af AI-aflæsning, almindelig kontraktredigering
eller validering.

Denne beslutning gælder for alle kontraktversioner og alle uploadkilder.

## Roller

- `superadmin`, `admin` og `org-admin` kan behandle ejerskab på fanen
  **Ejerskab** i Rediger kontrakt og i en filtreret kø for en organisation,
  de har adgang til.
- `jurist` kan se den registrerede ejer som en skrivebeskyttet oplysning og
  bruge de almindelige juridiske medlemsmoduler, men kan ikke hente
  kandidater gennem ejerskabsfunktionen, se ejerskabskøen eller ændre ejeren.
- `viewer` og medlemmer har ingen administrativ ejerskabsfunktion.
- Et medlems egen, autentificerede upload registreres med stærk
  identitetsproveniens. En senere AI-uoverensstemmelse opretter en konflikt til
  kontrol; den flytter aldrig kontrakten automatisk.

Menuvisning er ikke adgangskontrol. Hver serverhandling og databasefunktion
kontrollerer aktør, organisation og kontrakt igen.

## Autoritativ ændringsvej

Efter aktivering må en eksisterende kontrakts `rights_holder_id` kun ændres via
den dedikerede, atomiske ejerskabsfunktion. Funktionen:

1. låser kontrakten og kontrolrækken i fast rækkefølge;
2. kontrollerer aktørens rolle og organisation;
3. kontrollerer forventet nuværende ejer og kontrolrevision;
4. kontrollerer, at den nye profil ikke er arkiveret og har tilknytning til
   organisationen;
5. ændrer ejeren og kontrolstatus i samme transaktion;
6. fjerner kontraktens tidligere afsnitsvalg og reference til ejerens
   afsnitsbekræftelse samt ugyldiggør de gamle bekræftelser;
7. genåbner en valideret kontrakt som kladde ved et reelt ejerskifte;
8. opdaterer en eventuel importpost, så en løst `missing_owner`-blokering ikke
   bliver stående i valideringskøen;
9. skriver én semantisk auditbegivenhed med både gammel og ny rettighedshaver
   som audit-subjekter.

Værkkrediteringer og medklipperrelationer flyttes ikke automatisk. De er
selvstændige faglige oplysninger.

Medlemsbeskeder bindes ved oprettelsen til den rettighedshaver, der deltog i
samtalen. Et ejerskifte overfører derfor ikke den gamle samtale til den nye
ejer. Administratorer kan fortsat se den samlede historik med en tydelig
deltageretiket; historiske beskeder, hvor deltageren ikke kan dokumenteres,
forbliver kun synlige for medarbejdere.

## Evidens

Ejerskabsfanen skelner mellem:

- registreret ejer;
- kandidat fundet i den rå AI-aflæsning;
- uploadens identitetsproveniens;
- administratorens tidligere valg;
- den dokumentversion og det AI-job, som et forslag bygger på.

Rå `contract_ai_jobs.result_data` er AI-kilden. Editorens berigede
`contract_validations.extracted_data` må ikke bruges som ejerbevis, fordi den
kan indeholde den allerede registrerede ejers navn som brugerfladefallback.

Når præcis spatial evidens findes, bindes den til dokumentjob, spatial hash,
side og bounding box. Den juridiske original forbliver uændret. En konverteret
Word-visning er kun en visningskopi, og den behandlede PDF bruges kun til
kildevisning.

## Upload og analyse

- PDF, DOC og DOCX går gennem dokumentworkeren før AI-aflæsning.
- TXT kan analyseres uden præcis grafisk kildeplacering og markeres tilsvarende.
- Medlemsupload og medlemmets Drive-import får den sessionbundne ejer og en
  bekræftet systemproveniens.
- Adminvalgt ejer ved upload starter som `pending`.
- Adminupload uden valgt ejer forbliver ejerløs.
- AI og massehandlingen til ejersøgning opretter kun forslag.
- Et AI-job må kun udfylde et tomt værklink. Et værk, som en administrator har
  valgt mens jobbet kørte, bevares, og forældede serieoplysninger må ikke
  oprette et afsnitsscope på det manuelt valgte værk.
- Importstatus afledes på ny fra den låste kontrakts aktuelle ejer, værk og
  afsnitsscope. En ældre AI-callback må ikke genindføre `missing_owner` eller
  ændre en allerede afsluttet, dublet- eller fejlklassificeret importpost.
- Gmail får først en ejerskabskontrol, når en gennemgang oprettes som en
  kanonisk kontrakt.

Alle nye dokumentversioner kontrolleres særskilt, også når de vises samlet i en
versionskæde.

## Produktion og rollback

Migrationen må ikke køres i produktion uden særskilt driftsgodkendelse. Før
aktivering skal følgende registreres som aggregater:

- antal kontrakter med og uden ejer;
- antal historiske kontrolrækker, der seedes som `pending`;
- antal kontrakter pr. kontrolstatus og oprindelse;
- antal profiler uden gyldig organisationstilknytning.

Rollback består af to dele:

1. Deaktivér den nye brugerflade og stop ejerskabsbehandling.
2. Fjern databasebeskyttelsen og de nye funktioner efter en databasebackup.

Kontrolhistorik og auditbegivenheder slettes ikke ved almindelig rollback.
Ingen historiske ejerændringer må rulles tilbage automatisk; de kræver en ny,
auditeret beslutning.

## Sikkerhedsinvariant

```text
En registreret ejer er aldrig i sig selv evidens for, at ejeren er korrekt.
AI kan foreslå, men kan ikke tildele. Kun den dedikerede, rolle- og
organisationskontrollerede ejerskabsfunktion må ændre en eksisterende ejer.
```
