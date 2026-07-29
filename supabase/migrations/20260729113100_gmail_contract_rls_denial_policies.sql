-- Eksplicitte deny-policies dokumenterer, at Gmail-metadata aldrig må læses
-- gennem browserroller. Service role omgår fortsat RLS til den interne import.
create policy "Browserroller har ingen adgang til Gmail-kontraktmails"
  on public.gmail_contract_messages
  for all
  to authenticated
  using (false)
  with check (false);

create policy "Browserroller har ingen adgang til Gmail-importtilstand"
  on public.gmail_contract_import_state
  for all
  to authenticated
  using (false)
  with check (false);
