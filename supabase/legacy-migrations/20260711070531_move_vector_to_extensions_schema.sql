-- Supabase Security Advisor recommends keeping extensions out of the exposed
-- public schema. The vector extension is relocatable and extensions is already
-- part of this project's database search_path.
create schema if not exists extensions;
alter extension vector set schema extensions;

-- These functions resolve the vector cosine-distance operator at runtime.
-- Keep both public tables and extension operators in a fixed search_path.
alter function public.match_knowledge_chunks(extensions.vector, double precision, integer)
  set search_path = pg_catalog, public, extensions, pg_temp;
alter function public.match_knowledge_chunks(extensions.vector, double precision, integer, uuid)
  set search_path = pg_catalog, public, extensions, pg_temp;
alter function public.match_learned_patterns(extensions.vector, double precision, integer)
  set search_path = pg_catalog, public, extensions, pg_temp;

notify pgrst, 'reload schema';
