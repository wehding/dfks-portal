/**
 * lib/voice-examples.ts
 *
 * Tre juristen-godkendte stemme-eksempler til brug i MAIL_GENERATION_PROMPT.
 * GUL-tokens er allerede lagt på af applikationskoden — modellen ser eksemplerne
 * som reference for tone, rytme og vi/du-stil.
 *
 * Princip der fremgår af eksemplerne:
 *   - Mailen er i vi/du-form — "vi" = DFKS/sekretariatet, "du" = членmet
 *   - Argumentationen er fri prosa, aldrig skabelon
 *   - Citerede klausultekster (proposed_text_da) indsættes ordret i anførselstegn
 *   - GUL-markeringen (===GUL START=== / ===GUL SLUT===) lægges af koden, ikke modellen
 */

export const VOICE_EXAMPLES_DEFAULT = `
────────────────────────────────────────────────────────────────────
STEMME-EKSEMPEL 1 (YYYY — fiktionsproduktion, leverandørkontrakt)
────────────────────────────────────────────────────────────────────

Kære YYYY

Tak for kontrakten i går. Som lovet kommer her både rettighedsbestemmelsen og lidt ekstra + en tro kopi af fiktionsoverenskomstens rettighedsbestemmelse, som du også kan forsøge dig med. Det er op til dig.
AI-bestemmelsen og en § 55-henvisning i vores andet forslag, er ikke noget, vi har med i fiktionsoverenskomsten, da det ikke var aktuelt på det tidspunkt. Så måske er det mere "rent" at gå efter fiktionsoverenskomstens rettighedsbestemmelse.

kh Emilie og Lone

KOMMENTARER OG ÆNDRINGSFORSLAG

6. Overdragelse af rettigheder: I afsnittet som angår overdragelsen af rettigheder, er det på nuværende tidspunkt alene Producenten, som tilgodeses. Dette vil vi gerne have ændret.

5.1 Primære rettigheder: For det første vil vi foreslå, at afsnittet om dine primære rettigheder ændres. Dette vil vi af blandt andet fordi, der i den nuværende rettighedsbestemmelse står, at Producenten får ret til at distribuere produktionen gennem fremtidigt opfundne metoder. Det er ikke muligt at forudse hvad dette indebærer, og derfor mener vi ikke, at du skal afgive denne form for rettigheder til producenten. Herudover vil vi også foreslå at få fjernet den del, der angår streaming, da vi ønsker et særskilt rettighedspunkt om dette (et § 55-forbehold). Vi foreslår derfor, at bestemmelsen fjernes og byttes ud med følgende:

===GUL START===
"6.1 Primære Rettigheder: Leverandøren overdrager hermed til Producenten den eksklusive ret til – uden tidsmæssige, geografiske begrænsninger og/eller andre begrænsninger – at fremstille eksemplarer af Produktionen og at gøre TV-serien tilgængelig for almenheden med eller uden undertekster og/eller eftersynkroniseret på ethvert sprog (inklusiv oversættelse af billedtekst/"kort"/grafik i TV-serien), dels gennem offentlig fremførelse via især biograf, television af enhver art (herunder free-tv, pay-tv, pay-per-view, pay-per-event, kabel- og satellit-tv), telefoni, digitale og interaktive medier, herunder online/on-demand, samt internetudnyttelse herunder webcast, dels gennem kommerciel eller ikke-kommerciel udnyttelse og/eller spredning i enhver form, herunder salg, udlejning og/eller udlån af TV-serien i et hvilket som helst format herunder især videokassetter, laserdisc, CD-i, DVD, DIVX, CD-Rom samt alle øvrige opfundne metoder til udnyttelse og/eller spredning."
===GUL SLUT===

Copydan-forbehold: Din kontrakt indeholder på nuværende tidspunkt ikke et copydan-forbehold. Denne bestemmelse er meget vigtig at få med, og da det ikke koster Producenten noget, at inkludere et copydan-forbehold, bør det indskrives i kontrakten. Du kan foreslå at det indskrives med følgende ordlyd:

===GUL START===
"6.2 Copydan-forbehold: Filmklipperen og producenten bevarer, desuagtet øvrige aftalevilkår, hver rettigheder samt en vederlagsret for brug af produktionen omfattet af Ophavsretslovens §§ 13, 13a, 17, 30a, 35, 39-46a og 50, stk. 2 [...]"
===GUL SLUT===

Udover disse ændring vil vi også foreslå, at du får følgende rettighedsbestemmelser indskrevet i din kontrakt:

===GUL START===
"6.3 § 55-forbehold: Leverandøren har desuagtet aftalens øvrige vilkår ret til passende og forholdsmæssig betaling for udnyttelse af sine rettigheder ifm. den færdige produktion, jf. Ophavslovens § 55 [...]"

"6.4 Promovering af eget arbejde: Leverandøren kan bruge framegrabs, trailer og klip af filmen til at promovere eget arbejde på egen hjemmeside, sociale medier, [...]"

"6.5 AI og udnyttelse: Retten til at udnytte indholdet med henblik på tekst- og datamining, jf. ophavsretslovens § 11 b og DSM-direktivets artikel 4 [...]"

"6.6 Øvrige rettigheder: Alle rettigheder til i dag kendte eller fremtidige udnyttelsesformer, [...]"

"6.7 Festivaler og priser: Hvis Fiktionsproduktionen er i konkurrence på en A-film-festival inviteres Filmklipperen + gæst med. [...]"
===GUL SLUT===

9. Opsigelse: I kontrakten er der en bestemmelse, som angår opsigelse. Ifølge denne kan både du og Producenten opsige kontrakten med 5 dages varsel. Dette er fint, særligt henset til, at din ansættelse er 20 dage.

13. Overdragelse: I denne bestemmelse vil vi blot have lavet en mindre ændring, ved at tilføje sætningen "under overholdelse af denne kontrakt". Dette vil vi for at sikre, at hvis Producenten vælger at overdrage kontrakten, vil du stadig have de rettigheder, som fremgår af kontrakten. Derfor foreslår vi, at den endelige version af bestemmelsen bliver:

===GUL START===
"Eksempel Productions er berettiget til helt eller delvist at overdrage nærværende aftale til tredjemand ved skriftlig meddelelse til Leverandøren, [...]"
===GUL SLUT===

Kreditering: Herudover mangler der en bestemmelse i kontrakten, som angår kreditering. Dette skal du have med, så du er sikker på, at blive krediteret korrekt. Vi foreslår, at den udformes som følgende:

===GUL START===
"Der er aftalt følgende vedrørende kreditering: Filmklipper: [Medlemmets navn]"
===GUL SLUT===

Det var de kommentarer vi havde i denne omgang. Du er mere end velkommen til at tage fat i Lone eller jeg, hvis du har yderligere spørgsmål.

Herudover må du meget gerne fremsende den endeligt underskrevne kontrakt.

God dag! 🙂

De bedste hilsner,
Emilie

────────────────────────────────────────────────────────────────────
STEMME-EKSEMPEL 2 (XXXX — dokumentarproduktion, A-løn)
────────────────────────────────────────────────────────────────────

Kære XXXX

Mange tak for din mail og for kontrakten 🙂

Lone og jeg har gennemgået din kontrakt i fællesskab, og du får vores kommentarer og ændringsforslag her. Du skal være opmærksom på, at denne mail kun er til dig, og du må derfor IKKE videresende den til Producenten. Læs den igennem, og send derefter det, der er markeret med GUL i en separat mail til Producenten.

KOMMENTARER OG ÆNDRINGSFORSLAG

3. Løn: Din løn er lidt lav sammenlignet med en fiktionsproduktion, men fordi dokumentarer desværre ofte har en lavere løn en fiktionsproduktion, er der nok ikke så meget at gøre i forhold til dette. Og 13.000 kroner om ugen samt pension på 7.6% er en relativt fin løn på en dokumentarproduktion.

4. Kreditering: Angående kreditering, vil vi gerne have at dit navn står som en del af bestemmelsen, sådan at du kan være sikker på at blive krediteret korrekt. Derfor foreslår vi, at bestemmelsen ændres, så der i stedet står:

===GUL START===
"4. Kreditering: Der er aftalt følgende vedrørende kreditering: Klipper: [Medlemmets navn]"
===GUL SLUT===

Fordi der er tale om en dokumentar, kan du overveje, om din indflydelse på udformningen af produktionen er så stor, at du bør krediteres som co-manus forfatter. Er dette tilfældet, kan du i stedet ændre bestemmelsen til følgende:

===GUL START===
"4. Kreditering: Der er aftalt følgende vedrørende kreditering: Co-manuskriptforfatter og klipper: [Medlemmets navn]"
===GUL SLUT===

Rettigheder: I forhold til rettigheder, vil vi forsøge at få de rettigheder med, som optimalt set skal være i en kontrakt for klippere. Derfor skal det rettighedsafsnit, der på nuværende tidspunkt er i kontrakten, udskiftes med følgende:

===GUL START===
"7.1 Primære Rettigheder: Filmklipperen overdrager hermed til Producenten den eksklusive ret til – uden tidsmæssige, geografiske begrænsninger – at fremstille eksemplarer af Produktionen og at gøre Filmen tilgængelig for almenheden [...]"

"7.2 Copydan-forbehold: Filmklipperen og producenten bevarer, desuagtet øvrige aftalevilkår, hver rettigheder samt en vederlagsret for brug af produktionen [...]"

"7.3 § 55-forbehold: Filmklipperen har desuagtet aftalens øvrige vilkår ret til særskilt betaling for udnyttelse til streaming og salg til tredjemand. [...]"

"7.4 Øvrige rettigheder: Alle rettigheder til i dag kendte eller fremtidige udnyttelsesformer, [...]"

"7.5 AI og udnyttelse: Retten til at udnytte indholdet med henblik på tekst- og datamining, jf. ophavsretslovens § 11 b og DSM-direktivets artikel 4 [...]"

"7.6 Festivaler og priser: Hvis Dokumentarproduktionen er i konkurrence på en A-film-festival inviteres Filmklipperen + gæst med. [...]"
===GUL SLUT===

______

Det følgende er kommentarer, som du kan udlade at sende til Producenten, idet du og Lone har aftalt, at det alene er rettighedsafsnittet, der skal ændres i.

Sygdom og opsigelse: Herudover vil vi foreslå at du får indskrevet bestemmelser, som angår sygdom og opsigelse/ophør. Da du er A-løns ansat, bør dette være en del af din kontrakt. Vi foreslår, at det indskrives i kontrakten på følgende måde:

===GUL START===
"10. Sygdom: Bliver Filmklipperen på grund af sygdom ude af stand til at udføre sine forpligtelser/ydelser, betragtes det heraf følgende fravær som lovligt forfald, der giver ret til løn under sygdom. [...]"

"11. Opsigelse/Ophør: Hver af parterne kan opsige nærværende aftale med følgende skriftligt varsel: 4 ugers varsel inden for de første 5 måneders ansættelsesperiode. 3 måneders varsel, hvis ansættelsesforholdet har varet mere end 5 måneder."
===GUL SLUT===

Konkurs: Som det sidste, vil vi foreslå, at du får indskrevet en bestemmelse som angår konkurs, hvis nu det skulle ske, at produktionen går konkurs. Denne foreslår vi, kan se ud på følgende måde:

===GUL START===
"12. Konkurstilfælde: I tilfælde af Producentens konkurs eller betalingsstandsning falder de rettigheder Filmklipperen har overdraget til producenten tilbage til Filmklipperen 30 dage efter konkursbegæringens indgivelse, [...]"
===GUL SLUT===

Det var de ændringer og kommentarer vi havde til din kontrakt. Hvis du har yderligere spørgsmål, er du mere end velkommen til at tage fat i os igen.

Rigtig god dag 🙂

De bedste hilsner,

────────────────────────────────────────────────────────────────────
STEMME-EKSEMPEL 3 (xxxxx — TV-serie, leverandørkontrakt)
────────────────────────────────────────────────────────────────────

Kære xxxxx

Mange tak for kontrakten!

Lone og jeg har i fællesskab gennemgået den, og du får vores kommentarer og ændringsforslag i denne mail.

Du skal være opmærksom på, at du IKKE må videresende denne mail direkte til Producenten. Den er kun til dig, så læs dem igennem og send så de tekststykker, der er markeret med GUL i en ny mail til Producenten.

KOMMENTARER OG ÆNDRINGSFORSLAG

4.1 Løn: Angående din løn, så ser den fin ud. Den ligger på 22.000 kroner om ugen, og normallønnen for en klipper ansat som leverandør er 19.467, når man medregner pension på 9.5% og feriepenge og 1,5% for helligdagsbetaling og barselsstøtte.

4.3 Prolongation: Denne bestemmelse omhandler muligheden for, at du skal arbejde udover de 18 uger, du er ansat til. I bestemmelsen står der, at du og Producenten skal forhandle om betaling for ekstraarbejde, men ikke hvorvidt der er nogle begrænsninger for, hvor meget eller hvor længe dette kan være. Det betyder, at du forpligter dig til at stå til rådighed og derfor ikke ville kunne sige ja til andet arbejde i denne periode - i hvert fald indtil du får en aftale med producenten her. Derfor foreslår vi, at bestemmelsen ændres så den i stedet lyder:

===GUL START===
"4.3 Afviger TV-serien tidsmæssigt væsentligt fra produktionsplanen, jf. bilag 2, forhandler Parterne loyalt om yderligere betaling, såfremt dette medfører ekstraarbejde for Leverandøren. [...]"
===GUL SLUT===

5 Rettigheder: Dette punkt omhandler dine rettigheder, og vi har en række forslag, der vil styrke din position rettighedsmæssigt i forbindelse med produktionen.

5.1 Primære rettigheder: For det første vil vi gerne have ændret i afsnittet om dine primære rettigheder. Dette vil vi bl.a. fordi der i den nuværende bestemmelse står, at Producenten får ret til at distribuere produktionen gennem fremtidigt opfundne metoder. Dette er ikke muligt at forudse rækkevidden af, og derfor mener vi ikke, at dette skal være rettigheder, du afgiver. Herudover vil vi også gerne have fjernet den del, der angår streaming, da vi ønsker et særskilt rettighedspunkt om dette. Vi foreslår derfor, at bestemmelsen fjernes og byttes ud med følgende:

===GUL START===
"5.1 Leverandøren overdrager hermed til Producenten den eksklusive ret til – uden tidsmæssige, geografiske begrænsninger og/eller andre begrænsninger – at fremstille eksemplarer af Produktionen [...]"
===GUL SLUT===

5.3 Ophavsretslovens § 54: I kontraktens afsnit 5.3 står der, at kontrakten fraviger varslerne i Ophavsretslovens § 54. Dog står der i Ophavsretslovens § 54, at paragraffen, og dermed varslerne i den, ikke kan fraviges medmindre det følger af en kollektivt forhandlet aftale, jf. Ophavsretslovens § 54, stk. 2. Fordi din kontrakt er en leverandøraftale, følger den netop ikke en kollektivt forhandlet aftale, og det er derfor ikke muligt, at Producenten kan fravige de varsler, der står i § 54. Derfor skal afsnittet ændres, sådan at der i stedet står:

===GUL START===
"5.4 Leverandøren kan bringe aftalen til ophør for så vidt angår ikke-udnyttede rettigheder med 6 måneders varsel, [...]"
===GUL SLUT===

Udover disse ændring vil vi også foreslå, at du får følgende rettighedsbestemmelser indskrevet i din kontrakt:

===GUL START===
"5.6 § 55-forbehold: Leverandøren har desuagtet aftalens øvrige vilkår ret til passende og forholdsmæssig betaling for udnyttelse af sine rettigheder ifm. den færdige produktion, jf. Ophavslovens § 55 [...]"

"5.7 Promovering af eget arbejde: Leverandøren kan bruge framegrabs trailer og klip af filmen til at promovere eget arbejde på egen hjemmeside, sociale medier, [...]"

"5.8 AI og udnyttelse: Retten til at udnytte indholdet med henblik på tekst- og datamining, jf. ophavsretslovens § 11 b og DSM-direktivets artikel 4 [...]"

"5.9 Øvrige rettigheder: Alle rettigheder til i dag kendte eller fremtidige udnyttelsesformer, [...]"
===GUL SLUT===

6. Kreditering: Vi vil også foreslå at krediteringsbestemmelsen ændres, sådan at du er sikker på, du krediteres på den korrekte måde. Derfor forslår vi at bestemmelsen fjernes og følgende indsættes:

===GUL START===
"6. Kreditering: Der er aftalt følgende vedrørende kreditering: Filmklipper: [Medlemmets navn]"
===GUL SLUT===

9. Ophør: I bestemmelsen der omhandler ophør, vil vi gerne have lavet nogle ændringer, sådan at du også bliver tilgodeset, da bestemmelsen på nuværende tidspunkt kun gavner Producenten.

9.2: På nuværende tidspunkt kan du ifølge denne bestemmelse opsiges uden varsel hvis Producenten ikke vurderer, at dine ydelser eller samarbejdet mellem jer er tilstrækkeligt. Dette er meget indgribende, og vi vil derfor klart foreslå, at du får indskrevet et opsigelsesvarsel, særligt henset til, din ansættelse varer 18 uger. Denne bestemmelse forslår vi derfor bliver fjernet og skiftet ud med følgende:

===GUL START===
"9.2: Hver af parterne kan opsige nærværende aftale med følgende skriftligt varsel: 4 ugers varsel inden for de første 5 måneders ansættelsesperiode. 3 måneders varsel, hvis freelanceforholdet har varet mere end 5 måneder."
===GUL SLUT===

9.3: I følge denne bestemmelse, kan din ansættelse tages op til overvejning, altså eventuelt opsiges, i tilfælde af sygdom. Dette vil vi gerne have ændret, og vi foreslår at bestemmelsen byttes ud med følgende:

===GUL START===
"9.3: Bliver Leverandøren på grund af sygdom ude af stand til at udføre sine forpligtelser/ydelser, betragtes det heraf følgende fravær som lovligt forfald, der giver ret til honorar under sygdom. [...]"
===GUL SLUT===

Det var alle de forslag og kommentarer vi havde i denne omgang. Du er mere end velkommen til at tage fat i Lone eller jeg hvis du har nogle spørgsmål.

Herudover må du meget gerne fremsende den endeligt underskrevne kontrakt.

God dag!

De bedste hilsner,
`
