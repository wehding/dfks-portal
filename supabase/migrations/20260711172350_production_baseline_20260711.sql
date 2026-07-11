--
-- PostgreSQL database dump
--

-- \restrict LmcuqwIjs7P5dr5Y24QrIjsHeicRZNgApkk1CV2PZq2t0TzWr0ATuygu3Tictx5

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
-- SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- Managed extension declarations are omitted by pg_dump. Production stores
-- pgvector outside the exposed public schema.
CREATE SCHEMA IF NOT EXISTS "extensions";
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";

--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: current_user_belongs_to_org("uuid"); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE OR REPLACE FUNCTION "private"."current_user_belongs_to_org"("target_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.user_org_roles role_row
    where role_row.user_id = (select auth.uid())
      and (role_row.org_id = target_org_id or role_row.role = 'superadmin')
  );
$$;


ALTER FUNCTION "private"."current_user_belongs_to_org"("target_org_id" "uuid") OWNER TO "postgres";

--
-- Name: current_user_can_admin_rights_holder("uuid"); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE OR REPLACE FUNCTION "private"."current_user_can_admin_rights_holder"("target_rights_holder_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    private.current_user_has_any_role(array['superadmin'])
    or exists (
      select 1
      from public.org_affiliations affiliation
      where affiliation.rights_holder_id = target_rights_holder_id
        and private.current_user_has_org_role(
          affiliation.org_id,
          array['superadmin','admin','org-admin']
        )
    );
$$;


ALTER FUNCTION "private"."current_user_can_admin_rights_holder"("target_rights_holder_id" "uuid") OWNER TO "postgres";

--
-- Name: current_user_has_any_role("text"[]); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE OR REPLACE FUNCTION "private"."current_user_has_any_role"("allowed_roles" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.user_org_roles role_row
    where role_row.user_id = (select auth.uid())
      and role_row.role = any(allowed_roles)
  );
$$;


ALTER FUNCTION "private"."current_user_has_any_role"("allowed_roles" "text"[]) OWNER TO "postgres";

--
-- Name: current_user_has_org_role("uuid", "text"[]); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE OR REPLACE FUNCTION "private"."current_user_has_org_role"("target_org_id" "uuid", "allowed_roles" "text"[] DEFAULT NULL::"text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.user_org_roles role_row
    where role_row.user_id = (select auth.uid())
      and (allowed_roles is null or role_row.role = any(allowed_roles))
      and (
        role_row.org_id = target_org_id
        or (role_row.role = 'superadmin' and allowed_roles is not null and 'superadmin' = any(allowed_roles))
      )
  );
$$;


ALTER FUNCTION "private"."current_user_has_org_role"("target_org_id" "uuid", "allowed_roles" "text"[]) OWNER TO "postgres";

--
-- Name: current_user_is_assigned_to_work("uuid"); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE OR REPLACE FUNCTION "private"."current_user_is_assigned_to_work"("target_work_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.work_assignments assignment
    join public.rettighedshavere holder on holder.id = assignment.rights_holder_id
    where assignment.work_id = target_work_id
      and holder.user_id = (select auth.uid())
  );
$$;


ALTER FUNCTION "private"."current_user_is_assigned_to_work"("target_work_id" "uuid") OWNER TO "postgres";

--
-- Name: current_user_owns_contract("uuid"); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE OR REPLACE FUNCTION "private"."current_user_owns_contract"("target_contract_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.contracts contract_row
    where contract_row.id = target_contract_id
      and private.current_user_owns_rights_holder(contract_row.rights_holder_id)
  );
$$;


ALTER FUNCTION "private"."current_user_owns_contract"("target_contract_id" "uuid") OWNER TO "postgres";

--
-- Name: current_user_owns_rights_holder("uuid"); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE OR REPLACE FUNCTION "private"."current_user_owns_rights_holder"("target_rights_holder_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.rettighedshavere holder
    where holder.id = target_rights_holder_id
      and holder.user_id = (select auth.uid())
  );
$$;


ALTER FUNCTION "private"."current_user_owns_rights_holder"("target_rights_holder_id" "uuid") OWNER TO "postgres";

--
-- Name: auth_rights_holder_id(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."auth_rights_holder_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select holder.id
  from public.rettighedshavere holder
  where holder.user_id = (select auth.uid())
  limit 1;
$$;


ALTER FUNCTION "public"."auth_rights_holder_id"() OWNER TO "postgres";

--
-- Name: claim_next_contract_ai_job("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."claim_next_contract_ai_job"("p_job_id" "uuid" DEFAULT NULL::"uuid", "p_org_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "contract_id" "uuid", "org_id" "uuid", "attempts" integer, "pdf_url" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    with picked as (
        select j.id
        from contract_ai_jobs j
        join contracts c on c.id = j.contract_id
        where (
                j.status = 'queued'
                or (j.status = 'error' and j.attempts < 3)
                or (j.status = 'processing' and j.started_at < now() - interval '15 minutes')
              )
          and (p_job_id is null or j.id = p_job_id)
          and (p_org_id is null or j.org_id = p_org_id)
        order by j.priority asc, j.created_at asc
        limit 1
        for update skip locked
    ),
    updated as (
        update contract_ai_jobs j
        set status = 'processing',
            attempts = j.attempts + 1,
            started_at = now(),
            updated_at = now(),
            error_message = null
        from picked
        where j.id = picked.id
        returning j.id, j.contract_id, j.org_id, j.attempts
    )
    select u.id, u.contract_id, u.org_id, u.attempts, c.pdf_url
    from updated u
    join contracts c on c.id = u.contract_id;
$$;


ALTER FUNCTION "public"."claim_next_contract_ai_job"("p_job_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";

--
-- Name: current_user_belongs_to_org("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."current_user_belongs_to_org"("target_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select private.current_user_belongs_to_org(target_org_id); $$;


ALTER FUNCTION "public"."current_user_belongs_to_org"("target_org_id" "uuid") OWNER TO "postgres";

--
-- Name: current_user_can_admin_rights_holder("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."current_user_can_admin_rights_holder"("target_rights_holder_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select private.current_user_can_admin_rights_holder(target_rights_holder_id); $$;


ALTER FUNCTION "public"."current_user_can_admin_rights_holder"("target_rights_holder_id" "uuid") OWNER TO "postgres";

--
-- Name: current_user_has_any_role("text"[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."current_user_has_any_role"("allowed_roles" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select private.current_user_has_any_role(allowed_roles); $$;


ALTER FUNCTION "public"."current_user_has_any_role"("allowed_roles" "text"[]) OWNER TO "postgres";

--
-- Name: current_user_has_org_role("uuid", "text"[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."current_user_has_org_role"("target_org_id" "uuid", "allowed_roles" "text"[] DEFAULT NULL::"text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select private.current_user_has_org_role(target_org_id, allowed_roles); $$;


ALTER FUNCTION "public"."current_user_has_org_role"("target_org_id" "uuid", "allowed_roles" "text"[]) OWNER TO "postgres";

--
-- Name: current_user_is_assigned_to_work("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."current_user_is_assigned_to_work"("target_work_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select private.current_user_is_assigned_to_work(target_work_id); $$;


ALTER FUNCTION "public"."current_user_is_assigned_to_work"("target_work_id" "uuid") OWNER TO "postgres";

--
-- Name: current_user_owns_contract("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."current_user_owns_contract"("target_contract_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select private.current_user_owns_contract(target_contract_id); $$;


ALTER FUNCTION "public"."current_user_owns_contract"("target_contract_id" "uuid") OWNER TO "postgres";

--
-- Name: current_user_owns_rights_holder("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."current_user_owns_rights_holder"("target_rights_holder_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select private.current_user_owns_rights_holder(target_rights_holder_id); $$;


ALTER FUNCTION "public"."current_user_owns_rights_holder"("target_rights_holder_id" "uuid") OWNER TO "postgres";

--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    insert into rettighedshavere (user_id, full_name, email)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'full_name', ''),
        new.email
    );
    return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";

--
-- Name: is_org_admin("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."is_org_admin"("check_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select private.current_user_has_org_role(
    check_org_id,
    array['superadmin','admin','org-admin']
  );
$$;


ALTER FUNCTION "public"."is_org_admin"("check_org_id" "uuid") OWNER TO "postgres";

--
-- Name: match_knowledge_chunks("extensions"."vector", double precision, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."match_knowledge_chunks"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer) RETURNS TABLE("kilde_id" "text", "kilde_titel" "text", "tekst" "text", "metadata" "jsonb", "similaritet" double precision)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select
    kilde_id,
    kilde_titel,
    tekst,
    metadata,
    1 - (embedding <=> query_embedding) as similaritet
  from knowledge_chunks
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;


ALTER FUNCTION "public"."match_knowledge_chunks"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer) OWNER TO "postgres";

--
-- Name: match_knowledge_chunks("extensions"."vector", double precision, integer, "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."match_knowledge_chunks"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer, "p_org_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("kilde_id" "text", "kilde_titel" "text", "tekst" "text", "metadata" "jsonb", "similaritet" double precision)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select kilde_id, kilde_titel, tekst, metadata,
    1 - (embedding <=> query_embedding) as similaritet
  from knowledge_chunks
  where 1 - (embedding <=> query_embedding) > match_threshold
    and (p_org_id is null or org_id is null or org_id = p_org_id)
  order by embedding <=> query_embedding
  limit match_count;
$$;


ALTER FUNCTION "public"."match_knowledge_chunks"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer, "p_org_id" "uuid") OWNER TO "postgres";

--
-- Name: match_learned_patterns("extensions"."vector", double precision, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."match_learned_patterns"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer) RETURNS TABLE("id" "uuid", "titel" "text", "regel" "text", "semantisk_beskrivelse" "text", "similaritet" double precision)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select id, titel, regel, semantisk_beskrivelse,
    1 - (embedding <=> query_embedding) as similaritet
  from learned_patterns
  where aktiv = true
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;


ALTER FUNCTION "public"."match_learned_patterns"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer) OWNER TO "postgres";

--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

--
-- Name: update_contract_reviews_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."update_contract_reviews_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_contract_reviews_updated_at"() OWNER TO "postgres";

--
-- Name: upsert_work_for_member("uuid", "text", "text", integer, "text", integer, "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."upsert_work_for_member"("p_org_id" "uuid", "p_title" "text", "p_type" "text", "p_year" integer DEFAULT NULL::integer, "p_dfi_id" "text" DEFAULT NULL::"text", "p_tmdb_id" integer DEFAULT NULL::integer, "p_description" "text" DEFAULT NULL::"text", "p_poster_url" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_id uuid;
begin
    -- Find eksisterende
    if p_dfi_id is not null then
        select id into v_id from works where dfi_id = p_dfi_id limit 1;
    end if;
    if v_id is null and p_tmdb_id is not null then
        select id into v_id from works where tmdb_id = p_tmdb_id limit 1;
    end if;
    -- Opret nyt
    if v_id is null then
        insert into works (org_id, title, type, year, dfi_id, tmdb_id, description, poster_url)
        values (p_org_id, p_title, p_type, p_year, p_dfi_id, p_tmdb_id, p_description, p_poster_url)
        returning id into v_id;
    end if;
    return v_id;
end;
$$;


ALTER FUNCTION "public"."upsert_work_for_member"("p_org_id" "uuid", "p_title" "text", "p_type" "text", "p_year" integer, "p_dfi_id" "text", "p_tmdb_id" integer, "p_description" "text", "p_poster_url" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: admin_message_deletion_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."admin_message_deletion_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "admin_user_id" "uuid",
    "thread_kind" "text" NOT NULL,
    "thread_id" "uuid" NOT NULL,
    "message_id" "uuid",
    "action" "text" NOT NULL,
    "deleted_count" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "admin_message_deletion_audit_action_check" CHECK (("action" = ANY (ARRAY['delete_message'::"text", 'clear_thread'::"text"]))),
    CONSTRAINT "admin_message_deletion_audit_deleted_count_check" CHECK (("deleted_count" >= 0)),
    CONSTRAINT "admin_message_deletion_audit_thread_kind_check" CHECK (("thread_kind" = ANY (ARRAY['work'::"text", 'contract'::"text", 'screening'::"text"])))
);


ALTER TABLE "public"."admin_message_deletion_audit" OWNER TO "postgres";

--
-- Name: agreements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."agreements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "title" "text" NOT NULL,
    "doc_type" "text" DEFAULT 'overenskomst'::"text" NOT NULL,
    "content_url" "text",
    "is_primary" boolean DEFAULT false NOT NULL,
    "valid_from" "date",
    "valid_to" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."agreements" OWNER TO "postgres";

--
-- Name: analysis_feedback; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."analysis_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "analyse_id" "text" NOT NULL,
    "kontrakt_hash" "text",
    "fund_id" "text" NOT NULL,
    "fund_titel" "text" NOT NULL,
    "fund_svaerhedsgrad" "text" NOT NULL,
    "fund_beskrivelse" "text",
    "godkendt" boolean NOT NULL,
    "korrektion_svaerhedsgrad" "text",
    "korrektion_beskrivelse" "text",
    "skal_ignoreres" boolean DEFAULT false,
    "reviewet_af" "text",
    "org_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "highlight_succes" boolean,
    "anker_metode" "text",
    "anker_original" "text",
    "anker_valgt" "text",
    "jurist_korrektion" "text",
    "skal_tilfojes_overrides" boolean DEFAULT false
);


ALTER TABLE "public"."analysis_feedback" OWNER TO "postgres";

--
-- Name: broadcasters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."broadcasters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "logo_source_url" "text" NOT NULL,
    "logo_path" "text" NOT NULL,
    "content_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."broadcasters" OWNER TO "postgres";

--
-- Name: case_learnings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."case_learnings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "kontrakttype" "text" DEFAULT 'alle'::"text" NOT NULL,
    "titel" "text" NOT NULL,
    "regel" "text" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kilde_type" "text" DEFAULT 'sagserfaring'::"text",
    "produktionstype" "text",
    "er_overenskomst" boolean,
    "kontrakttitel" "text",
    "producent_type" "text",
    "ai_analyse" "jsonb",
    "feedbackmail" "text",
    "noter" "text",
    "godkendt_af" "text"
);


ALTER TABLE "public"."case_learnings" OWNER TO "postgres";

--
-- Name: contract_ai_jobs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."contract_ai_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "priority" integer DEFAULT 100 NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "error_message" "text",
    "masked_text" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contract_ai_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'processing'::"text", 'done'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."contract_ai_jobs" OWNER TO "postgres";

--
-- Name: contract_attachments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."contract_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'allonge'::"text" NOT NULL,
    "title" "text",
    "pdf_url" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ai_status" "text" DEFAULT 'analyserer'::"text",
    "ai_result" "jsonb"
);


ALTER TABLE "public"."contract_attachments" OWNER TO "postgres";

--
-- Name: contract_comments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."contract_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "author_user_id" "uuid",
    "author_role" "text" NOT NULL,
    "message" "text" NOT NULL,
    "member_read_at" timestamp with time zone,
    "admin_read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contract_comments_message_check" CHECK (("length"(TRIM(BOTH FROM "message")) > 0)),
    CONSTRAINT "contract_comments_role_check" CHECK (("author_role" = ANY (ARRAY['member'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."contract_comments" OWNER TO "postgres";

--
-- Name: contract_episodes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."contract_episodes" (
    "contract_id" "uuid" NOT NULL,
    "episode_id" "uuid" NOT NULL
);


ALTER TABLE "public"."contract_episodes" OWNER TO "postgres";

--
-- Name: contract_reviews; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."contract_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contract_id" "uuid",
    "org_id" "uuid" NOT NULL,
    "member_name" "text",
    "member_email" "text",
    "ai_result" "jsonb",
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone DEFAULT "now"(),
    "member_id" "uuid",
    "file_name" "text",
    "file_size_bytes" integer,
    "contract_type" "text",
    "production_type" "text",
    "distribution_channels" "text"[],
    "producer_name" "text",
    "producer_dfks_id" "text",
    "producer_dfi_id" "text",
    "producer_overenskomst_bound" boolean,
    "focus_areas" "text"[],
    "notes" "text",
    "status" "text" DEFAULT 'afventer'::"text" NOT NULL,
    "assigned_to" "uuid",
    "storage_path" "text",
    "ai_run_at" timestamp with time zone,
    "ai_language" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "jurist_response" "text",
    "jurist_response_at" timestamp with time zone,
    "risk_level" "text",
    "should_escalate" boolean,
    "ai_status" "text" DEFAULT 'analyserer'::"text" NOT NULL,
    "compliance_extract" "jsonb"
);


ALTER TABLE "public"."contract_reviews" OWNER TO "postgres";

--
-- Name: contract_validations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."contract_validations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "holiday_pay_rate" numeric(5,2),
    "beta_rate" numeric(5,2),
    "has_credit_clause" boolean,
    "has_termination_clause" boolean,
    "termination_days_editor" integer,
    "termination_days_producer" integer,
    "has_indemnification" boolean,
    "has_overenskomst_incorporation" boolean,
    "notes" "text",
    "validated_by" "uuid",
    "validated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "extracted_data" "jsonb",
    "bruger_redigerede_felter" "text"[] DEFAULT '{}'::"text"[]
);


ALTER TABLE "public"."contract_validations" OWNER TO "postgres";

--
-- Name: contracts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."contracts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "employer_id" "uuid",
    "work_id" "uuid",
    "rights_holder_id" "uuid",
    "type" "text" NOT NULL,
    "overenskomst" "text",
    "status" "text" DEFAULT 'kladde'::"text" NOT NULL,
    "pdf_url" "text",
    "contract_date" "date",
    "start_date" "date",
    "end_date" "date",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "working_title" "text"
);


ALTER TABLE "public"."contracts" OWNER TO "postgres";

--
-- Name: employer_registries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."employer_registries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employer_id" "uuid" NOT NULL,
    "association_name" "text" NOT NULL,
    "valid_from" "date",
    "valid_to" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."employer_registries" OWNER TO "postgres";

--
-- Name: employers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."employers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "cvr" "text",
    "address" "text",
    "contact_name" "text",
    "contact_email" "text",
    "contact_phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "parent_id" "uuid",
    "dfi_company_id" integer,
    "website" "text",
    "associeret" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."employers" OWNER TO "postgres";

--
-- Name: COLUMN "employers"."associeret"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."employers"."associeret" IS 'Associeret medlem af Producentforeningen — ikke overenskomstbundet';


--
-- Name: episodes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."episodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "work_id" "uuid" NOT NULL,
    "episode_number" integer NOT NULL,
    "title" "text",
    "duration_minutes" integer,
    "produktionsnr" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."episodes" OWNER TO "postgres";

--
-- Name: knowledge_chunks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."knowledge_chunks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kilde_id" "text" NOT NULL,
    "kilde_type" "text" DEFAULT 'lovtekst'::"text" NOT NULL,
    "kilde_titel" "text" NOT NULL,
    "tekst" "text" NOT NULL,
    "org_id" "uuid",
    "metadata" "jsonb",
    "embedding" "extensions"."vector"(768),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "sidst_opdateret" timestamp with time zone DEFAULT "now"(),
    "overenskomst" "text",
    "kategori" "text",
    "gyldig_fra" "date",
    "aktiv" boolean DEFAULT true
);


ALTER TABLE "public"."knowledge_chunks" OWNER TO "postgres";

--
-- Name: learned_patterns; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."learned_patterns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "titel" "text" NOT NULL,
    "regel" "text" NOT NULL,
    "semantisk_beskrivelse" "text" NOT NULL,
    "embedding" "extensions"."vector"(768),
    "kilde_feedback_id" "uuid",
    "godkendt_af" "text",
    "aktiv" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."learned_patterns" OWNER TO "postgres";

--
-- Name: legal_note_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."legal_note_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "note_id" "uuid" NOT NULL,
    "changed_by" "uuid",
    "org_id" "uuid",
    "old_value" "jsonb" NOT NULL,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."legal_note_history" OWNER TO "postgres";

--
-- Name: legal_notes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."legal_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "scope" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "priority" "text" DEFAULT 'orientering'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "exclude_for_overenskomst" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gyldig_fra" "date",
    "gyldig_til" "date"
);


ALTER TABLE "public"."legal_notes" OWNER TO "postgres";

--
-- Name: org_affiliations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."org_affiliations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "rights_holder_id" "uuid" NOT NULL,
    "is_member" boolean DEFAULT false NOT NULL,
    "member_no" "text",
    "valid_from" "date",
    "valid_to" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."org_affiliations" OWNER TO "postgres";

--
-- Name: organisations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."organisations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "logo_url" "text",
    "features" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cvr" "text",
    "contact_name" "text",
    "contact_email" "text",
    "plan" "text" DEFAULT 'basis'::"text" NOT NULL,
    "max_users" integer DEFAULT 5 NOT NULL,
    "module_contracts" boolean DEFAULT false NOT NULL,
    "module_streaming" boolean DEFAULT false NOT NULL,
    "module_archive" boolean DEFAULT false NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."organisations" OWNER TO "postgres";

--
-- Name: overenskomst_satser; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."overenskomst_satser" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "overenskomst" "text" NOT NULL,
    "kategori" "text" NOT NULL,
    "beskrivelse" "text" NOT NULL,
    "vaerdi" numeric NOT NULL,
    "enhed" "text" NOT NULL,
    "gyldig_fra" "date" NOT NULL,
    "gyldig_til" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "overenskomst_satser_enhed_check" CHECK (("enhed" = ANY (ARRAY['kr/uge'::"text", 'kr/dag'::"text", 'kr/time'::"text", '%'::"text"])))
);


ALTER TABLE "public"."overenskomst_satser" OWNER TO "postgres";

--
-- Name: overenskomst_uploads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."overenskomst_uploads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "navn" "text" NOT NULL,
    "overenskomst" "text" NOT NULL,
    "gyldig_fra" "date" NOT NULL,
    "original_filnavn" "text",
    "uploadet_af" "text",
    "status" "text" DEFAULT 'afventer'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."overenskomst_uploads" OWNER TO "postgres";

--
-- Name: reference_docs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."reference_docs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "title" "text" NOT NULL,
    "url" "text",
    "doc_type" "text" DEFAULT 'dokument'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "doc_subtype" "text",
    "owner" "text" DEFAULT 'de4'::"text" NOT NULL,
    "content_text" "text",
    "file_name" "text",
    "archived" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."reference_docs" OWNER TO "postgres";

--
-- Name: rettighedshavere; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."rettighedshavere" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "full_name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "address" "text",
    "cpr_no" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "bank_account" "text",
    "onboarding_completed" boolean DEFAULT false NOT NULL,
    "dfi_person_id" bigint,
    "opt_out_statistics" boolean DEFAULT false NOT NULL,
    "alternative_names" "text"[] DEFAULT '{}'::"text"[],
    "tmdb_person_id" bigint,
    "wikidata_qid" "text",
    "imdb_nm" "text"
);


ALTER TABLE "public"."rettighedshavere" OWNER TO "postgres";

--
-- Name: screening_claim_comments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."screening_claim_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "claim_id" "uuid" NOT NULL,
    "author_user_id" "uuid",
    "author_role" "text" NOT NULL,
    "message" "text" NOT NULL,
    "member_read_at" timestamp with time zone,
    "admin_read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "screening_claim_comments_message_check" CHECK (("length"(TRIM(BOTH FROM "message")) > 0)),
    CONSTRAINT "screening_claim_comments_role_check" CHECK (("author_role" = ANY (ARRAY['member'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."screening_claim_comments" OWNER TO "postgres";

--
-- Name: screening_claims; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."screening_claims" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "work_id" "uuid" NOT NULL,
    "broadcaster_id" "uuid",
    "title" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "screening_date" "date" NOT NULL,
    "season" integer,
    "episode" integer,
    "note" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "screening_claims_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."screening_claims" OWNER TO "postgres";

--
-- Name: user_org_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_org_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_org_roles" OWNER TO "postgres";

--
-- Name: work_airings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."work_airings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "work_id" "uuid",
    "source" "text" DEFAULT 'simplytv'::"text" NOT NULL,
    "channel" "text",
    "channel_name" "text",
    "broadcast_start_at" timestamp with time zone,
    "broadcast_date" "date",
    "broadcast_time" time without time zone,
    "duration_minutes" integer,
    "listing_id" "text",
    "series_id" "text",
    "season_id" "text",
    "episode_id" "text",
    "editorial_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "broadcaster_id" "uuid"
);


ALTER TABLE "public"."work_airings" OWNER TO "postgres";

--
-- Name: TABLE "work_airings"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."work_airings" IS 'Sendeflade-/EPG-data fra SimplyTV/DK4. Disse felter er airing-data, ikke grundlæggende værksmetadata.';


--
-- Name: COLUMN "work_airings"."duration_minutes"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."work_airings"."duration_minutes" IS 'Sendefladens varighed. Importlogik kan kun kopiere til works.duration_minutes, hvis værkets varighed mangler og værdien er vurderet som værkslængde.';


--
-- Name: COLUMN "work_airings"."listing_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."work_airings"."listing_id" IS 'SimplyTV/DK4 Listing Id for den konkrete udsendelse.';


--
-- Name: COLUMN "work_airings"."broadcaster_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."work_airings"."broadcaster_id" IS 'Kobling fra SimplyTV/DK4 Channel/Channel Name til portalens broadcaster/streamer-register. channel/channel_name bevares som rå importværdi.';


--
-- Name: work_assignments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."work_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "work_id" "uuid" NOT NULL,
    "episode_id" "uuid",
    "org_id" "uuid" NOT NULL,
    "rights_holder_id" "uuid",
    "role" "text" NOT NULL,
    "contract_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "share_percent" numeric
);


ALTER TABLE "public"."work_assignments" OWNER TO "postgres";

--
-- Name: work_change_request_comments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."work_change_request_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_id" "uuid" NOT NULL,
    "author_user_id" "uuid",
    "author_role" "text" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "member_read_at" timestamp with time zone,
    "admin_read_at" timestamp with time zone,
    CONSTRAINT "work_change_request_comments_message_check" CHECK (("length"(TRIM(BOTH FROM "message")) > 0)),
    CONSTRAINT "work_change_request_comments_role_check" CHECK (("author_role" = ANY (ARRAY['member'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."work_change_request_comments" OWNER TO "postgres";

--
-- Name: work_change_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."work_change_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "work_id" "uuid" NOT NULL,
    "requested_by_user_id" "uuid",
    "requested_by_rights_holder_id" "uuid",
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "old_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "proposed_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewed_by_user_id" "uuid",
    "reviewed_at" timestamp with time zone,
    "admin_comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "work_change_requests_source_check" CHECK (("length"(TRIM(BOTH FROM "source")) > 0)),
    CONSTRAINT "work_change_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."work_change_requests" OWNER TO "postgres";

--
-- Name: work_distributions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."work_distributions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "work_id" "uuid" NOT NULL,
    "broadcaster_id" "uuid",
    "broadcaster_name" "text",
    "distribution_type" "text" DEFAULT 'both'::"text" NOT NULL,
    "valid_from_year" integer,
    "valid_to_year" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "work_distributions_name_check" CHECK ((("broadcaster_id" IS NOT NULL) OR ("length"(TRIM(BOTH FROM "broadcaster_name")) > 0))),
    CONSTRAINT "work_distributions_type_check" CHECK (("distribution_type" = ANY (ARRAY['tv'::"text", 'streaming'::"text", 'both'::"text"]))),
    CONSTRAINT "work_distributions_year_check" CHECK (((("valid_from_year" IS NULL) OR (("valid_from_year" >= 1888) AND ("valid_from_year" <= 2200))) AND (("valid_to_year" IS NULL) OR (("valid_to_year" >= 1888) AND ("valid_to_year" <= 2200))) AND (("valid_from_year" IS NULL) OR ("valid_to_year" IS NULL) OR ("valid_to_year" >= "valid_from_year"))))
);


ALTER TABLE "public"."work_distributions" OWNER TO "postgres";

--
-- Name: work_external_ids; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."work_external_ids" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "work_id" "uuid",
    "source" "text" NOT NULL,
    "external_id_type" "text" NOT NULL,
    "external_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."work_external_ids" OWNER TO "postgres";

--
-- Name: TABLE "work_external_ids"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."work_external_ids" IS 'Eksterne værk-id’er fra kilder som DFI, TMDB og SimplyTV/DK4. Listing-id’er for konkrete udsendelser ligger i work_airings.';


--
-- Name: COLUMN "work_external_ids"."source"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."work_external_ids"."source" IS 'Eksempel: dfi, tmdb, simplytv, dk4.';


--
-- Name: COLUMN "work_external_ids"."external_id_type"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."work_external_ids"."external_id_type" IS 'Eksempel: film_id, program_id, series_id, season_id, episode_id.';


--
-- Name: work_production_numbers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."work_production_numbers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "work_id" "uuid" NOT NULL,
    "tv_station" "text" NOT NULL,
    "number" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."work_production_numbers" OWNER TO "postgres";

--
-- Name: works; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."works" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "employer_id" "uuid",
    "title" "text" NOT NULL,
    "type" "text" DEFAULT 'fiktion'::"text" NOT NULL,
    "year" integer,
    "duration_minutes" integer,
    "episode_count" integer,
    "genre" "text",
    "status" "text" DEFAULT 'aktiv'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dfi_id" "text",
    "tmdb_id" "text",
    "description" "text",
    "poster_url" "text",
    "dfi_metadata" "jsonb",
    "alternative_titles" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "production_countries" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "production_companies" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "director" "text",
    "dfi_title" "text",
    "dfi_danish_title" "text",
    "dfi_original_title" "text",
    "dfi_category" "text",
    "dfi_type" "text",
    "season_count" integer,
    "parent_work_id" "uuid",
    "season_number" integer,
    "episode_number" integer,
    "imdb_id" "text",
    "field_sources" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "wikidata_id" "text",
    CONSTRAINT "works_field_sources_object_check" CHECK (("jsonb_typeof"("field_sources") = 'object'::"text"))
);


ALTER TABLE "public"."works" OWNER TO "postgres";

--
-- Name: COLUMN "works"."alternative_titles"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."works"."alternative_titles" IS 'Alternative titler fra fx DFI AltTitle og evt. importkilder. Ikke en erstatning for works.title.';


--
-- Name: COLUMN "works"."production_countries"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."works"."production_countries" IS 'Normaliseret liste over produktionslande fra DFI ProductionCountries eller DK4 Country1/Country2.';


--
-- Name: COLUMN "works"."production_companies"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."works"."production_companies" IS 'Normaliseret liste over produktionsselskaber fra DFI ProductionCompanies eller DK4 Company of production-felter.';


--
-- Name: COLUMN "works"."director"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."works"."director" IS 'Instruktør/navn(e) for værket. Kan komme fra DFI PersonCredits eller indtastes manuelt.';


--
-- Name: COLUMN "works"."dfi_title"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."works"."dfi_title" IS 'DFI Title fra /v1/film/{id}. Separat fra works.title, som er portalens primære titel.';


--
-- Name: COLUMN "works"."dfi_danish_title"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."works"."dfi_danish_title" IS 'DFI DanishTitle fra /v1/film/{id}.';


--
-- Name: COLUMN "works"."dfi_original_title"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."works"."dfi_original_title" IS 'DFI OriginalTitle fra /v1/film/{id}. Vises i UI som Original / work Title.';


--
-- Name: COLUMN "works"."dfi_category"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."works"."dfi_category" IS 'DFI Category fra /v1/film/{id}. Separat fra portalens normaliserede værktype.';


--
-- Name: COLUMN "works"."dfi_type"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."works"."dfi_type" IS 'DFI Type fra /v1/film/{id}. Separat fra portalens normaliserede værktype.';


--
-- Name: COLUMN "works"."imdb_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."works"."imdb_id" IS 'IMDb-id (fx tt1234567) hentet gratis via TMDB /external_ids.';


--
-- Name: COLUMN "works"."field_sources"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."works"."field_sources" IS 'Kilde pr. værksfelt, fx {"year":"dfi","poster_url":"tmdb","title":"manual"}.';


--
-- Name: admin_message_deletion_audit admin_message_deletion_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."admin_message_deletion_audit"
    ADD CONSTRAINT "admin_message_deletion_audit_pkey" PRIMARY KEY ("id");


--
-- Name: agreements agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."agreements"
    ADD CONSTRAINT "agreements_pkey" PRIMARY KEY ("id");


--
-- Name: analysis_feedback analysis_feedback_analyse_fund_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."analysis_feedback"
    ADD CONSTRAINT "analysis_feedback_analyse_fund_unique" UNIQUE ("analyse_id", "fund_id");


--
-- Name: analysis_feedback analysis_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."analysis_feedback"
    ADD CONSTRAINT "analysis_feedback_pkey" PRIMARY KEY ("id");


--
-- Name: broadcasters broadcasters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."broadcasters"
    ADD CONSTRAINT "broadcasters_pkey" PRIMARY KEY ("id");


--
-- Name: case_learnings case_learnings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."case_learnings"
    ADD CONSTRAINT "case_learnings_pkey" PRIMARY KEY ("id");


--
-- Name: contract_ai_jobs contract_ai_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_ai_jobs"
    ADD CONSTRAINT "contract_ai_jobs_pkey" PRIMARY KEY ("id");


--
-- Name: contract_attachments contract_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_attachments"
    ADD CONSTRAINT "contract_attachments_pkey" PRIMARY KEY ("id");


--
-- Name: contract_comments contract_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_comments"
    ADD CONSTRAINT "contract_comments_pkey" PRIMARY KEY ("id");


--
-- Name: contract_episodes contract_episodes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_episodes"
    ADD CONSTRAINT "contract_episodes_pkey" PRIMARY KEY ("contract_id", "episode_id");


--
-- Name: contract_reviews contract_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_reviews"
    ADD CONSTRAINT "contract_reviews_pkey" PRIMARY KEY ("id");


--
-- Name: contract_validations contract_validations_contract_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_validations"
    ADD CONSTRAINT "contract_validations_contract_id_key" UNIQUE ("contract_id");


--
-- Name: contract_validations contract_validations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_validations"
    ADD CONSTRAINT "contract_validations_pkey" PRIMARY KEY ("id");


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_pkey" PRIMARY KEY ("id");


--
-- Name: employer_registries employer_registries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."employer_registries"
    ADD CONSTRAINT "employer_registries_pkey" PRIMARY KEY ("id");


--
-- Name: employers employers_name_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."employers"
    ADD CONSTRAINT "employers_name_unique" UNIQUE ("name");


--
-- Name: employers employers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."employers"
    ADD CONSTRAINT "employers_pkey" PRIMARY KEY ("id");


--
-- Name: episodes episodes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episodes_pkey" PRIMARY KEY ("id");


--
-- Name: episodes episodes_work_id_episode_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episodes_work_id_episode_number_key" UNIQUE ("work_id", "episode_number");


--
-- Name: knowledge_chunks knowledge_chunks_kilde_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."knowledge_chunks"
    ADD CONSTRAINT "knowledge_chunks_kilde_id_key" UNIQUE ("kilde_id");


--
-- Name: knowledge_chunks knowledge_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."knowledge_chunks"
    ADD CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id");


--
-- Name: learned_patterns learned_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."learned_patterns"
    ADD CONSTRAINT "learned_patterns_pkey" PRIMARY KEY ("id");


--
-- Name: legal_note_history legal_note_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."legal_note_history"
    ADD CONSTRAINT "legal_note_history_pkey" PRIMARY KEY ("id");


--
-- Name: legal_notes legal_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."legal_notes"
    ADD CONSTRAINT "legal_notes_pkey" PRIMARY KEY ("id");


--
-- Name: org_affiliations org_affiliations_org_id_rights_holder_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."org_affiliations"
    ADD CONSTRAINT "org_affiliations_org_id_rights_holder_id_key" UNIQUE ("org_id", "rights_holder_id");


--
-- Name: org_affiliations org_affiliations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."org_affiliations"
    ADD CONSTRAINT "org_affiliations_pkey" PRIMARY KEY ("id");


--
-- Name: organisations organisations_cvr_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organisations"
    ADD CONSTRAINT "organisations_cvr_key" UNIQUE ("cvr");


--
-- Name: organisations organisations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organisations"
    ADD CONSTRAINT "organisations_pkey" PRIMARY KEY ("id");


--
-- Name: overenskomst_satser overenskomst_satser_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."overenskomst_satser"
    ADD CONSTRAINT "overenskomst_satser_pkey" PRIMARY KEY ("id");


--
-- Name: overenskomst_uploads overenskomst_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."overenskomst_uploads"
    ADD CONSTRAINT "overenskomst_uploads_pkey" PRIMARY KEY ("id");


--
-- Name: reference_docs reference_docs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."reference_docs"
    ADD CONSTRAINT "reference_docs_pkey" PRIMARY KEY ("id");


--
-- Name: rettighedshavere rettighedshavere_imdb_nm_format; Type: CHECK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE "public"."rettighedshavere"
    ADD CONSTRAINT "rettighedshavere_imdb_nm_format" CHECK ((("imdb_nm" IS NULL) OR ("imdb_nm" ~ '^nm[0-9]+$'::"text"))) NOT VALID;


--
-- Name: rettighedshavere rettighedshavere_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."rettighedshavere"
    ADD CONSTRAINT "rettighedshavere_pkey" PRIMARY KEY ("id");


--
-- Name: rettighedshavere rettighedshavere_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."rettighedshavere"
    ADD CONSTRAINT "rettighedshavere_user_id_key" UNIQUE ("user_id");


--
-- Name: rettighedshavere rettighedshavere_wikidata_qid_format; Type: CHECK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE "public"."rettighedshavere"
    ADD CONSTRAINT "rettighedshavere_wikidata_qid_format" CHECK ((("wikidata_qid" IS NULL) OR ("wikidata_qid" ~ '^Q[0-9]+$'::"text"))) NOT VALID;


--
-- Name: screening_claim_comments screening_claim_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."screening_claim_comments"
    ADD CONSTRAINT "screening_claim_comments_pkey" PRIMARY KEY ("id");


--
-- Name: screening_claims screening_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."screening_claims"
    ADD CONSTRAINT "screening_claims_pkey" PRIMARY KEY ("id");


--
-- Name: user_org_roles user_org_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_org_roles"
    ADD CONSTRAINT "user_org_roles_pkey" PRIMARY KEY ("id");


--
-- Name: user_org_roles user_org_roles_user_org_role_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_org_roles"
    ADD CONSTRAINT "user_org_roles_user_org_role_key" UNIQUE ("user_id", "org_id", "role");


--
-- Name: work_airings work_airings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_airings"
    ADD CONSTRAINT "work_airings_pkey" PRIMARY KEY ("id");


--
-- Name: work_airings work_airings_source_listing_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_airings"
    ADD CONSTRAINT "work_airings_source_listing_id_key" UNIQUE ("source", "listing_id");


--
-- Name: work_assignments work_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_assignments"
    ADD CONSTRAINT "work_assignments_pkey" PRIMARY KEY ("id");


--
-- Name: work_assignments work_assignments_work_rights_role_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_assignments"
    ADD CONSTRAINT "work_assignments_work_rights_role_unique" UNIQUE ("work_id", "rights_holder_id", "role");


--
-- Name: work_change_request_comments work_change_request_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_change_request_comments"
    ADD CONSTRAINT "work_change_request_comments_pkey" PRIMARY KEY ("id");


--
-- Name: work_change_requests work_change_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_change_requests"
    ADD CONSTRAINT "work_change_requests_pkey" PRIMARY KEY ("id");


--
-- Name: work_distributions work_distributions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_distributions"
    ADD CONSTRAINT "work_distributions_pkey" PRIMARY KEY ("id");


--
-- Name: work_external_ids work_external_ids_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_external_ids"
    ADD CONSTRAINT "work_external_ids_pkey" PRIMARY KEY ("id");


--
-- Name: work_external_ids work_external_ids_source_external_id_type_external_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_external_ids"
    ADD CONSTRAINT "work_external_ids_source_external_id_type_external_id_key" UNIQUE ("source", "external_id_type", "external_id");


--
-- Name: work_production_numbers work_production_numbers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_production_numbers"
    ADD CONSTRAINT "work_production_numbers_pkey" PRIMARY KEY ("id");


--
-- Name: work_production_numbers work_production_numbers_work_id_tv_station_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_production_numbers"
    ADD CONSTRAINT "work_production_numbers_work_id_tv_station_key" UNIQUE ("work_id", "tv_station");


--
-- Name: works works_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."works"
    ADD CONSTRAINT "works_pkey" PRIMARY KEY ("id");


--
-- Name: admin_message_deletion_audit_org_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "admin_message_deletion_audit_org_created_idx" ON "public"."admin_message_deletion_audit" USING "btree" ("org_id", "created_at" DESC);


--
-- Name: analysis_feedback_godkendt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "analysis_feedback_godkendt_idx" ON "public"."analysis_feedback" USING "btree" ("godkendt");


--
-- Name: analysis_feedback_svaerhedsgrad_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "analysis_feedback_svaerhedsgrad_idx" ON "public"."analysis_feedback" USING "btree" ("fund_svaerhedsgrad");


--
-- Name: broadcasters_org_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "broadcasters_org_name_idx" ON "public"."broadcasters" USING "btree" ("org_id", "name");


--
-- Name: broadcasters_unique_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "broadcasters_unique_name_idx" ON "public"."broadcasters" USING "btree" ("name");


--
-- Name: broadcasters_unique_org_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "broadcasters_unique_org_name_idx" ON "public"."broadcasters" USING "btree" (COALESCE("org_id", '00000000-0000-0000-0000-000000000000'::"uuid"), "name");


--
-- Name: broadcasters_unique_org_slug_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "broadcasters_unique_org_slug_idx" ON "public"."broadcasters" USING "btree" (COALESCE("org_id", '00000000-0000-0000-0000-000000000000'::"uuid"), "slug");


--
-- Name: broadcasters_unique_slug_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "broadcasters_unique_slug_idx" ON "public"."broadcasters" USING "btree" ("slug");


--
-- Name: contract_ai_jobs_contract_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "contract_ai_jobs_contract_idx" ON "public"."contract_ai_jobs" USING "btree" ("contract_id");


--
-- Name: contract_ai_jobs_org_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "contract_ai_jobs_org_status_idx" ON "public"."contract_ai_jobs" USING "btree" ("org_id", "status", "priority", "created_at");


--
-- Name: contract_comments_contract_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "contract_comments_contract_idx" ON "public"."contract_comments" USING "btree" ("contract_id", "created_at");


--
-- Name: contract_comments_org_role_unread_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "contract_comments_org_role_unread_idx" ON "public"."contract_comments" USING "btree" ("org_id", "author_role", "created_at" DESC);


--
-- Name: contract_reviews_assigned_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "contract_reviews_assigned_idx" ON "public"."contract_reviews" USING "btree" ("assigned_to");


--
-- Name: contract_reviews_member_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "contract_reviews_member_idx" ON "public"."contract_reviews" USING "btree" ("member_id");


--
-- Name: contract_reviews_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "contract_reviews_status_idx" ON "public"."contract_reviews" USING "btree" ("status");


--
-- Name: idx_employer_registries_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_employer_registries_active" ON "public"."employer_registries" USING "btree" ("employer_id", "association_name") WHERE ("valid_to" IS NULL);


--
-- Name: idx_employer_registries_assoc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_employer_registries_assoc" ON "public"."employer_registries" USING "btree" ("association_name");


--
-- Name: knowledge_chunks_embedding_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "knowledge_chunks_embedding_idx" ON "public"."knowledge_chunks" USING "ivfflat" ("embedding" "extensions"."vector_cosine_ops") WITH ("lists"='100');


--
-- Name: knowledge_chunks_kategori_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "knowledge_chunks_kategori_idx" ON "public"."knowledge_chunks" USING "btree" ("overenskomst", "kategori", "aktiv");


--
-- Name: learned_patterns_embedding_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "learned_patterns_embedding_idx" ON "public"."learned_patterns" USING "ivfflat" ("embedding" "extensions"."vector_cosine_ops") WITH ("lists"='50');


--
-- Name: overenskomst_satser_gyldig_til_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "overenskomst_satser_gyldig_til_idx" ON "public"."overenskomst_satser" USING "btree" ("gyldig_til");


--
-- Name: overenskomst_satser_overenskomst_kategori_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "overenskomst_satser_overenskomst_kategori_idx" ON "public"."overenskomst_satser" USING "btree" ("overenskomst", "kategori");


--
-- Name: rettighedshavere_dfi_person_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "rettighedshavere_dfi_person_id_idx" ON "public"."rettighedshavere" USING "btree" ("dfi_person_id") WHERE ("dfi_person_id" IS NOT NULL);


--
-- Name: rettighedshavere_dfi_person_id_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "rettighedshavere_dfi_person_id_uidx" ON "public"."rettighedshavere" USING "btree" ("dfi_person_id") WHERE ("dfi_person_id" IS NOT NULL);


--
-- Name: rettighedshavere_imdb_nm_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "rettighedshavere_imdb_nm_idx" ON "public"."rettighedshavere" USING "btree" ("imdb_nm") WHERE ("imdb_nm" IS NOT NULL);


--
-- Name: rettighedshavere_imdb_nm_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "rettighedshavere_imdb_nm_uidx" ON "public"."rettighedshavere" USING "btree" ("imdb_nm") WHERE ("imdb_nm" IS NOT NULL);


--
-- Name: rettighedshavere_tmdb_person_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "rettighedshavere_tmdb_person_id_idx" ON "public"."rettighedshavere" USING "btree" ("tmdb_person_id") WHERE ("tmdb_person_id" IS NOT NULL);


--
-- Name: rettighedshavere_tmdb_person_id_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "rettighedshavere_tmdb_person_id_uidx" ON "public"."rettighedshavere" USING "btree" ("tmdb_person_id") WHERE ("tmdb_person_id" IS NOT NULL);


--
-- Name: rettighedshavere_wikidata_qid_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "rettighedshavere_wikidata_qid_idx" ON "public"."rettighedshavere" USING "btree" ("wikidata_qid") WHERE ("wikidata_qid" IS NOT NULL);


--
-- Name: rettighedshavere_wikidata_qid_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "rettighedshavere_wikidata_qid_uidx" ON "public"."rettighedshavere" USING "btree" ("wikidata_qid") WHERE ("wikidata_qid" IS NOT NULL);


--
-- Name: screening_claim_comments_claim_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "screening_claim_comments_claim_idx" ON "public"."screening_claim_comments" USING "btree" ("claim_id", "created_at");


--
-- Name: screening_claims_admin_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "screening_claims_admin_idx" ON "public"."screening_claims" USING "btree" ("org_id", "status", "created_at" DESC);


--
-- Name: screening_claims_member_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "screening_claims_member_idx" ON "public"."screening_claims" USING "btree" ("profile_id", "created_at" DESC);


--
-- Name: screening_claims_work_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "screening_claims_work_idx" ON "public"."screening_claims" USING "btree" ("work_id", "screening_date" DESC);


--
-- Name: uq_employer_registry_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "uq_employer_registry_active" ON "public"."employer_registries" USING "btree" ("employer_id", "association_name") WHERE ("valid_to" IS NULL);


--
-- Name: work_airings_broadcaster_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "work_airings_broadcaster_idx" ON "public"."work_airings" USING "btree" ("broadcaster_id");


--
-- Name: work_airings_org_channel_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "work_airings_org_channel_date_idx" ON "public"."work_airings" USING "btree" ("org_id", "channel", "broadcast_date");


--
-- Name: work_airings_source_episode_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "work_airings_source_episode_idx" ON "public"."work_airings" USING "btree" ("source", "episode_id");


--
-- Name: work_airings_source_series_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "work_airings_source_series_idx" ON "public"."work_airings" USING "btree" ("source", "series_id");


--
-- Name: work_airings_work_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "work_airings_work_idx" ON "public"."work_airings" USING "btree" ("work_id");


--
-- Name: work_assignments_work_holder_role_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "work_assignments_work_holder_role_uidx" ON "public"."work_assignments" USING "btree" ("work_id", "rights_holder_id", "role") WHERE ("rights_holder_id" IS NOT NULL);


--
-- Name: work_change_request_comments_admin_unread_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "work_change_request_comments_admin_unread_idx" ON "public"."work_change_request_comments" USING "btree" ("admin_read_at", "created_at" DESC) WHERE ("author_role" = 'member'::"text");


--
-- Name: work_change_request_comments_member_unread_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "work_change_request_comments_member_unread_idx" ON "public"."work_change_request_comments" USING "btree" ("member_read_at", "created_at" DESC) WHERE ("author_role" = 'admin'::"text");


--
-- Name: work_change_request_comments_request_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "work_change_request_comments_request_idx" ON "public"."work_change_request_comments" USING "btree" ("request_id", "created_at");


--
-- Name: work_change_requests_org_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "work_change_requests_org_status_idx" ON "public"."work_change_requests" USING "btree" ("org_id", "status", "created_at" DESC);


--
-- Name: work_change_requests_work_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "work_change_requests_work_status_idx" ON "public"."work_change_requests" USING "btree" ("work_id", "status", "created_at" DESC);


--
-- Name: work_distributions_org_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "work_distributions_org_idx" ON "public"."work_distributions" USING "btree" ("org_id");


--
-- Name: work_distributions_unique_period_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "work_distributions_unique_period_idx" ON "public"."work_distributions" USING "btree" ("work_id", COALESCE("broadcaster_id", '00000000-0000-0000-0000-000000000000'::"uuid"), COALESCE("lower"(TRIM(BOTH FROM "broadcaster_name")), ''::"text"), "distribution_type", COALESCE("valid_from_year", 0), COALESCE("valid_to_year", 0));


--
-- Name: work_distributions_work_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "work_distributions_work_idx" ON "public"."work_distributions" USING "btree" ("work_id");


--
-- Name: work_external_ids_org_source_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "work_external_ids_org_source_idx" ON "public"."work_external_ids" USING "btree" ("org_id", "source");


--
-- Name: work_external_ids_work_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "work_external_ids_work_idx" ON "public"."work_external_ids" USING "btree" ("work_id");


--
-- Name: works_imdb_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "works_imdb_id_idx" ON "public"."works" USING "btree" ("imdb_id");


--
-- Name: works_org_imdb_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "works_org_imdb_id_idx" ON "public"."works" USING "btree" ("org_id", "imdb_id") WHERE ("imdb_id" IS NOT NULL);


--
-- Name: works_org_wikidata_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "works_org_wikidata_id_idx" ON "public"."works" USING "btree" ("org_id", "wikidata_id") WHERE ("wikidata_id" IS NOT NULL);


--
-- Name: works_parent_season_episode_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "works_parent_season_episode_unique_idx" ON "public"."works" USING "btree" ("parent_work_id", "season_number", "episode_number") WHERE ("parent_work_id" IS NOT NULL);


--
-- Name: works_parent_work_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "works_parent_work_idx" ON "public"."works" USING "btree" ("parent_work_id");


--
-- Name: contract_reviews trg_contract_reviews_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_contract_reviews_updated_at" BEFORE UPDATE ON "public"."contract_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."update_contract_reviews_updated_at"();


--
-- Name: admin_message_deletion_audit admin_message_deletion_audit_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."admin_message_deletion_audit"
    ADD CONSTRAINT "admin_message_deletion_audit_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: admin_message_deletion_audit admin_message_deletion_audit_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."admin_message_deletion_audit"
    ADD CONSTRAINT "admin_message_deletion_audit_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;


--
-- Name: agreements agreements_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."agreements"
    ADD CONSTRAINT "agreements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;


--
-- Name: analysis_feedback analysis_feedback_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."analysis_feedback"
    ADD CONSTRAINT "analysis_feedback_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;


--
-- Name: broadcasters broadcasters_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."broadcasters"
    ADD CONSTRAINT "broadcasters_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;


--
-- Name: case_learnings case_learnings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."case_learnings"
    ADD CONSTRAINT "case_learnings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;


--
-- Name: contract_ai_jobs contract_ai_jobs_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_ai_jobs"
    ADD CONSTRAINT "contract_ai_jobs_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;


--
-- Name: contract_ai_jobs contract_ai_jobs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_ai_jobs"
    ADD CONSTRAINT "contract_ai_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");


--
-- Name: contract_ai_jobs contract_ai_jobs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_ai_jobs"
    ADD CONSTRAINT "contract_ai_jobs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;


--
-- Name: contract_attachments contract_attachments_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_attachments"
    ADD CONSTRAINT "contract_attachments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;


--
-- Name: contract_attachments contract_attachments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_attachments"
    ADD CONSTRAINT "contract_attachments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");


--
-- Name: contract_attachments contract_attachments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_attachments"
    ADD CONSTRAINT "contract_attachments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;


--
-- Name: contract_comments contract_comments_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_comments"
    ADD CONSTRAINT "contract_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: contract_comments contract_comments_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_comments"
    ADD CONSTRAINT "contract_comments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;


--
-- Name: contract_comments contract_comments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_comments"
    ADD CONSTRAINT "contract_comments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;


--
-- Name: contract_episodes contract_episodes_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_episodes"
    ADD CONSTRAINT "contract_episodes_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;


--
-- Name: contract_episodes contract_episodes_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_episodes"
    ADD CONSTRAINT "contract_episodes_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE CASCADE;


--
-- Name: contract_reviews contract_reviews_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_reviews"
    ADD CONSTRAINT "contract_reviews_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id");


--
-- Name: contract_reviews contract_reviews_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_reviews"
    ADD CONSTRAINT "contract_reviews_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE SET NULL;


--
-- Name: contract_reviews contract_reviews_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_reviews"
    ADD CONSTRAINT "contract_reviews_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "auth"."users"("id");


--
-- Name: contract_reviews contract_reviews_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_reviews"
    ADD CONSTRAINT "contract_reviews_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;


--
-- Name: contract_reviews contract_reviews_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_reviews"
    ADD CONSTRAINT "contract_reviews_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");


--
-- Name: contract_validations contract_validations_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_validations"
    ADD CONSTRAINT "contract_validations_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;


--
-- Name: contract_validations contract_validations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_validations"
    ADD CONSTRAINT "contract_validations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;


--
-- Name: contract_validations contract_validations_validated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contract_validations"
    ADD CONSTRAINT "contract_validations_validated_by_fkey" FOREIGN KEY ("validated_by") REFERENCES "auth"."users"("id");


--
-- Name: contracts contracts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");


--
-- Name: contracts contracts_employer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE RESTRICT;


--
-- Name: contracts contracts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;


--
-- Name: contracts contracts_rights_holder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_rights_holder_id_fkey" FOREIGN KEY ("rights_holder_id") REFERENCES "public"."rettighedshavere"("id") ON DELETE RESTRICT;


--
-- Name: contracts contracts_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE RESTRICT;


--
-- Name: employer_registries employer_registries_employer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."employer_registries"
    ADD CONSTRAINT "employer_registries_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE CASCADE;


--
-- Name: employers employers_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."employers"
    ADD CONSTRAINT "employers_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."employers"("id") ON DELETE SET NULL;


--
-- Name: episodes episodes_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episodes_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE CASCADE;


--
-- Name: legal_note_history legal_note_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."legal_note_history"
    ADD CONSTRAINT "legal_note_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id");


--
-- Name: legal_note_history legal_note_history_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."legal_note_history"
    ADD CONSTRAINT "legal_note_history_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."legal_notes"("id") ON DELETE CASCADE;


--
-- Name: legal_note_history legal_note_history_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."legal_note_history"
    ADD CONSTRAINT "legal_note_history_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id");


--
-- Name: legal_notes legal_notes_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."legal_notes"
    ADD CONSTRAINT "legal_notes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;


--
-- Name: org_affiliations org_affiliations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."org_affiliations"
    ADD CONSTRAINT "org_affiliations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;


--
-- Name: org_affiliations org_affiliations_rights_holder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."org_affiliations"
    ADD CONSTRAINT "org_affiliations_rights_holder_id_fkey" FOREIGN KEY ("rights_holder_id") REFERENCES "public"."rettighedshavere"("id") ON DELETE CASCADE;


--
-- Name: reference_docs reference_docs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."reference_docs"
    ADD CONSTRAINT "reference_docs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;


--
-- Name: rettighedshavere rettighedshavere_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."rettighedshavere"
    ADD CONSTRAINT "rettighedshavere_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: screening_claim_comments screening_claim_comments_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."screening_claim_comments"
    ADD CONSTRAINT "screening_claim_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: screening_claim_comments screening_claim_comments_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."screening_claim_comments"
    ADD CONSTRAINT "screening_claim_comments_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."screening_claims"("id") ON DELETE CASCADE;


--
-- Name: screening_claims screening_claims_broadcaster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."screening_claims"
    ADD CONSTRAINT "screening_claims_broadcaster_id_fkey" FOREIGN KEY ("broadcaster_id") REFERENCES "public"."broadcasters"("id") ON DELETE SET NULL;


--
-- Name: screening_claims screening_claims_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."screening_claims"
    ADD CONSTRAINT "screening_claims_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;


--
-- Name: screening_claims screening_claims_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."screening_claims"
    ADD CONSTRAINT "screening_claims_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: screening_claims screening_claims_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."screening_claims"
    ADD CONSTRAINT "screening_claims_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: screening_claims screening_claims_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."screening_claims"
    ADD CONSTRAINT "screening_claims_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE RESTRICT;


--
-- Name: user_org_roles user_org_roles_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_org_roles"
    ADD CONSTRAINT "user_org_roles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;


--
-- Name: user_org_roles user_org_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_org_roles"
    ADD CONSTRAINT "user_org_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: work_airings work_airings_broadcaster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_airings"
    ADD CONSTRAINT "work_airings_broadcaster_id_fkey" FOREIGN KEY ("broadcaster_id") REFERENCES "public"."broadcasters"("id") ON DELETE SET NULL;


--
-- Name: work_airings work_airings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_airings"
    ADD CONSTRAINT "work_airings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;


--
-- Name: work_airings work_airings_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_airings"
    ADD CONSTRAINT "work_airings_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE SET NULL;


--
-- Name: work_assignments work_assignments_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_assignments"
    ADD CONSTRAINT "work_assignments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE SET NULL;


--
-- Name: work_assignments work_assignments_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_assignments"
    ADD CONSTRAINT "work_assignments_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE CASCADE;


--
-- Name: work_assignments work_assignments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_assignments"
    ADD CONSTRAINT "work_assignments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;


--
-- Name: work_assignments work_assignments_rights_holder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_assignments"
    ADD CONSTRAINT "work_assignments_rights_holder_id_fkey" FOREIGN KEY ("rights_holder_id") REFERENCES "public"."rettighedshavere"("id") ON DELETE SET NULL;


--
-- Name: work_assignments work_assignments_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_assignments"
    ADD CONSTRAINT "work_assignments_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE CASCADE;


--
-- Name: work_change_request_comments work_change_request_comments_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_change_request_comments"
    ADD CONSTRAINT "work_change_request_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: work_change_request_comments work_change_request_comments_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_change_request_comments"
    ADD CONSTRAINT "work_change_request_comments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."work_change_requests"("id") ON DELETE CASCADE;


--
-- Name: work_change_requests work_change_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_change_requests"
    ADD CONSTRAINT "work_change_requests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;


--
-- Name: work_change_requests work_change_requests_requested_by_rights_holder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_change_requests"
    ADD CONSTRAINT "work_change_requests_requested_by_rights_holder_id_fkey" FOREIGN KEY ("requested_by_rights_holder_id") REFERENCES "public"."rettighedshavere"("id") ON DELETE SET NULL;


--
-- Name: work_change_requests work_change_requests_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_change_requests"
    ADD CONSTRAINT "work_change_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: work_change_requests work_change_requests_reviewed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_change_requests"
    ADD CONSTRAINT "work_change_requests_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: work_change_requests work_change_requests_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_change_requests"
    ADD CONSTRAINT "work_change_requests_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE CASCADE;


--
-- Name: work_distributions work_distributions_broadcaster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_distributions"
    ADD CONSTRAINT "work_distributions_broadcaster_id_fkey" FOREIGN KEY ("broadcaster_id") REFERENCES "public"."broadcasters"("id") ON DELETE SET NULL;


--
-- Name: work_distributions work_distributions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_distributions"
    ADD CONSTRAINT "work_distributions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;


--
-- Name: work_distributions work_distributions_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_distributions"
    ADD CONSTRAINT "work_distributions_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE CASCADE;


--
-- Name: work_external_ids work_external_ids_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_external_ids"
    ADD CONSTRAINT "work_external_ids_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;


--
-- Name: work_external_ids work_external_ids_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_external_ids"
    ADD CONSTRAINT "work_external_ids_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE CASCADE;


--
-- Name: work_production_numbers work_production_numbers_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."work_production_numbers"
    ADD CONSTRAINT "work_production_numbers_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE CASCADE;


--
-- Name: works works_employer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."works"
    ADD CONSTRAINT "works_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE RESTRICT;


--
-- Name: works works_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."works"
    ADD CONSTRAINT "works_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;


--
-- Name: works works_parent_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."works"
    ADD CONSTRAINT "works_parent_work_id_fkey" FOREIGN KEY ("parent_work_id") REFERENCES "public"."works"("id") ON DELETE CASCADE;


--
-- Name: contract_attachments Admins kan administrere bilag; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan administrere bilag" ON "public"."contract_attachments" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."org_id" = "contract_attachments"."org_id") AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]))))));


--
-- Name: broadcasters Admins kan administrere broadcastere; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan administrere broadcastere" ON "public"."broadcasters" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"])) AND (("broadcasters"."org_id" IS NULL) OR ("r"."org_id" = "broadcasters"."org_id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"])) AND (("broadcasters"."org_id" IS NULL) OR ("r"."org_id" = "broadcasters"."org_id"))))));


