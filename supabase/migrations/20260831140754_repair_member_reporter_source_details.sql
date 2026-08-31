-- En rettighedshaverindberettet deltager skal både have et kildetag og et
-- historisk snapshot af indberetteren. Den tidligere migration sprang rækker
-- over, hvis tagget allerede fandtes, selv om snapshotfeltet manglede.
update public.work_share_participants participant
set source_tags = array(
      select distinct source
      from unnest(coalesce(participant.source_tags, '{}'::text[]) || array['member']::text[]) source
      order by source
    ),
    source_details = (
      case
        when jsonb_typeof(participant.source_details) = 'object' then participant.source_details
        else '{}'::jsonb
      end
    ) || jsonb_build_object(
      'reportedByRightsHolderId', participant.invited_by_rights_holder_id
    ),
    updated_at = now()
where participant.invited_by_rights_holder_id is not null
  and (
    not ('member' = any(coalesce(participant.source_tags, '{}'::text[])))
    or participant.source_details ->> 'reportedByRightsHolderId'
      is distinct from participant.invited_by_rights_holder_id::text
  );
