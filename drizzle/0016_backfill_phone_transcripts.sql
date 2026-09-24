-- Direct SIP calls have source-specific IDs even in records created before the
-- conversation source column existed. Older turn-by-turn calls used UUIDs and
-- cannot be backfilled reliably without guessing.
UPDATE conversation_messages
SET source = 'phone'
WHERE source = 'local'
  AND (id GLOB 'sip_user_*' OR id GLOB 'sip_assistant_*');
