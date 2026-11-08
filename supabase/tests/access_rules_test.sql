-- Access-rule tests: run on a throwaway database after the migration.
-- Simulates three students and checks who can see and change what.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
\o /dev/null

create schema t;
grant usage on schema t to authenticated;
create table t.results (n serial, name text, ok boolean, detail text);
grant all on t.results to authenticated; grant usage on sequence t.results_n_seq to authenticated;

-- run SQL, expect it to fail with a message matching pattern
create function t.expect_error(name text, q text, pattern text) returns void language plpgsql as $$
begin
  begin
    execute q;
    insert into t.results (name, ok, detail) values (name, false, 'no error raised');
  exception when others then
    insert into t.results (name, ok, detail) values (name, sqlerrm ~* pattern, sqlerrm);
  end;
end $$;
create function t.expect(name text, cond boolean, detail text default null) returns void language sql as $$
  insert into t.results (name, ok, detail) values (name, coalesce(cond, false), detail)
$$;
grant execute on all functions in schema t to authenticated;

create function t.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u::text, false); end $$;
grant execute on function t.as_user(uuid) to authenticated;

-- Sign-up: Penn emails (incl. subdomains) allowed, others refused
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alex@seas.upenn.edu'),
  ('00000000-0000-0000-0000-00000000000b', 'jordan@wharton.upenn.edu'),
  ('00000000-0000-0000-0000-00000000000c', 'riley@upenn.edu');
select t.expect_error('gmail sign-up refused',
  $$insert into auth.users (email) values ('someone@gmail.com')$$, 'upenn.edu');
select t.expect_error('look-alike domain refused',
  $$insert into auth.users (email) values ('x@upenn.edu.evil.com')$$, 'upenn.edu');
select t.expect('profiles created for Penn users', (select count(*) = 3 from profiles));

set role authenticated;

-- Before agreeing to the house rules, you can't post
select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.expect_error('cannot post before house rules',
  $$insert into listings (title, category, tier) values ('Desk lamp', 'dorm', 'S')$$, 'row-level security');

select t.as_user('00000000-0000-0000-0000-00000000000a'); select complete_signup('Alex', 'k');
select t.as_user('00000000-0000-0000-0000-00000000000b'); select complete_signup('Jordan', 'L');
select t.as_user('00000000-0000-0000-0000-00000000000c'); select complete_signup('Riley', 'K');

select t.expect('initial uppercased', (select last_initial = 'K' from profiles where first_name = 'Alex'));

-- Posting
select t.as_user('00000000-0000-0000-0000-00000000000b');
insert into listings (id, title, category, tier, wants)
  values ('10000000-0000-0000-0000-000000000001', 'Mini fridge, 3.1 cu ft', 'dorm', 'M', 'bike lock, snacks');
select t.as_user('00000000-0000-0000-0000-00000000000a');
insert into listings (id, title, category, tier) values
  ('20000000-0000-0000-0000-000000000001', 'U-lock bike lock', 'dorm', 'S'),
  ('20000000-0000-0000-0000-000000000002', 'Desk lamp', 'dorm', 'S');
insert into listings (id, title, category, tier) values
  ('20000000-0000-0000-0000-000000000003', '1 hr Python help', 'skills', 'M');
select t.expect('skills forced to Skill tier',
  (select tier = 'Skill' from listings where id = '20000000-0000-0000-0000-000000000003'));
select t.expect_error('banned item blocked',
  $$insert into listings (title) values ('Midterm answer key for ECON 1')$$, 'banned');
select t.expect_error('banned plural blocked',
  $$insert into listings (title) values ('Two vapes')$$, 'banned');
insert into listings (title, description) values ('Blazer, size M', 'In incredible condition, worn twice');
select t.expect('"incredible" is allowed', exists (select 1 from listings where title = 'Blazer, size M'));
select t.expect_error('cannot post as someone else',
  $$insert into listings (owner_id, title) values ('00000000-0000-0000-0000-00000000000b', 'Fake')$$, 'row-level security');

-- Others can't edit my listing
select t.as_user('00000000-0000-0000-0000-00000000000c');
update listings set title = 'Hacked' where id = '20000000-0000-0000-0000-000000000002';
select t.expect('cannot edit others'' listings',
  (select title = 'Desk lamp' from listings where id = '20000000-0000-0000-0000-000000000002'));
select t.expect('cannot see emails: profiles has no email column',
  not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name ilike '%mail%'));
select t.expect_error('cannot read auth.users',
  $$select email from auth.users$$, 'permission denied');

-- Offers
select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.expect_error('cannot offer someone else''s item',
  $$select create_offer('10000000-0000-0000-0000-000000000001',
     array['10000000-0000-0000-0000-000000000001']::uuid[], '{}', 'van-pelt')$$, 'own closet');
select t.expect_error('cannot offer on own listing',
  $$select create_offer('20000000-0000-0000-0000-000000000002',
     array['20000000-0000-0000-0000-000000000001']::uuid[], '{}', 'van-pelt')$$, 'yourself');
create temp table ids as
  select create_offer('10000000-0000-0000-0000-000000000001',
    array['20000000-0000-0000-0000-000000000001']::uuid[], array['Coffee on me', 'Free money'], 'van-pelt') as offer_id;
select t.expect('unknown sweeteners dropped',
  (select sweeteners = array['Coffee on me'] from offers where id = (select offer_id from ids)));
select t.expect_error('no direct offer inserts',
  $$insert into offers (listing_id, from_user, to_user) values ('10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')$$, 'row-level security');
update offers set status = 'accepted' where id = (select offer_id from ids);
select t.expect('sender cannot self-accept by direct update',
  (select status = 'pending' from offers where id = (select offer_id from ids)));
