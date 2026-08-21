-- Erstatter hardkodede titel-eksempler ("Borgen, Broen, Matador, Klovn...")
-- i grovsorter-prompten med en database-drevet tilgang: kendte, allerede
-- registrerede værker i works-tabellen behandles som validerede titler til
-- aftalelicens-sortering — MEDMINDRE en admin eksplicit har markeret værket
-- som ikke rettighedsberettiget (fx et værk uden gyldig klippekontrakt,
-- eller af anden årsag udelukket fra aftalelicens-vederlag).
--
-- Default true — de fleste registrerede værker ER rettighedsberettigede;
-- flaget er beregnet til den bevidste UNDTAGELSE, ikke normaltilstanden.

alter table public.works
  add column if not exists aftalelicens_rights_eligible boolean not null default true;

comment on column public.works.aftalelicens_rights_eligible is
  'Om værket er rettighedsberettiget til aftalelicens-vederlag. Default true. Sættes til false af en admin for at udelukke et specifikt værk fra automatisk godkendelse i grovsortering, uafhængigt af at værket i øvrigt er korrekt registreret.';
