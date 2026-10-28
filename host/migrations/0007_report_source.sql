-- Who made a report: 'viewer' ("Report this link") or 'auto' (the upload's scan found a password or
-- card number field, scan.mjs). Reports from before this have none and are a viewer's. Additive; run
-- again, it fails with "duplicate column" and changes nothing.
ALTER TABLE reports ADD COLUMN source TEXT;
