-- Tilføj ai_status til contract_reviews
-- Bruges til at vise analysestatus i admin-indbakken i realtid
-- analyserer → AI er i gang | klar → analyse færdig | fejl → AI fejlede

alter table contract_reviews
  add column if not exists ai_status text not null default 'analyserer';

-- Eksisterende rækker med ai_result sat → marker som klar
update contract_reviews
  set ai_status = 'klar'
  where ai_result is not null
    and ai_result != '{}'::jsonb;
