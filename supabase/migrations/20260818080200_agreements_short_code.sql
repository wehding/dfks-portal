-- Tilføj short_code til agreements.
-- Formål: gruppér flere tidsafgrænsede versioner af samme overenskomst under ét kanonisk kort id,
-- så dato-bevidst opslag kan finde den rigtige version uden statisk alias-mapping.
--
-- Eksempel: short_code = "faf-fiktion" dækker både "faf-fiction-2020" og "faf-fiction-2025".

alter table public.agreements
  add column if not exists short_code text;

create index if not exists agreements_short_code_idx on public.agreements(short_code);

-- ── Engangsudfyldning ud fra den nuværende statiske alias-mapping ──────────────
-- Mapping: agreements.code → kanonisk short_code
update public.agreements set short_code = 'de4-fiktion'   where code = 'de4-fiction-2022';
update public.agreements set short_code = 'faf-fiktion'   where code like 'faf-fiction-%';
update public.agreements set short_code = 'faf-dokumentar' where code like 'faf-documentary%';
update public.agreements set short_code = 'dj-tv'         where code like 'dj-tv-%';
update public.agreements set short_code = 'metal'         where code like 'dr-metal-%';

-- Fremtidige overenskomstversioner skal udfylde short_code ved oprettelse.