--
-- Name: work_distributions Admins kan administrere distribution for egne orgs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan administrere distribution for egne orgs" ON "public"."work_distributions" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("r"."org_id" = "work_distributions"."org_id") AND ("r"."role" = ANY (ARRAY['admin'::"text", 'org-admin'::"text", 'superadmin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("r"."org_id" = "work_distributions"."org_id") AND ("r"."role" = ANY (ARRAY['admin'::"text", 'org-admin'::"text", 'superadmin'::"text"]))))));


--
-- Name: work_external_ids Admins kan administrere eksterne værk-ider; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan administrere eksterne værk-ider" ON "public"."work_external_ids" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."org_id" = "work_external_ids"."org_id") AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."org_id" = "work_external_ids"."org_id") AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]))))));


--
-- Name: agreements Admins kan administrere overenskomster; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan administrere overenskomster" ON "public"."agreements" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]))))));


--
-- Name: user_org_roles Admins kan administrere roller; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan administrere roller" ON "public"."user_org_roles" TO "authenticated" USING ("public"."is_org_admin"("org_id")) WITH CHECK ("public"."is_org_admin"("org_id"));


--
-- Name: work_airings Admins kan administrere udsendelser; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan administrere udsendelser" ON "public"."work_airings" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."org_id" = "work_airings"."org_id") AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."org_id" = "work_airings"."org_id") AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]))))));


