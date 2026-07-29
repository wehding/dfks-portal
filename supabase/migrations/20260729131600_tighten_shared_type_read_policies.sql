drop policy if exists "Staff kan læse faggruppetyper" on public.profession_types;
create policy "Staff kan læse faggruppetyper" on public.profession_types
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "Staff kan læse producenttyper" on public.producer_categories;
create policy "Staff kan læse producenttyper" on public.producer_categories
  for select to authenticated using (auth.uid() is not null);
