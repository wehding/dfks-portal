-- Identiske, samtidige rettelsesforslag må kun kunne være pending én gang.
-- JSONB har en kanonisk tekstrepræsentation, så payloadens md5 kan bruges som
-- kompakt indeksnøgle uden at gemme person- eller værkdata i en ny kolonne.
create unique index if not exists work_change_requests_pending_payload_unique_idx
  on public.work_change_requests (
    work_id,
    requested_by_user_id,
    (md5(proposed_data::text))
  )
  where status = 'pending'
    and requested_by_user_id is not null;

comment on index public.work_change_requests_pending_payload_unique_idx is
  'Forhindrer dobbeltklik og samtidige identiske rettelsesforslag fra samme bruger til samme værk.';