--
-- Name: work_change_requests Admins kan behandle værkændringsanmodninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan behandle værkændringsanmodninger" ON "public"."work_change_requests" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("r"."org_id" = "work_change_requests"."org_id") AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("r"."org_id" = "work_change_requests"."org_id") AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]))))));


--
-- Name: contract_ai_jobs Admins kan opdatere AI-jobs for egne orgs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan opdatere AI-jobs for egne orgs" ON "public"."contract_ai_jobs" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."org_id" = "contract_ai_jobs"."org_id") AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."org_id" = "contract_ai_jobs"."org_id") AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]))))));


--
-- Name: analysis_feedback Admins kan opdatere analysefeedback; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan opdatere analysefeedback" ON "public"."analysis_feedback" FOR UPDATE TO "authenticated" USING (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]))) WITH CHECK (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: employers Admins kan opdatere arbejdsgivere; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan opdatere arbejdsgivere" ON "public"."employers" FOR UPDATE TO "authenticated" USING ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"])) WITH CHECK ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: employer_registries Admins kan opdatere arbejdsgiverforeninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan opdatere arbejdsgiverforeninger" ON "public"."employer_registries" FOR UPDATE TO "authenticated" USING ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"])) WITH CHECK ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: legal_note_history Admins kan opdatere juridisk notehistorik; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan opdatere juridisk notehistorik" ON "public"."legal_note_history" FOR UPDATE TO "authenticated" USING (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]))) WITH CHECK (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: legal_notes Admins kan opdatere juridiske noter; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan opdatere juridiske noter" ON "public"."legal_notes" FOR UPDATE TO "authenticated" USING (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]))) WITH CHECK (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: contract_reviews Admins kan opdatere kontraktgennemgange; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan opdatere kontraktgennemgange" ON "public"."contract_reviews" FOR UPDATE TO "authenticated" USING ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) WITH CHECK ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: learned_patterns Admins kan opdatere læringsmønstre; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan opdatere læringsmønstre" ON "public"."learned_patterns" FOR UPDATE TO "authenticated" USING ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) WITH CHECK ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: overenskomst_uploads Admins kan opdatere overenskomstuploads; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan opdatere overenskomstuploads" ON "public"."overenskomst_uploads" FOR UPDATE TO "authenticated" USING ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) WITH CHECK ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: reference_docs Admins kan opdatere referencedokumenter; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan opdatere referencedokumenter" ON "public"."reference_docs" FOR UPDATE TO "authenticated" USING (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]))) WITH CHECK (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: case_learnings Admins kan opdatere sagserfaringer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan opdatere sagserfaringer" ON "public"."case_learnings" FOR UPDATE TO "authenticated" USING (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]))) WITH CHECK (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: overenskomst_satser Admins kan opdatere satser; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan opdatere satser" ON "public"."overenskomst_satser" FOR UPDATE TO "authenticated" USING ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) WITH CHECK ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: contract_validations Admins kan opdatere valideringer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan opdatere valideringer" ON "public"."contract_validations" FOR UPDATE TO "authenticated" USING ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) WITH CHECK ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: knowledge_chunks Admins kan opdatere videnbidder; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan opdatere videnbidder" ON "public"."knowledge_chunks" FOR UPDATE TO "authenticated" USING (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]))) WITH CHECK (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: contract_ai_jobs Admins kan oprette AI-jobs for egne orgs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette AI-jobs for egne orgs" ON "public"."contract_ai_jobs" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."org_id" = "contract_ai_jobs"."org_id") AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]))))));


