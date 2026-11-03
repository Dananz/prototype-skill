-- A link its owner turned off: the page, card and viewer API refuse until it is turned back on. The
-- page and comments are kept, unlike a remove. NULL: on.
ALTER TABLE shares ADD COLUMN disabled_at INTEGER;
