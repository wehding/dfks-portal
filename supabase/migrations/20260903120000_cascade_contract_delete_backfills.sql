-- Migration: 20260903120000_cascade_contract_delete_backfills.sql
-- Sikrer at tekniske backfill-tabeller kaskaderer ved sletning af kontrakter,
-- og opdaterer delete_contracts_atomic til at rydde eventuelle restriktive referencer.

alter table public.contract_document_backfill_targets
  drop constraint if exists contract_document_backfill_targets_contract_id_fkey,
  add constraint contract_document_backfill_targets_contract_id_fkey
    foreign key (contract_id)
    references public.contracts(id)
    on delete cascade;

alter table public.contract_owner_backfill_items
  drop constraint if exists contract_owner_backfill_items_contract_id_fkey,
  add constraint contract_owner_backfill_items_contract_id_fkey
    foreign key (contract_id)
    references public.contracts(id)
    on delete cascade;

create or replace function public.delete_contracts_atomic(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if coalesce(cardinality(p_ids), 0) = 0 or cardinality(p_ids) > 500 then
    raise exception 'invalid contract delete batch';
  end if;

  -- Ryd op i eventuelle restriktive referencer før contracts slettes
  delete from public.contract_document_backfill_targets where contract_id = any(p_ids);
  delete from public.contract_owner_backfill_items where contract_id = any(p_ids);
  update public.contracts set superseded_by_contract_id = null where superseded_by_contract_id = any(p_ids);

  delete from public.contracts where id = any(p_ids);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_contracts_atomic(uuid[]) from public, anon, authenticated;
grant execute on function public.delete_contracts_atomic(uuid[]) to service_role;