--
-- Name: analysis_feedback Admins kan oprette analysefeedback; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette analysefeedback" ON "public"."analysis_feedback" FOR INSERT TO "authenticated" WITH CHECK (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: employers Admins kan oprette arbejdsgivere; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette arbejdsgivere" ON "public"."employers" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: employer_registries Admins kan oprette arbejdsgiverforeninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette arbejdsgiverforeninger" ON "public"."employer_registries" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: legal_note_history Admins kan oprette juridisk notehistorik; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette juridisk notehistorik" ON "public"."legal_note_history" FOR INSERT TO "authenticated" WITH CHECK (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: legal_notes Admins kan oprette juridiske noter; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette juridiske noter" ON "public"."legal_notes" FOR INSERT TO "authenticated" WITH CHECK (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: contract_episodes Admins kan oprette kontraktafnsit; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette kontraktafnsit" ON "public"."contract_episodes" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."contracts" "contract_row"
  WHERE (("contract_row"."id" = "contract_episodes"."contract_id") AND "public"."current_user_has_org_role"("contract_row"."org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])))));


--
-- Name: contract_reviews Admins kan oprette kontraktgennemgange; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette kontraktgennemgange" ON "public"."contract_reviews" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: learned_patterns Admins kan oprette læringsmønstre; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette læringsmønstre" ON "public"."learned_patterns" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: overenskomst_uploads Admins kan oprette overenskomstuploads; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette overenskomstuploads" ON "public"."overenskomst_uploads" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: reference_docs Admins kan oprette referencedokumenter; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette referencedokumenter" ON "public"."reference_docs" FOR INSERT TO "authenticated" WITH CHECK (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: case_learnings Admins kan oprette sagserfaringer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette sagserfaringer" ON "public"."case_learnings" FOR INSERT TO "authenticated" WITH CHECK (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: overenskomst_satser Admins kan oprette satser; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette satser" ON "public"."overenskomst_satser" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: contract_validations Admins kan oprette valideringer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette valideringer" ON "public"."contract_validations" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: knowledge_chunks Admins kan oprette videnbidder; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan oprette videnbidder" ON "public"."knowledge_chunks" FOR INSERT TO "authenticated" WITH CHECK (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: contract_ai_jobs Admins kan se AI-jobs for egne orgs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan se AI-jobs for egne orgs" ON "public"."contract_ai_jobs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."org_id" = "contract_ai_jobs"."org_id") AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]))))));


