-- A sign-in whose browser comes back to the machine that started it. loopback: "<port>/<key>", the
-- temporary address on that machine. proof: SHA-256 of the one-time secret sent there, which the poll
-- must show before a token is minted. Both NULL: the sign-in with the confirm page and its code.
ALTER TABLE signins ADD COLUMN loopback TEXT;
ALTER TABLE signins ADD COLUMN proof TEXT;