select t.expect_error('sender cannot accept via function',
  format($$select respond_offer(%L, 'accept')$$, (select offer_id from ids)), 'Only the owner');

-- Riley also offers on the fridge (with the Python help listing? that's Alex's — use a new item)
select t.as_user('00000000-0000-0000-0000-00000000000c');
insert into listings (id, title, category, tier) values ('30000000-0000-0000-0000-000000000001', 'Desk chair', 'dorm', 'M');
create temp table ids2 as
  select create_offer('10000000-0000-0000-0000-000000000001',
    array['30000000-0000-0000-0000-000000000001']::uuid[], '{}', 'houston') as offer_id;
select t.expect('Riley cannot see Alex''s offer', not exists (select 1 from offers where id = (select offer_id from ids)));
select t.expect_error('Riley cannot message in Alex''s trade',
  format($$insert into messages (offer_id, body) values (%L, 'hi')$$, (select offer_id from ids)), 'row-level security');

-- Jordan (owner) accepts Alex's offer
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.expect('owner sees both incoming offers', (select count(*) = 2 from offers where to_user = auth.uid()));
select respond_offer((select offer_id from ids), 'accept');
select t.expect('accepted, spot carried over',
  (select status = 'accepted' and meet_spot = 'van-pelt' from offers where id = (select offer_id from ids)));
select t.expect('competing offer auto-declined',
  (select status = 'declined' from offers where id = (select offer_id from ids2)));
select t.expect('items in trade leave the feed',
  (select bool_and(status = 'in_trade') from listings
    where id in ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001')));

-- Chat
insert into messages (offer_id, body) values ((select offer_id from ids), 'Deal! Coffee from the cart on Locust?');
select t.as_user('00000000-0000-0000-0000-00000000000a');
insert into messages (offer_id, body) values ((select offer_id from ids), 'Perfect. Van Pelt lobby after my exam?');
select t.expect('both see the chat', (select count(*) = 2 from messages where offer_id = (select offer_id from ids)));
select t.expect_error('cannot send as the other person',
  format($$insert into messages (offer_id, sender_id, body) values (%L, '00000000-0000-0000-0000-00000000000b', 'x')$$,
         (select offer_id from ids)), 'row-level security');
select t.expect('Alex can still see the fridge while in trade',
  exists (select 1 from listings where id = '10000000-0000-0000-0000-000000000001'));
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect('Riley still sees the fridge on her declined offer', exists (select 1 from listings where id = '10000000-0000-0000-0000-000000000001'));
select t.expect('Riley sees no messages', not exists (select 1 from messages));

-- Meetups: daytime and Safe Spots only
select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.expect_error('8 PM meetup refused',
  format($$select set_meetup(%L, 'van-pelt', (date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 20 hours') at time zone 'America/New_York')$$,
    (select offer_id from ids)), 'daytime');
select t.expect_error('unlisted spot refused',
  format($$select set_meetup(%L, 'my-dorm', now() + interval '2 days')$$, (select offer_id from ids)), 'Safe Spot');
select set_meetup((select offer_id from ids), 'houston',
  (date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 16 hours') at time zone 'America/New_York');
select t.expect('4 PM meetup saved', (select meet_spot = 'houston' from offers where id = (select offer_id from ids)));

-- Completion and rating
select t.expect_error('cannot rate before confirming', format($$select rate_trade(%L, 5)$$, (select offer_id from ids)), 'complete first');
select t.expect('first confirm keeps it accepted', (select confirm_complete((select offer_id from ids)) = 'accepted'));
select rate_trade((select offer_id from ids), 5);
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.expect('second confirm completes', (select confirm_complete((select offer_id from ids)) = 'completed'));
select t.expect('items marked traded',
  (select bool_and(status = 'traded') from listings
    where id in ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001')));
select t.expect('Jordan''s stats show the rating',
  (select rating = 5.0 and trades = 1 from trader_stats('00000000-0000-0000-0000-00000000000b')));
select t.expect_error('cannot rate yourself 6 stars', format($$select rate_trade(%L, 6)$$, (select offer_id from ids)), 'check');

-- Reports: anonymous, write-only, 3 reports hides a listing
select t.as_user('00000000-0000-0000-0000-00000000000a');
insert into reports (listing_id, reason) values ('30000000-0000-0000-0000-000000000001', 'scam');
select t.expect('reporter cannot read reports', not exists (select 1 from reports));
select t.expect_error('cannot report twice',
  $$insert into reports (listing_id, reason) values ('30000000-0000-0000-0000-000000000001', 'scam')$$, 'duplicate');
select t.as_user('00000000-0000-0000-0000-00000000000b');
insert into reports (listing_id, reason) values ('30000000-0000-0000-0000-000000000001', 'banned_item');
select t.expect('still visible after 2 reports', exists (select 1 from listings where id = '30000000-0000-0000-0000-000000000001'));
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'sam@sas.upenn.edu');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000d');
select t.expect('a bystander no longer sees traded items',
  not exists (select 1 from listings where id in ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001')));
insert into reports (listing_id, reason) values ('30000000-0000-0000-0000-000000000001', 'other');
select t.expect('hidden after 3 reports', not exists (select 1 from listings where id = '30000000-0000-0000-0000-000000000001'));
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect_error('owner cannot un-hide a reported listing',
  $$update listings set status = 'active' where id = '30000000-0000-0000-0000-000000000001'$$, 'review');
select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.expect_error('owner cannot mark traded by hand',
  $$update listings set status = 'traded' where id = '20000000-0000-0000-0000-000000000002'$$, 'automatically');

reset role;
\o
select case when ok then 'PASS' else 'FAIL' end as result, name, case when not ok then detail end as detail
from t.results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
