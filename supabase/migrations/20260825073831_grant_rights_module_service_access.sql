-- Rettighedsmodulet tilgås gennem autoriserede server actions. RLS alene giver
-- ikke tabelrettigheder, så service_role skal have eksplicit adgang til de nye
-- tabeller. Browserrollerne får ingen yderligere grants her.
grant all on table
  public.distribution_policies,
  public.distribution_policy_components,
  public.distribution_policy_versions,
  public.inheritance_relations,
  public.payouts,
  public.payroll_export_batch_items,
  public.payroll_export_batches,
  public.payroll_recipient_references,
  public.reserve_entries,
  public.rights_adjustments,
  public.rights_admin_tasks,
  public.rights_allocations,
  public.rights_calculation_runs,
  public.rights_claims,
  public.rights_funds,
  public.rights_holder_search_publications,
  public.rights_notifications,
  public.rights_work_allocations,
  public.settlement_items,
  public.settlements,
  public.undistributable_fund_actions,
  public.withheld_beneficiary_positions
to service_role;
