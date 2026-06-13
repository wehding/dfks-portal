-- Tilføj risikovurderingsfelter til contract_reviews
-- risk_level: LAV | MELLEM | HØJ (udtrækt fra AI-output, gemmes separat fra analyseteksten)
-- should_escalate: true hvis AI vurderer at sagen bør eskaleres

alter table contract_reviews
  add column if not exists risk_level      text,
  add column if not exists should_escalate boolean;
