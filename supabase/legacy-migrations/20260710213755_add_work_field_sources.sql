alter table works
  add column if not exists field_sources jsonb not null default '{}'::jsonb;

comment on column works.field_sources is
  'Kilde pr. værksfelt, fx {"year":"dfi","poster_url":"tmdb","title":"manual"}.';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'works_field_sources_object_check') then
    alter table works add constraint works_field_sources_object_check
      check (jsonb_typeof(field_sources) = 'object') not valid;
  end if;
end $$;

alter table works validate constraint works_field_sources_object_check;
