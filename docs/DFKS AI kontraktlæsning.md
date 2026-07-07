Krediteret funktion
Er der angivet en funktion på kontrakten?  
Sæt enten klipper, b-klipper, suplerende klipper, fotograf, instruktør, scenograf eller Andet.

Kategori
Type af produktion. Enten Spillefilm, TV-Serie, Dokumentar, Dokumentar Serie, Kortfilm eller Andet.

Antal arbejdsdage  
total antal arbejdsdage udregnet ud fra datoer angivet \- der beregnes 5 arbejdsdage pr. uge. Resultatet skal angives som et rent tal, uden kommentarer.

Leverandøraftale/faktura
hvis kontrakten er en leverandør aftale eller det nævnes at medarbejderen sender en faktura er outputtet JA

ugeløn  
Find og normaliser ugeløn/honorar efter denne prioritering:

1. Find først eksplicit ugepris: "pr. uge", "per uge", "ugentligt", "per week", "per workweek" eller "weekly".
2. Hvis både ugepris og totalbeløb findes, skal ugeløn være ugeprisen. Totalbeløb bruges kun som kontrol.
3. Hvis kun dagspris findes, beregn ugeløn = dagspris * 5.
4. Hvis kun timepris findes, beregn ugeløn = timepris * 37, medmindre kontrakten udtrykkeligt siger 40 timer/uge.
5. Hvis kun klump/total findes, beregn kun ugeløn hvis antal uger/dage er sikkert angivet. Ellers returner null og marker til manuel kontrol.
6. Ignorer moms, subtotal, fakturatotal, betalingsrater, frokostfradrag, feriepenge og sociale omkostninger som løn, medmindre de udtrykkeligt er selve honoraret.
7. Ugeløn er grundløn/normalløn/honorar pr. uge.
8. Løntillæg er personligt tillæg/særligt tillæg pr. uge. Læg det ikke sammen med grundlønnen.
9. Pension er pensionsprocenten. Hvis både procent og kronebeløb står, returner procenten.
10. Ved faktura/leverandøraftale/contractor/lender/loan-out skal Leverandøraftale/faktura være JA.
11. Normaliser tal efter kontekst: dansk 14.637 = 14637, dansk 3.910,50 = 3910.50, engelsk 20,000 = 20000.
12. Ignorer placeholders som XX, x, blanke linjer, underscores og uvalgte formularfelter.
13. Hvis teksten er OCR-tom, ulæselig eller lønnen er tvetydig, returner null for usikre felter og marker til manuel kontrol.

Resultatet skal angives som et rent tal, uden valuta eller kommentarer.

Derudover skal importen returnere en kort løn-aflæsningsnote:

- salary_source_type: weekly, daily_converted, hourly_converted, lump_calculated, invoice_line eller unknown.
- salary_confidence: high, medium eller low.
- salary_note: kort forklaring af hvorfor ugelønnen er valgt.
- needs_manual_salary_review: true hvis lønnen er usikker, OCR-tom, ulæselig eller kræver manuel kontrol.

løntillæg
tillæg løn - null hvis der ikke er angivet tillæg i kontrakten
Læg ikke løntillæg sammen med grundlønnen. Grundlønnen står i ugeløn, og tillægget står i løntillæg.
Resultatet skal angives som et rent tal, uden kommentarer

pension  
Hvor mange procent pension er angivet i kontrakten. Resultatet skal angives som et rent tal, uden kommentarer

Leverandør aftale  
sæt et JA hvis leverandøraftale eller faktura er angivet i kontrakten \- sæt et NEJ hvis der ikke står noget omkring leverandøraftale eller faktura

Titel  
Titel på film, tv-Serie, dokumentarfilm eller serie

Type  
Type af produktion: TV-Serie, Spillefilm, Dokumentar, Dokumentar Serie

Navn  
Navn på klipper på kontrakten

Produktionsselskab  
Produktionsselskab

Kontrakt dato  
Kontrakt dato i formatet: DD/MM/ÅÅÅÅ

Overenskomst  
Overenskomst der refereres til i kontrakten: De4, FAF, Metal, Andet eller ingen

Rettighedsforbehold 
Er der et rettighedsforbehold i kontrakten?
Se eksempel på rettighedsforbehold i rettighedsforbehold.md 
Sæt Enten Copydan, SVOD, Royalties eller null
