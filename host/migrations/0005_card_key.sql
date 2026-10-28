-- A share's preview card, the JPEG chats show for its link: drawn on the owner's Mac when the link is
-- published and uploaded beside the page. Each upload writes its own KV key (card:<id>:<random>) and
-- the row names the live one. NULL: no card of its own (the site's card stands in).
ALTER TABLE shares ADD COLUMN card_key TEXT;
