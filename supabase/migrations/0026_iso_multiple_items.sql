-- "I have it" on a Wanted request can now offer more than one thing from your closet.
-- Before, each person could answer a request with one item; now one row per item.
alter table iso_responses drop constraint iso_responses_pkey;
alter table iso_responses add primary key (iso_id, responder_id, listing_id);
