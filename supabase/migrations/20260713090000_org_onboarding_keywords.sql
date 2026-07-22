-- Onboarding-søgeord pr. organisation (terminology.onboarding_keywords):
-- afgør hvilke krediteringer person-søgningen i onboarding medtager.
-- DFKS seedes med klipper/editor-søgeord.
update organisations
set terminology = coalesce(terminology, '{}'::jsonb)
    || jsonb_build_object('onboarding_keywords', jsonb_build_array('klip', 'edit'))
where id = '3dfcad23-03ce-4de0-82f2-6566dfcd88a5'
  and (terminology is null or terminology->'onboarding_keywords' is null);