--
-- Name: admin_message_deletion_audit Admins kan se beskedsletningsaudit for egen organisation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan se beskedsletningsaudit for egen organisation" ON "public"."admin_message_deletion_audit" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "role"
  WHERE (("role"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("role"."org_id" = "admin_message_deletion_audit"."org_id") AND ("role"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]))))));


--
-- Name: legal_note_history Admins kan se juridisk notehistorik; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan se juridisk notehistorik" ON "public"."legal_note_history" FOR SELECT TO "authenticated" USING (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: overenskomst_uploads Admins kan se overenskomstuploads; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan se overenskomstuploads" ON "public"."overenskomst_uploads" FOR SELECT TO "authenticated" USING ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: analysis_feedback Admins kan slette analysefeedback; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan slette analysefeedback" ON "public"."analysis_feedback" FOR DELETE TO "authenticated" USING (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: employers Admins kan slette arbejdsgivere; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan slette arbejdsgivere" ON "public"."employers" FOR DELETE TO "authenticated" USING ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: employer_registries Admins kan slette arbejdsgiverforeninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan slette arbejdsgiverforeninger" ON "public"."employer_registries" FOR DELETE TO "authenticated" USING ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: legal_note_history Admins kan slette juridisk notehistorik; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan slette juridisk notehistorik" ON "public"."legal_note_history" FOR DELETE TO "authenticated" USING (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: legal_notes Admins kan slette juridiske noter; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan slette juridiske noter" ON "public"."legal_notes" FOR DELETE TO "authenticated" USING (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: contract_episodes Admins kan slette kontraktafnsit; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan slette kontraktafnsit" ON "public"."contract_episodes" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."contracts" "contract_row"
  WHERE (("contract_row"."id" = "contract_episodes"."contract_id") AND "public"."current_user_has_org_role"("contract_row"."org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])))));


--
-- Name: contract_reviews Admins kan slette kontraktgennemgange; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan slette kontraktgennemgange" ON "public"."contract_reviews" FOR DELETE TO "authenticated" USING ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: learned_patterns Admins kan slette læringsmønstre; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan slette læringsmønstre" ON "public"."learned_patterns" FOR DELETE TO "authenticated" USING ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: overenskomst_uploads Admins kan slette overenskomstuploads; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan slette overenskomstuploads" ON "public"."overenskomst_uploads" FOR DELETE TO "authenticated" USING ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: reference_docs Admins kan slette referencedokumenter; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan slette referencedokumenter" ON "public"."reference_docs" FOR DELETE TO "authenticated" USING (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: case_learnings Admins kan slette sagserfaringer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan slette sagserfaringer" ON "public"."case_learnings" FOR DELETE TO "authenticated" USING (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: overenskomst_satser Admins kan slette satser; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan slette satser" ON "public"."overenskomst_satser" FOR DELETE TO "authenticated" USING ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: contract_validations Admins kan slette valideringer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan slette valideringer" ON "public"."contract_validations" FOR DELETE TO "authenticated" USING ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: knowledge_chunks Admins kan slette videnbidder; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins kan slette videnbidder" ON "public"."knowledge_chunks" FOR DELETE TO "authenticated" USING (((("org_id" IS NULL) AND "public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: agreements Alle kan se relevante overenskomster; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Alle kan se relevante overenskomster" ON "public"."agreements" FOR SELECT TO "authenticated" USING ((("org_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."org_id" = "agreements"."org_id"))))));


--
-- Name: screening_claims Brugere kan oprette egne visningskrav; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan oprette egne visningskrav" ON "public"."screening_claims" FOR INSERT TO "authenticated" WITH CHECK ((("profile_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."current_user_belongs_to_org"("org_id")));


--
-- Name: work_change_requests Brugere kan oprette egne værkændringsanmodninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan oprette egne værkændringsanmodninger" ON "public"."work_change_requests" FOR INSERT TO "authenticated" WITH CHECK ((("requested_by_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."rettighedshavere" "rh"
  WHERE (("rh"."id" = "work_change_requests"."requested_by_rights_holder_id") AND ("rh"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));


--
-- Name: broadcasters Brugere kan se broadcastere for egne orgs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan se broadcastere for egne orgs" ON "public"."broadcasters" FOR SELECT TO "authenticated" USING ((("org_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."org_id" = "broadcasters"."org_id"))))));


--
-- Name: work_distributions Brugere kan se distribution for egne orgs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan se distribution for egne orgs" ON "public"."work_distributions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("r"."org_id" = "work_distributions"."org_id")))));


