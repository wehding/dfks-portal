-- jsonb_build_object is STABLE in PostgreSQL, so callers cannot truthfully be
-- marked IMMUTABLE even though the sanitizer itself does not query table data.
alter function private.audit_sanitize_row(jsonb) stable;
