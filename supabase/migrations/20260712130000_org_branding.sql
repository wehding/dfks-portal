-- White-label pr. forening: branding, fagord (terminologi) og afsender-mail.
-- Gør det muligt at portalen viser den rigtige forenings navn/logo/farve/ord,
-- og at systemmails sendes fra foreningens egen arbejdsmail.

alter table organisations
    add column if not exists branding    jsonb,
    add column if not exists terminology jsonb,
    add column if not exists from_email  text;

comment on column organisations.branding is
    'Visuel branding: { primary_color, short_name, long_name }. logo_url ligger som egen kolonne.';
comment on column organisations.terminology is
    'Fagord pr. faggruppe: { member_word, coeditor_word, role_labels[] } — fx klipper/medklipper vs. fotograf.';
comment on column organisations.from_email is
    'Foreningens arbejds-/afsendermail brugt som afsender på systemmails (fx invitationer).';

-- Seed DFKS' egne værdier (klipper-domænet) på den eksisterende forening.
update organisations
set
    branding = coalesce(branding, jsonb_build_object(
        'primary_color', '#111827',
        'short_name', 'DFKS',
        'long_name', 'Dansk Filmklipperselskab'
    )),
    terminology = coalesce(terminology, jsonb_build_object(
        'member_word', 'klipper',
        'coeditor_word', 'medklipper',
        'role_labels', jsonb_build_array('B-klipper', 'Klipper', 'Konceptuerende klipper')
    )),
    from_email = coalesce(from_email, contact_email, 'noreply@dfks.dk')
where id = '3dfcad23-03ce-4de0-82f2-6566dfcd88a5';
