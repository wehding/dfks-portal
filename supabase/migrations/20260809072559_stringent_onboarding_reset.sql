alter table public.rettighedshavere
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists onboarding_required_at timestamptz;

comment on column public.rettighedshavere.onboarding_completed_at is
  'Tidspunkt for senest fuldførte onboarding. Null betyder, at onboarding aldrig er fuldført.';
comment on column public.rettighedshavere.onboarding_required_at is
  'Tidspunkt hvor en administrator krævede ny onboarding. Kravet aktiveres ved næste login.';

-- Backfill gennemførte forløb. Det præcise historiske tidspunkt er ikke altid
-- tilgængeligt, så invitations- eller oprettelsestidspunkt bruges som stabilt
-- referencepunkt før alle fremtidige nulstillinger.
update public.rettighedshavere
set onboarding_completed_at = coalesce(invite_sent_at, created_at)
where onboarding_completed = true
  and onboarding_completed_at is null;

-- Genkend tidligere true -> false-nulstillinger fra den eksisterende auditlog.
-- Disse brugere har gennemført onboarding før, selv om legacy-booleanen nu er false.
with latest_reset as (
  select distinct on (event.entity_id)
    event.entity_id::uuid as rights_holder_id,
    event.occurred_at
  from public.audit_events event
  cross join lateral jsonb_array_elements(event.changes) change
  where event.entity_type = 'rettighedshavere'
    and event.entity_id is not null
    and change->>'field' = 'onboarding_completed'
    and change->'old' = 'true'::jsonb
    and change->'new' = 'false'::jsonb
  order by event.entity_id, event.occurred_at desc
)
update public.rettighedshavere holder
set onboarding_completed = true,
    onboarding_completed_at = coalesce(holder.onboarding_completed_at, holder.invite_sent_at, holder.created_at),
    onboarding_required_at = reset.occurred_at
from latest_reset reset
where holder.id = reset.rights_holder_id
  and holder.onboarding_completed = false;

create index if not exists rettighedshavere_onboarding_required_idx
  on public.rettighedshavere (onboarding_required_at)
  where onboarding_required_at is not null;

alter table public.audit_events drop constraint if exists audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (action in (
  'create','update','delete','archive','restore','validate','approve','merge','link','unlink',
  'invite','reset_link','export','download','import','sync','job','security_failure','retention',
  'require_onboarding','cancel_onboarding','complete_onboarding'
));
