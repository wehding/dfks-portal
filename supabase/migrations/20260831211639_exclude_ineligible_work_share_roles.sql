-- Afgrænset, reversibel reparation af de fejlagtigt importerede
-- klippeassistenter på værket Præsidenten. Historikken bevares via excluded_at.
update public.work_share_participants participant
set excluded_at = coalesce(participant.excluded_at, now()),
    updated_at = now()
from public.work_share_cases share_case
join public.works work on work.id = share_case.work_id
where participant.case_id = share_case.id
  and participant.excluded_at is null
  and lower(trim(work.title)) = lower('Præsidenten')
  and lower(trim(participant.role)) ~ '(klippeassistent|klipperassistent|assistant editor|assistant klipper)';