--
-- Name: contract_attachments Brugere kan se egne orgs bilag; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan se egne orgs bilag" ON "public"."contract_attachments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."org_id" = "contract_attachments"."org_id")))));


--
-- Name: user_org_roles Brugere kan se egne roller; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan se egne roller" ON "public"."user_org_roles" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));


--
-- Name: work_change_requests Brugere kan se egne værkændringsanmodninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan se egne værkændringsanmodninger" ON "public"."work_change_requests" FOR SELECT TO "authenticated" USING ((("requested_by_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("r"."org_id" = "work_change_requests"."org_id") AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])))))));


--
-- Name: work_external_ids Brugere kan se eksterne værk-ider for egne orgs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan se eksterne værk-ider for egne orgs" ON "public"."work_external_ids" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."org_id" = "work_external_ids"."org_id")))));


--
-- Name: episodes Brugere kan se episoder for egne orgs værker; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan se episoder for egne orgs værker" ON "public"."episodes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."works" "w"
     JOIN "public"."user_org_roles" "r" ON (("r"."org_id" = "w"."org_id")))
  WHERE (("w"."id" = "episodes"."work_id") AND ("r"."user_id" = "auth"."uid"())))));


--
-- Name: work_production_numbers Brugere kan se produktionsnumre for egne orgs værker; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan se produktionsnumre for egne orgs værker" ON "public"."work_production_numbers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."works" "w"
     JOIN "public"."user_org_roles" "r" ON (("r"."org_id" = "w"."org_id")))
  WHERE (("w"."id" = "work_production_numbers"."work_id") AND ("r"."user_id" = "auth"."uid"())))));


--
-- Name: legal_notes Brugere kan se relevante juridiske noter; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan se relevante juridiske noter" ON "public"."legal_notes" FOR SELECT TO "authenticated" USING ((("org_id" IS NULL) OR "public"."current_user_belongs_to_org"("org_id")));


--
-- Name: reference_docs Brugere kan se relevante referencedokumenter; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan se relevante referencedokumenter" ON "public"."reference_docs" FOR SELECT TO "authenticated" USING ((("org_id" IS NULL) OR "public"."current_user_belongs_to_org"("org_id")));


--
-- Name: works Brugere kan se relevante værker; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan se relevante værker" ON "public"."works" FOR SELECT TO "authenticated" USING (("public"."current_user_is_assigned_to_work"("id") OR "public"."current_user_belongs_to_org"("org_id")));


--
-- Name: work_assignments Brugere kan se relevante værktilknytninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan se relevante værktilknytninger" ON "public"."work_assignments" FOR SELECT TO "authenticated" USING (("public"."current_user_owns_rights_holder"("rights_holder_id") OR "public"."current_user_belongs_to_org"("org_id")));


--
-- Name: work_airings Brugere kan se udsendelser for egne orgs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan se udsendelser for egne orgs" ON "public"."work_airings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_org_roles" "r"
  WHERE (("r"."user_id" = "auth"."uid"()) AND ("r"."org_id" = "work_airings"."org_id")))));


