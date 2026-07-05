-- Tilføj season_count (antal sæsoner) til works — bruges ved rettelse af serie-værker
alter table works add column if not exists season_count integer;
