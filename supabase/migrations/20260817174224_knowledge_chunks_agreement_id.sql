-- Tilføj agreement_id fremmednøgle til knowledge_chunks
-- Formål: kobl hvert chunk direkte til agreements-registeret i stedet for at nøgle på en løs tekststreng.
-- Kolonnen er nullable i transitionen — eksisterende rækker får agreement_id sat via engangsmapping nedenfor.

ALTER TABLE knowledge_chunks
    ADD COLUMN IF NOT EXISTS agreement_id uuid REFERENCES agreements(id) ON DELETE SET NULL;

-- ── Engangsmigration: map kendte korte id'er til agreements.id ────────────────
-- Kilde for mappingen: codeMap i lib/retrieval.ts (de kendte aliaser pr. 2026-08-17).
-- Rækker der ikke matcher nogen known id-streng rapporteres nedenfor — ikke slettet.

DO $$
DECLARE
    known_mappings text[][] := ARRAY[
        ARRAY['de4',            'de4-fiction-2022'],
        ARRAY['de4-fiktion',    'de4-fiction-2022'],
        ARRAY['de4-fiction-2022','de4-fiction-2022'],
        ARRAY['faf',            'faf-fiction-2025'],
        ARRAY['faf-fiction-2025','faf-fiction-2025'],
        ARRAY['faf-dokumentar', 'faf-documentary'],
        ARRAY['faf-documentary','faf-documentary'],
        ARRAY['dj',             'dj-tv-2024'],
        ARRAY['dj-tv-2024',     'dj-tv-2024'],
        ARRAY['metal',          'dr-metal-2025'],
        ARRAY['dr-metal-2025',  'dr-metal-2025']
    ];
    mapping text[];
    agr_id uuid;
    updated_count bigint;
BEGIN
    FOREACH mapping SLICE 1 IN ARRAY known_mappings LOOP
        SELECT id INTO agr_id FROM agreements WHERE code = mapping[2] LIMIT 1;
        IF agr_id IS NOT NULL THEN
            UPDATE knowledge_chunks
                SET agreement_id = agr_id
            WHERE overenskomst = mapping[1]
              AND agreement_id IS NULL;

            GET DIAGNOSTICS updated_count = ROW_COUNT;
            IF updated_count > 0 THEN
                RAISE NOTICE 'Mappet % chunks: overenskomst=% → agreements.id=%', updated_count, mapping[1], agr_id;
            END IF;
        ELSE
            RAISE NOTICE 'Ingen agreements.code=% fundet — chunk med overenskomst=% forbliver umappede', mapping[2], mapping[1];
        END IF;
    END LOOP;
END $$;

-- ── Verifikationstæller — kør efter migration for at se hvad der mangler ──────
-- SELECT COUNT(*) AS umappede, overenskomst
-- FROM knowledge_chunks
-- WHERE agreement_id IS NULL AND overenskomst IS NOT NULL
-- GROUP BY overenskomst
-- ORDER BY COUNT(*) DESC;