--
-- Name: contract_attachments Brugere kan slette egne allonger inden validering; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan slette egne allonger inden validering" ON "public"."contract_attachments" FOR DELETE TO "authenticated" USING ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("type" = 'allonge'::"text") AND (("ai_status" IS NULL) OR ("ai_status" <> 'klar'::"text"))));


--
-- Name: contract_attachments Brugere kan tilføje bilag til egne kontrakter; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere kan tilføje bilag til egne kontrakter" ON "public"."contract_attachments" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM ("public"."contracts" "c"
     JOIN "public"."rettighedshavere" "rh" ON (("rh"."id" = "c"."rights_holder_id")))
  WHERE (("c"."id" = "contract_attachments"."contract_id") AND ("rh"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));


--
-- Name: contract_comments Brugere og admins kan oprette kontraktkommentarer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og admins kan oprette kontraktkommentarer" ON "public"."contract_comments" FOR INSERT TO "authenticated" WITH CHECK ((("author_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."contracts" "c"
  WHERE (("c"."id" = "contract_comments"."contract_id") AND ("c"."org_id" = "contract_comments"."org_id") AND ((EXISTS ( SELECT 1
           FROM "public"."rettighedshavere" "rh"
          WHERE (("rh"."id" = "c"."rights_holder_id") AND ("rh"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("contract_comments"."author_role" = 'member'::"text")))) OR (EXISTS ( SELECT 1
           FROM "public"."user_org_roles" "ur"
          WHERE (("ur"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("ur"."org_id" = "c"."org_id") AND ("ur"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])) AND ("contract_comments"."author_role" = 'admin'::"text"))))))))));


--
-- Name: screening_claim_comments Brugere og admins kan oprette visningskommentarer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og admins kan oprette visningskommentarer" ON "public"."screening_claim_comments" FOR INSERT TO "authenticated" WITH CHECK ((("author_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."screening_claims" "sc"
  WHERE (("sc"."id" = "screening_claim_comments"."claim_id") AND ((("sc"."profile_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("screening_claim_comments"."author_role" = 'member'::"text")) OR (("screening_claim_comments"."author_role" = 'admin'::"text") AND (EXISTS ( SELECT 1
           FROM "public"."user_org_roles" "r"
          WHERE (("r"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("r"."org_id" = "sc"."org_id") AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]))))))))))));


--
-- Name: work_change_request_comments Brugere og admins kan oprette ændringskommentarer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og admins kan oprette ændringskommentarer" ON "public"."work_change_request_comments" FOR INSERT TO "authenticated" WITH CHECK ((("author_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."work_change_requests" "r"
  WHERE (("r"."id" = "work_change_request_comments"."request_id") AND (("r"."requested_by_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."user_org_roles" "ur"
          WHERE (("ur"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("ur"."org_id" = "r"."org_id") AND ("ur"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])))))))))));


--
-- Name: contract_comments Brugere og admins kan se kontraktkommentarer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og admins kan se kontraktkommentarer" ON "public"."contract_comments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."contracts" "c"
  WHERE (("c"."id" = "contract_comments"."contract_id") AND ((EXISTS ( SELECT 1
           FROM "public"."rettighedshavere" "rh"
          WHERE (("rh"."id" = "c"."rights_holder_id") AND ("rh"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
           FROM "public"."user_org_roles" "ur"
          WHERE (("ur"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("ur"."org_id" = "c"."org_id") AND ("ur"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]))))))))));


--
-- Name: screening_claim_comments Brugere og admins kan se visningskommentarer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og admins kan se visningskommentarer" ON "public"."screening_claim_comments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."screening_claims" "sc"
  WHERE (("sc"."id" = "screening_claim_comments"."claim_id") AND (("sc"."profile_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."user_org_roles" "r"
          WHERE (("r"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("r"."org_id" = "sc"."org_id") AND ("r"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]))))))))));


--
-- Name: work_change_request_comments Brugere og admins kan se ændringskommentarer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og admins kan se ændringskommentarer" ON "public"."work_change_request_comments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."work_change_requests" "r"
  WHERE (("r"."id" = "work_change_request_comments"."request_id") AND (("r"."requested_by_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."user_org_roles" "ur"
          WHERE (("ur"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("ur"."org_id" = "r"."org_id") AND ("ur"."role" = ANY (ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]))))))))));


--
-- Name: contracts Brugere og orgadmins kan opdatere kontrakter; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og orgadmins kan opdatere kontrakter" ON "public"."contracts" FOR UPDATE TO "authenticated" USING (("public"."current_user_owns_rights_holder"("rights_holder_id") OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]))) WITH CHECK (("public"."current_user_owns_rights_holder"("rights_holder_id") OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: rettighedshavere Brugere og orgadmins kan opdatere rettighedshavere; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og orgadmins kan opdatere rettighedshavere" ON "public"."rettighedshavere" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."current_user_can_admin_rights_holder"("id"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."current_user_can_admin_rights_holder"("id")));


--
-- Name: contracts Brugere og orgadmins kan oprette kontrakter; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og orgadmins kan oprette kontrakter" ON "public"."contracts" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_user_owns_rights_holder"("rights_holder_id") OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: org_affiliations Brugere og orgadmins kan se organisationstilknytninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og orgadmins kan se organisationstilknytninger" ON "public"."org_affiliations" FOR SELECT TO "authenticated" USING (("public"."current_user_owns_rights_holder"("rights_holder_id") OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"])));


--
-- Name: rettighedshavere Brugere og orgadmins kan se rettighedshavere; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og orgadmins kan se rettighedshavere" ON "public"."rettighedshavere" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."current_user_can_admin_rights_holder"("id")));


--
-- Name: screening_claims Brugere og orgadmins kan se visningskrav; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og orgadmins kan se visningskrav" ON "public"."screening_claims" FOR SELECT TO "authenticated" USING ((("profile_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"])));


--
-- Name: contract_episodes Brugere og orgroller kan se kontraktafnsit; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og orgroller kan se kontraktafnsit" ON "public"."contract_episodes" FOR SELECT TO "authenticated" USING (("public"."current_user_owns_contract"("contract_id") OR (EXISTS ( SELECT 1
   FROM "public"."contracts" "contract_row"
  WHERE (("contract_row"."id" = "contract_episodes"."contract_id") AND "public"."current_user_belongs_to_org"("contract_row"."org_id"))))));


--
-- Name: contracts Brugere og orgroller kan se kontrakter; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og orgroller kan se kontrakter" ON "public"."contracts" FOR SELECT TO "authenticated" USING (("public"."current_user_owns_rights_holder"("rights_holder_id") OR "public"."current_user_belongs_to_org"("org_id")));


--
-- Name: contract_reviews Brugere og orgroller kan se kontraktgennemgange; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og orgroller kan se kontraktgennemgange" ON "public"."contract_reviews" FOR SELECT TO "authenticated" USING ((("member_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."current_user_belongs_to_org"("org_id")));


--
-- Name: contract_validations Brugere og orgroller kan se valideringer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Brugere og orgroller kan se valideringer" ON "public"."contract_validations" FOR SELECT TO "authenticated" USING (("public"."current_user_owns_contract"("contract_id") OR "public"."current_user_belongs_to_org"("org_id")));


--
-- Name: overenskomst_satser Indloggede kan læse satser; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Indloggede kan læse satser" ON "public"."overenskomst_satser" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));


--
-- Name: learned_patterns Indloggede kan se aktive læringsmønstre; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Indloggede kan se aktive læringsmønstre" ON "public"."learned_patterns" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));


--
-- Name: employers Indloggede kan se arbejdsgivere; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Indloggede kan se arbejdsgivere" ON "public"."employers" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));


--
-- Name: employer_registries Indloggede kan se arbejdsgiverforeninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Indloggede kan se arbejdsgiverforeninger" ON "public"."employer_registries" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));


--
-- Name: organisations Indloggede kan se organisationer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Indloggede kan se organisationer" ON "public"."organisations" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));


--
-- Name: org_affiliations Orgadmins kan opdatere organisationstilknytninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgadmins kan opdatere organisationstilknytninger" ON "public"."org_affiliations" FOR UPDATE TO "authenticated" USING ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"])) WITH CHECK ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: works Orgadmins kan opdatere værker; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgadmins kan opdatere værker" ON "public"."works" FOR UPDATE TO "authenticated" USING ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"])) WITH CHECK ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: work_assignments Orgadmins kan opdatere værktilknytninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgadmins kan opdatere værktilknytninger" ON "public"."work_assignments" FOR UPDATE TO "authenticated" USING ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"])) WITH CHECK ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: org_affiliations Orgadmins kan oprette organisationstilknytninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgadmins kan oprette organisationstilknytninger" ON "public"."org_affiliations" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: rettighedshavere Orgadmins kan oprette rettighedshavere; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgadmins kan oprette rettighedshavere" ON "public"."rettighedshavere" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_any_role"(ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: works Orgadmins kan oprette værker; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgadmins kan oprette værker" ON "public"."works" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: work_assignments Orgadmins kan oprette værktilknytninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgadmins kan oprette værktilknytninger" ON "public"."work_assignments" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: contracts Orgadmins kan slette kontrakter; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgadmins kan slette kontrakter" ON "public"."contracts" FOR DELETE TO "authenticated" USING ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text", 'jurist'::"text"]));


--
-- Name: org_affiliations Orgadmins kan slette organisationstilknytninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgadmins kan slette organisationstilknytninger" ON "public"."org_affiliations" FOR DELETE TO "authenticated" USING ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: rettighedshavere Orgadmins kan slette rettighedshavere; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgadmins kan slette rettighedshavere" ON "public"."rettighedshavere" FOR DELETE TO "authenticated" USING ("public"."current_user_can_admin_rights_holder"("id"));


--
-- Name: works Orgadmins kan slette værker; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgadmins kan slette værker" ON "public"."works" FOR DELETE TO "authenticated" USING ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: work_assignments Orgadmins kan slette værktilknytninger; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgadmins kan slette værktilknytninger" ON "public"."work_assignments" FOR DELETE TO "authenticated" USING ("public"."current_user_has_org_role"("org_id", ARRAY['superadmin'::"text", 'admin'::"text", 'org-admin'::"text"]));


--
-- Name: analysis_feedback Orgroller kan se analysefeedback; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgroller kan se analysefeedback" ON "public"."analysis_feedback" FOR SELECT TO "authenticated" USING ((("org_id" IS NULL) OR "public"."current_user_belongs_to_org"("org_id")));


--
-- Name: case_learnings Orgroller kan se sagserfaringer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgroller kan se sagserfaringer" ON "public"."case_learnings" FOR SELECT TO "authenticated" USING ((("org_id" IS NULL) OR "public"."current_user_belongs_to_org"("org_id")));


--
-- Name: knowledge_chunks Orgroller kan se videnbidder; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Orgroller kan se videnbidder" ON "public"."knowledge_chunks" FOR SELECT TO "authenticated" USING ((("org_id" IS NULL) OR "public"."current_user_belongs_to_org"("org_id")));


--
-- Name: admin_message_deletion_audit; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."admin_message_deletion_audit" ENABLE ROW LEVEL SECURITY;

--
-- Name: agreements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."agreements" ENABLE ROW LEVEL SECURITY;

--
-- Name: analysis_feedback; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."analysis_feedback" ENABLE ROW LEVEL SECURITY;

--
-- Name: broadcasters; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."broadcasters" ENABLE ROW LEVEL SECURITY;

--
-- Name: case_learnings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."case_learnings" ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_ai_jobs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."contract_ai_jobs" ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_attachments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."contract_attachments" ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_comments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."contract_comments" ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_episodes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."contract_episodes" ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_reviews; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."contract_reviews" ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_validations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."contract_validations" ENABLE ROW LEVEL SECURITY;

--
-- Name: contracts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."contracts" ENABLE ROW LEVEL SECURITY;

--
-- Name: employer_registries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."employer_registries" ENABLE ROW LEVEL SECURITY;

--
-- Name: employers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."employers" ENABLE ROW LEVEL SECURITY;

--
-- Name: episodes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."episodes" ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_chunks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."knowledge_chunks" ENABLE ROW LEVEL SECURITY;

--
-- Name: learned_patterns; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."learned_patterns" ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_note_history; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."legal_note_history" ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_notes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."legal_notes" ENABLE ROW LEVEL SECURITY;

--
-- Name: org_affiliations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."org_affiliations" ENABLE ROW LEVEL SECURITY;

--
-- Name: organisations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."organisations" ENABLE ROW LEVEL SECURITY;

--
-- Name: overenskomst_satser; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."overenskomst_satser" ENABLE ROW LEVEL SECURITY;

--
-- Name: overenskomst_uploads; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."overenskomst_uploads" ENABLE ROW LEVEL SECURITY;

--
-- Name: reference_docs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."reference_docs" ENABLE ROW LEVEL SECURITY;

--
-- Name: rettighedshavere; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."rettighedshavere" ENABLE ROW LEVEL SECURITY;

