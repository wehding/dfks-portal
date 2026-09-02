-- De4 § 22, stk. 2 a giver 1 % royalty for spillefilm. Den eksisterende
-- godkendte regel havde production_type = null og blev derfor anvendt på bl.a.
-- tv-serier. Afgræns kun de De4-regler, hvis retsgrundlag udtrykkeligt omtaler
-- spillefilm; individuelle kontraktvilkår har fortsat forrang i applikationen.
update public.agreement_percentage_rules as rule
set production_type = 'feature',
    updated_at = now()
from public.agreements as agreement
where rule.agreement_id = agreement.id
  and rule.label_key = 'royalty'
  and agreement.short_code = 'de4-fiktion'
  and lower(coalesce(rule.basis, '')) like '%spillefilm%'
  and rule.production_type is distinct from 'feature';
