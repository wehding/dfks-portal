-- Explicit deny policies make the intended server-only access visible to schema audits.
-- Browserrollerne har desuden ingen tabelgrants; service_role omgår RLS server-side.
create policy contract_import_batches_server_only on public.contract_import_batches
  for all to anon, authenticated using (false) with check (false);
create policy import_connections_server_only on public.import_connections
  for all to anon, authenticated using (false) with check (false);
create policy import_sources_server_only on public.import_sources
  for all to anon, authenticated using (false) with check (false);
create policy contract_import_items_server_only on public.contract_import_items
  for all to anon, authenticated using (false) with check (false);
create policy contract_file_fingerprints_server_only on public.contract_file_fingerprints
  for all to anon, authenticated using (false) with check (false);
create policy contract_episode_confirmations_server_only on public.contract_episode_confirmations
  for all to anon, authenticated using (false) with check (false);