--
-- Name: screening_claim_comments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."screening_claim_comments" ENABLE ROW LEVEL SECURITY;

--
-- Name: screening_claims; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."screening_claims" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_org_roles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_org_roles" ENABLE ROW LEVEL SECURITY;

--
-- Name: work_airings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."work_airings" ENABLE ROW LEVEL SECURITY;

--
-- Name: work_assignments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."work_assignments" ENABLE ROW LEVEL SECURITY;

--
-- Name: work_change_request_comments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."work_change_request_comments" ENABLE ROW LEVEL SECURITY;

--
-- Name: work_change_requests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."work_change_requests" ENABLE ROW LEVEL SECURITY;

--
-- Name: work_distributions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."work_distributions" ENABLE ROW LEVEL SECURITY;

--
-- Name: work_external_ids; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."work_external_ids" ENABLE ROW LEVEL SECURITY;

--
-- Name: work_production_numbers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."work_production_numbers" ENABLE ROW LEVEL SECURITY;

--
-- Name: works; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."works" ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA "private"; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA "private" TO "authenticated";
GRANT USAGE ON SCHEMA "private" TO "service_role";


--
-- Name: SCHEMA "public"; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


--
-- Name: FUNCTION "current_user_belongs_to_org"("target_org_id" "uuid"); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION "private"."current_user_belongs_to_org"("target_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."current_user_belongs_to_org"("target_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "private"."current_user_belongs_to_org"("target_org_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "current_user_can_admin_rights_holder"("target_rights_holder_id" "uuid"); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION "private"."current_user_can_admin_rights_holder"("target_rights_holder_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."current_user_can_admin_rights_holder"("target_rights_holder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "private"."current_user_can_admin_rights_holder"("target_rights_holder_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "current_user_has_any_role"("allowed_roles" "text"[]); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION "private"."current_user_has_any_role"("allowed_roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."current_user_has_any_role"("allowed_roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "private"."current_user_has_any_role"("allowed_roles" "text"[]) TO "service_role";


--
-- Name: FUNCTION "current_user_has_org_role"("target_org_id" "uuid", "allowed_roles" "text"[]); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION "private"."current_user_has_org_role"("target_org_id" "uuid", "allowed_roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."current_user_has_org_role"("target_org_id" "uuid", "allowed_roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "private"."current_user_has_org_role"("target_org_id" "uuid", "allowed_roles" "text"[]) TO "service_role";


--
-- Name: FUNCTION "current_user_is_assigned_to_work"("target_work_id" "uuid"); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION "private"."current_user_is_assigned_to_work"("target_work_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."current_user_is_assigned_to_work"("target_work_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "private"."current_user_is_assigned_to_work"("target_work_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "current_user_owns_contract"("target_contract_id" "uuid"); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION "private"."current_user_owns_contract"("target_contract_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."current_user_owns_contract"("target_contract_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "private"."current_user_owns_contract"("target_contract_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "current_user_owns_rights_holder"("target_rights_holder_id" "uuid"); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION "private"."current_user_owns_rights_holder"("target_rights_holder_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."current_user_owns_rights_holder"("target_rights_holder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "private"."current_user_owns_rights_holder"("target_rights_holder_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "auth_rights_holder_id"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."auth_rights_holder_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auth_rights_holder_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_rights_holder_id"() TO "service_role";


--
-- Name: FUNCTION "claim_next_contract_ai_job"("p_job_id" "uuid", "p_org_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."claim_next_contract_ai_job"("p_job_id" "uuid", "p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_next_contract_ai_job"("p_job_id" "uuid", "p_org_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "current_user_belongs_to_org"("target_org_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."current_user_belongs_to_org"("target_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_belongs_to_org"("target_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_belongs_to_org"("target_org_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "current_user_can_admin_rights_holder"("target_rights_holder_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."current_user_can_admin_rights_holder"("target_rights_holder_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_can_admin_rights_holder"("target_rights_holder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_can_admin_rights_holder"("target_rights_holder_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "current_user_has_any_role"("allowed_roles" "text"[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."current_user_has_any_role"("allowed_roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_has_any_role"("allowed_roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_has_any_role"("allowed_roles" "text"[]) TO "service_role";


--
-- Name: FUNCTION "current_user_has_org_role"("target_org_id" "uuid", "allowed_roles" "text"[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."current_user_has_org_role"("target_org_id" "uuid", "allowed_roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_has_org_role"("target_org_id" "uuid", "allowed_roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_has_org_role"("target_org_id" "uuid", "allowed_roles" "text"[]) TO "service_role";


--
-- Name: FUNCTION "current_user_is_assigned_to_work"("target_work_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."current_user_is_assigned_to_work"("target_work_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_is_assigned_to_work"("target_work_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_is_assigned_to_work"("target_work_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "current_user_owns_contract"("target_contract_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."current_user_owns_contract"("target_contract_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_owns_contract"("target_contract_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_owns_contract"("target_contract_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "current_user_owns_rights_holder"("target_rights_holder_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."current_user_owns_rights_holder"("target_rights_holder_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_owns_rights_holder"("target_rights_holder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_owns_rights_holder"("target_rights_holder_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "handle_new_user"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";


--
-- Name: FUNCTION "is_org_admin"("check_org_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."is_org_admin"("check_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_org_admin"("check_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_admin"("check_org_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "rls_auto_enable"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";


--
-- Name: FUNCTION "upsert_work_for_member"("p_org_id" "uuid", "p_title" "text", "p_type" "text", "p_year" integer, "p_dfi_id" "text", "p_tmdb_id" integer, "p_description" "text", "p_poster_url" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."upsert_work_for_member"("p_org_id" "uuid", "p_title" "text", "p_type" "text", "p_year" integer, "p_dfi_id" "text", "p_tmdb_id" integer, "p_description" "text", "p_poster_url" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_work_for_member"("p_org_id" "uuid", "p_title" "text", "p_type" "text", "p_year" integer, "p_dfi_id" "text", "p_tmdb_id" integer, "p_description" "text", "p_poster_url" "text") TO "service_role";


--
-- Name: TABLE "admin_message_deletion_audit"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_message_deletion_audit" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_message_deletion_audit" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_message_deletion_audit" TO "service_role";


--
-- Name: TABLE "agreements"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agreements" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agreements" TO "authenticated";
GRANT ALL ON TABLE "public"."agreements" TO "service_role";


--
-- Name: TABLE "analysis_feedback"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."analysis_feedback" TO "anon";
GRANT ALL ON TABLE "public"."analysis_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."analysis_feedback" TO "service_role";


--
-- Name: TABLE "broadcasters"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."broadcasters" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."broadcasters" TO "authenticated";
GRANT ALL ON TABLE "public"."broadcasters" TO "service_role";


--
-- Name: TABLE "case_learnings"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."case_learnings" TO "anon";
GRANT ALL ON TABLE "public"."case_learnings" TO "authenticated";
GRANT ALL ON TABLE "public"."case_learnings" TO "service_role";


--
-- Name: TABLE "contract_ai_jobs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contract_ai_jobs" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contract_ai_jobs" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contract_ai_jobs" TO "service_role";


--
-- Name: TABLE "contract_attachments"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contract_attachments" TO "anon";
GRANT ALL ON TABLE "public"."contract_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_attachments" TO "service_role";


--
-- Name: TABLE "contract_comments"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contract_comments" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contract_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_comments" TO "service_role";


--
-- Name: TABLE "contract_episodes"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contract_episodes" TO "anon";
GRANT ALL ON TABLE "public"."contract_episodes" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_episodes" TO "service_role";


--
-- Name: TABLE "contract_reviews"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contract_reviews" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contract_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_reviews" TO "service_role";


--
-- Name: TABLE "contract_validations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contract_validations" TO "anon";
GRANT ALL ON TABLE "public"."contract_validations" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_validations" TO "service_role";


--
-- Name: TABLE "contracts"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contracts" TO "anon";
GRANT ALL ON TABLE "public"."contracts" TO "authenticated";
GRANT ALL ON TABLE "public"."contracts" TO "service_role";


--
-- Name: TABLE "employer_registries"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."employer_registries" TO "anon";
GRANT ALL ON TABLE "public"."employer_registries" TO "authenticated";
GRANT ALL ON TABLE "public"."employer_registries" TO "service_role";


--
-- Name: TABLE "employers"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."employers" TO "anon";
GRANT ALL ON TABLE "public"."employers" TO "authenticated";
GRANT ALL ON TABLE "public"."employers" TO "service_role";


--
-- Name: TABLE "episodes"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."episodes" TO "anon";
GRANT ALL ON TABLE "public"."episodes" TO "authenticated";
GRANT ALL ON TABLE "public"."episodes" TO "service_role";


--
-- Name: TABLE "knowledge_chunks"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."knowledge_chunks" TO "anon";
GRANT ALL ON TABLE "public"."knowledge_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."knowledge_chunks" TO "service_role";


--
-- Name: TABLE "learned_patterns"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."learned_patterns" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."learned_patterns" TO "authenticated";
GRANT ALL ON TABLE "public"."learned_patterns" TO "service_role";


--
-- Name: TABLE "legal_note_history"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."legal_note_history" TO "anon";
GRANT ALL ON TABLE "public"."legal_note_history" TO "authenticated";
GRANT ALL ON TABLE "public"."legal_note_history" TO "service_role";


--
-- Name: TABLE "legal_notes"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."legal_notes" TO "anon";
GRANT ALL ON TABLE "public"."legal_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."legal_notes" TO "service_role";


--
-- Name: TABLE "org_affiliations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."org_affiliations" TO "anon";
GRANT ALL ON TABLE "public"."org_affiliations" TO "authenticated";
GRANT ALL ON TABLE "public"."org_affiliations" TO "service_role";


--
-- Name: TABLE "organisations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organisations" TO "anon";
GRANT ALL ON TABLE "public"."organisations" TO "authenticated";
GRANT ALL ON TABLE "public"."organisations" TO "service_role";


--
-- Name: TABLE "overenskomst_satser"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."overenskomst_satser" TO "anon";
GRANT ALL ON TABLE "public"."overenskomst_satser" TO "authenticated";
GRANT ALL ON TABLE "public"."overenskomst_satser" TO "service_role";


--
-- Name: TABLE "overenskomst_uploads"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."overenskomst_uploads" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."overenskomst_uploads" TO "authenticated";
GRANT ALL ON TABLE "public"."overenskomst_uploads" TO "service_role";


--
-- Name: TABLE "reference_docs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reference_docs" TO "anon";
GRANT ALL ON TABLE "public"."reference_docs" TO "authenticated";
GRANT ALL ON TABLE "public"."reference_docs" TO "service_role";


--
-- Name: TABLE "rettighedshavere"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."rettighedshavere" TO "anon";
GRANT ALL ON TABLE "public"."rettighedshavere" TO "authenticated";
GRANT ALL ON TABLE "public"."rettighedshavere" TO "service_role";


--
-- Name: TABLE "screening_claim_comments"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."screening_claim_comments" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."screening_claim_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."screening_claim_comments" TO "service_role";


--
-- Name: TABLE "screening_claims"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."screening_claims" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."screening_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."screening_claims" TO "service_role";


--
-- Name: TABLE "user_org_roles"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_org_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_org_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_org_roles" TO "service_role";


--
-- Name: TABLE "work_airings"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."work_airings" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."work_airings" TO "authenticated";
GRANT ALL ON TABLE "public"."work_airings" TO "service_role";


--
-- Name: TABLE "work_assignments"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."work_assignments" TO "anon";
GRANT ALL ON TABLE "public"."work_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."work_assignments" TO "service_role";


--
-- Name: TABLE "work_change_request_comments"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."work_change_request_comments" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."work_change_request_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."work_change_request_comments" TO "service_role";


--
-- Name: TABLE "work_change_requests"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."work_change_requests" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."work_change_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."work_change_requests" TO "service_role";


--
-- Name: TABLE "work_distributions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."work_distributions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."work_distributions" TO "authenticated";
GRANT ALL ON TABLE "public"."work_distributions" TO "service_role";


--
-- Name: TABLE "work_external_ids"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."work_external_ids" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."work_external_ids" TO "authenticated";
GRANT ALL ON TABLE "public"."work_external_ids" TO "service_role";


--
-- Name: TABLE "work_production_numbers"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."work_production_numbers" TO "anon";
GRANT ALL ON TABLE "public"."work_production_numbers" TO "authenticated";
GRANT ALL ON TABLE "public"."work_production_numbers" TO "service_role";


--
-- Name: TABLE "works"; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."works" TO "anon";
GRANT ALL ON TABLE "public"."works" TO "authenticated";
GRANT ALL ON TABLE "public"."works" TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- PostgreSQL database dump complete
--

-- \unrestrict LmcuqwIjs7P5dr5Y24QrIjsHeicRZNgApkk1CV2PZq2t0TzWr0ATuygu3Tictx5
