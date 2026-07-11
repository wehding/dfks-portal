-- Tilføj jurist-svar felter til contract_reviews
-- jurist_response: det svar der vises for medlemmet (aldrig AI-analysen)
-- jurist_response_at: hvornår juristen sendte svaret

alter table contract_reviews
  add column if not exists jurist_response    text,
  add column if not exists jurist_response_at timestamptz;
