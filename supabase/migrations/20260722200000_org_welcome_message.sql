-- Velkomstbesked pr. organisation: teksten redigeres under Opsætning → Organisation
-- og lægges automatisk som første tråd i nye medlemmers indbakke.
alter table organisations add column if not exists welcome_message_text text;
alter table rettighedshavere add column if not exists welcome_message_sent_at timestamptz;

-- DFKS seedes med standardvelkomsten.
update organisations
set welcome_message_text = 'Velkommen til DFKS'' medlemsportal! 🎬

Portalen samler dine værker, kontrakter og rettighedsudbetalinger ét sted:
• Mine værker — dine registrerede film og serier
• Mine kontrakter — upload og følg dine kontrakter
• Overblik — se altid, hvad der kræver din opmærksomhed

Har du brug for hjælp, er du altid velkommen til at kontakte sekretariatet — skriv blot et svar her i beskeden, så vender vi tilbage hurtigst muligt.

Mange hilsner
DFKS'' sekretariat'
where id = '3dfcad23-03ce-4de0-82f2-6566dfcd88a5'
  and welcome_message_text is null;
