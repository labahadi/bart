-- Access-rule tests: run on a throwaway database after the migration.
-- Simulates three students and checks who can see and change what.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
\o /dev/null

create schema t;
grant usage on schema t to authenticated, anon;
create table t.results (n serial, name text, ok boolean, detail text);
grant all on t.results to authenticated, anon; grant usage on sequence t.results_n_seq to authenticated, anon;

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
grant execute on all functions in schema t to authenticated, anon;

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
  format($$select respond_offer(%L, 'accept')$$, (select offer_id from ids)), 'Only the owner|turn');

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
select t.expect_error('9 PM meetup refused',
  format($$select set_meetup(%L, 'van-pelt', (date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 21 hours') at time zone 'America/New_York')$$,
    (select offer_id from ids)), '8 PM');
select t.expect_error('8:30 PM meetup refused',
  format($$select set_meetup(%L, 'van-pelt', (date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 20 hours 30 minutes') at time zone 'America/New_York')$$,
    (select offer_id from ids)), '8 PM');
select t.expect_error('7:15 AM meetup refused',
  format($$select set_meetup(%L, 'van-pelt', (date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 7 hours 15 minutes') at time zone 'America/New_York')$$,
    (select offer_id from ids)), '7:30 AM');
select set_meetup((select offer_id from ids), 'stommons',
  (date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 7 hours 30 minutes') at time zone 'America/New_York');
select t.expect('7:30 AM sharp is allowed', (select meet_spot = 'stommons' from offers where id = (select offer_id from ids)));
select t.expect_error('time an hour ago refused',
  format($$select set_meetup(%L, 'van-pelt', now() - interval '1 hour')$$, (select offer_id from ids)), 'already passed');
select t.expect_error('a month out refused',
  format($$select set_meetup(%L, 'van-pelt', now() + interval '30 days')$$, (select offer_id from ids)), 'two weeks');
select set_meetup((select offer_id from ids), 'houston',
  (date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 20 hours') at time zone 'America/New_York');
select t.expect('8:00 PM sharp is allowed', (select meet_spot = 'houston' from offers where id = (select offer_id from ids)));
select set_meetup((select offer_id from ids), 'rodin',
  (date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 14 hours 15 minutes') at time zone 'America/New_York');
select t.expect('2:15 PM (any minute) is allowed', (select meet_spot = 'rodin' from offers where id = (select offer_id from ids)));
select t.expect_error('unlisted spot refused',
  format($$select set_meetup(%L, 'my-dorm', now() + interval '2 days')$$, (select offer_id from ids)), 'spot from the list');
select set_meetup((select offer_id from ids), 'houston',
  (date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 16 hours') at time zone 'America/New_York');
select t.expect('4 PM meetup saved', (select meet_spot = 'houston' from offers where id = (select offer_id from ids)));

-- Propose and confirm: Alex just set it, so it's a proposal from Alex
select t.expect('new meetup is a proposal from Alex', (select meet_proposed_by = '00000000-0000-0000-0000-00000000000a' and meet_confirmed_at is null from offers where id = (select offer_id from ids)));
select t.expect_error('proposer cannot confirm their own', format($$select confirm_meetup(%L)$$, (select offer_id from ids)), 'other person confirms');
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.expect('Jordan was told about the proposal', exists (select 1 from notifications where user_id = auth.uid() and kind = 'meetup' and body like '%proposed a meetup%'));
select confirm_meetup((select offer_id from ids));
select t.expect('Jordan confirmed', (select meet_confirmed_at is not null from offers where id = (select offer_id from ids)));
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect_error('outsider cannot confirm', format($$select confirm_meetup(%L)$$, (select offer_id from ids)), 'not found');
select t.as_user('00000000-0000-0000-0000-00000000000b');
select set_meetup((select offer_id from ids), 'van-pelt',
  (date_trunc('day', now() at time zone 'America/New_York') + interval '3 days 11 hours') at time zone 'America/New_York');
select t.expect('changing it makes a new proposal from Jordan', (select meet_proposed_by = '00000000-0000-0000-0000-00000000000b' and meet_confirmed_at is null from offers where id = (select offer_id from ids)));
select t.as_user('00000000-0000-0000-0000-00000000000a');
select confirm_meetup((select offer_id from ids));
select t.expect('Alex confirmed the new time', (select meet_confirmed_at is not null from offers where id = (select offer_id from ids)));
select t.expect_error('people cannot write calendar tokens directly',
  $$insert into calendar_links (user_id, account_email, refresh_token) values (auth.uid(), 'x@upenn.edu', 'secret')$$, 'row-level security');
select t.expect('people cannot read calendar tokens', not exists (select 1 from calendar_links));
select t.expect('my_calendar is empty until linked', not exists (select 1 from my_calendar()));

-- Share with a friend: a link anyone can open, showing only the plan
create temp table share_tok as select share_meetup((select offer_id from ids)) as t;
grant select on share_tok to public;
select t.expect('same link every time', (select share_meetup((select offer_id from ids)) = (select t from share_tok)));
set role anon;
select t.expect('a friend with the link sees the plan',
  (select first_name = 'Alex' and confirmed and place is not null and gives is not null and gets is not null from shared_meetup((select t from share_tok))));
select t.expect('a made-up link shows nothing', not exists (select 1 from shared_meetup('nope')));
select t.expect('the friend cannot list share links', not exists (select 1 from meetup_shares));
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect_error('an outsider cannot make a link', format($$select share_meetup(%L)$$, (select offer_id from ids)), 'not found');
select t.as_user('00000000-0000-0000-0000-00000000000a');

-- Word filter: swearing blocked everywhere, reviewers add words, names are one word
select t.expect_error('swearing blocked in chat',
  format($$insert into messages (offer_id, body) values (%L, 'this is bullsh1t')$$, (select offer_id from ids)), 'row-level security');
select t.expect('swearing caught with disguises', blocked_anywhere('f u c k') is null and blocked_anywhere('fuuuck') is not null);
select t.expect('normal words still fine', blocked_anywhere('Shoe rack, Scunthorpe hoodie, class notes') is null);
select t.expect_error('non-reviewer cannot add words', $$select add_banned_term('zorp')$$, 'reviewers');
select t.expect_error('one-word first names', $$select complete_signup('Alex Smith', 'k')$$, 'one word');

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

-- Report review screen
select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.expect_error('non-reviewer cannot see report queue', $$select * from report_queue()$$, 'reviewers');
select t.expect_error('non-reviewer cannot resolve', $$select resolve_report('30000000-0000-0000-0000-000000000001', 'keep')$$, 'reviewers');
select t.expect_error('cannot make yourself a reviewer',
  $$insert into reviewers (user_id) values ('00000000-0000-0000-0000-00000000000a')$$, 'row-level security');
reset role;
insert into reviewers (user_id) values ('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.expect('reviewer sees the reported listing with 3 open reports',
  (select open_count = 3 and title = 'Desk chair' and owner_name = 'Riley K.' from report_queue()));
select t.expect('queue has no reporter identities',
  not exists (select 1 from information_schema.routines r join information_schema.parameters p
              on p.specific_name = r.specific_name
              where r.routine_name = 'report_queue' and p.parameter_name ilike '%reporter%'));
select add_banned_term('Zorpium', true);
select t.expect('reviewer-added word blocks right away', blocked_anywhere('selling ZORPIUM cheap') = 'zorpium');
select remove_banned_term('fuck');
select t.expect('built-in words cannot be removed', blocked_anywhere('fuck') is not null);
select remove_banned_term('zorpium');
select t.expect('reviewer-added word can be removed', blocked_anywhere('zorpium') is null);
select resolve_report('30000000-0000-0000-0000-000000000001', 'keep');
select t.expect('keep restores the listing', (select status = 'active' from listings where id = '30000000-0000-0000-0000-000000000001'));
select t.expect('resolved reports leave the open queue', not exists (select 1 from report_queue()));
select t.expect('reviewed reports still visible in history', exists (select 1 from report_queue(true)));
select resolve_report('30000000-0000-0000-0000-000000000001', 'remove');
select t.expect('remove takes it down', (select status = 'removed' from listings where id = '30000000-0000-0000-0000-000000000001'));

-- Counter offers
select t.as_user('00000000-0000-0000-0000-00000000000c');
insert into listings (id, title, category, tier) values ('30000000-0000-0000-0000-000000000002', 'Rain jacket, size S', 'clothes', 'M');
select t.as_user('00000000-0000-0000-0000-00000000000a');
create temp table ids3 as
  select create_offer('30000000-0000-0000-0000-000000000002',
    array['20000000-0000-0000-0000-000000000002']::uuid[], '{}', 'van-pelt') as offer_id;
select t.expect_error('sender cannot accept on owner''s turn',
  format($$select respond_offer(%L, 'accept')$$, (select offer_id from ids3)), 'turn');
select t.expect_error('sender cannot counter on owner''s turn',
  format($$select counter_offer(%L, array['20000000-0000-0000-0000-000000000003']::uuid[], '{}')$$, (select offer_id from ids3)), 'turn');
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect_error('counter cannot ask for owner''s own items',
  format($$select counter_offer(%L, array['30000000-0000-0000-0000-000000000002']::uuid[], '{}')$$, (select offer_id from ids3)), 'their closet');
select counter_offer((select offer_id from ids3), array['20000000-0000-0000-0000-000000000003']::uuid[], array['Coffee on me']);
select t.expect('counter swaps the items',
  (select array_agg(listing_id) = array['20000000-0000-0000-0000-000000000003']::uuid[] from offer_items where offer_id = (select offer_id from ids3)));
select t.expect('counter passes the turn to the sender',
  (select awaiting = '00000000-0000-0000-0000-00000000000a' and counter_count = 1 from offers where id = (select offer_id from ids3)));
select t.expect('counter leaves a chat note',
  exists (select 1 from messages where offer_id = (select offer_id from ids3) and body = 'Countered: 1 hr Python help + coffee on me'));
select t.expect_error('owner cannot accept own counter',
  format($$select respond_offer(%L, 'accept')$$, (select offer_id from ids3)), 'turn');
select t.as_user('00000000-0000-0000-0000-00000000000a');
select respond_offer((select offer_id from ids3), 'accept');
select t.expect('sender accepts the counter',
  (select status = 'accepted' from offers where id = (select offer_id from ids3)));
select t.expect('countered item is in the trade, original is not',
  (select status = 'in_trade' from listings where id = '20000000-0000-0000-0000-000000000003')
  and (select status = 'active' from listings where id = '20000000-0000-0000-0000-000000000002'));

-- Photos in chat (photo messages are written by the server after the AI check)
select t.expect_error('phones cannot add photo messages directly',
  format($$insert into messages (offer_id, image_path) values (%L, %L)$$, (select offer_id from ids3), (select offer_id from ids3)::text || '/x.jpg'), 'row-level security');
reset role;
select t.expect_error('photo must be in this trade''s folder',
  format($$insert into messages (offer_id, sender_id, image_path) values (%L, '00000000-0000-0000-0000-00000000000a', 'someone-else/x.jpg')$$, (select offer_id from ids3)), 'image_in_trade_folder');
select t.expect_error('empty message refused',
  format($$insert into messages (offer_id, sender_id) values (%L, '00000000-0000-0000-0000-00000000000a')$$, (select offer_id from ids3)), 'has_content');
insert into messages (offer_id, sender_id, image_path) select offer_id, '00000000-0000-0000-0000-00000000000a', offer_id::text || '/photo.jpg' from ids3;
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.expect('photo-only message saved by the server is visible',
  exists (select 1 from messages where image_path is not null and body is null));

-- Finishing a trade with a code
select t.as_user('00000000-0000-0000-0000-00000000000c');
create temp table riley_code as select code from handoff_code((select offer_id from ids3));
select t.expect('code is 4 digits', (select code ~ '^[0-9]{4}$' from riley_code));
select t.expect('asking again keeps the same code',
  (select code from handoff_code((select offer_id from ids3))) = (select code from riley_code));
select t.expect('codes cannot be read directly', not exists (select 1 from handoff_codes));
select t.expect('Riley cannot complete with her own code',
  confirm_handoff((select offer_id from ids3), (select code from riley_code)) = 'expired');
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.expect_error('outsider cannot get a code', format($$select * from handoff_code(%L)$$, (select offer_id from ids3)), 'not found');
select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.expect('wrong code is refused',
  confirm_handoff((select offer_id from ids3), case (select code from riley_code) when '0000' then '1111' else '0000' end) = 'wrong');
select t.expect('trade still open after wrong code', (select status = 'accepted' from offers where id = (select offer_id from ids3)));
select t.expect('right code completes the trade',
  confirm_handoff((select offer_id from ids3), (select code from riley_code)) = 'completed');
select t.expect('completed for both, items traded',
  (select status = 'completed' and from_confirmed and to_confirmed from offers where id = (select offer_id from ids3))
  and (select status = 'traded' from listings where id = '30000000-0000-0000-0000-000000000002'));
select rate_trade((select offer_id from ids3), 4);
select t.expect('both can rate after a code handoff', exists (select 1 from ratings where offer_id = (select offer_id from ids3)));

-- Editing listings
select t.as_user('00000000-0000-0000-0000-00000000000a');
update listings set title = 'Desk lamp, brass', wants = 'snacks' where id = '20000000-0000-0000-0000-000000000002';
select t.expect('owner can edit an active listing', (select title = 'Desk lamp, brass' from listings where id = '20000000-0000-0000-0000-000000000002'));
select t.expect_error('banned words blocked on edit',
  $$update listings set title = 'Desk lamp + vodka' where id = '20000000-0000-0000-0000-000000000002'$$, 'banned');
select t.expect_error('cannot edit an item in a trade',
  $$update listings set title = 'Broken bike lock' where id = '20000000-0000-0000-0000-000000000001'$$, 'in a trade');

-- Campus feed
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect_error('outsider cannot share someone else''s trade',
  format($$select share_trade(%L)$$, (select offer_id from ids)), 'not found');
select t.as_user('00000000-0000-0000-0000-00000000000a');
create temp table post1 as select share_trade((select offer_id from ids), 'Coffee was great') as post_id;
select t.expect('post written from the sharer''s side',
  (select gave = 'U-lock bike lock' and got = 'Mini fridge, 3.1 cu ft' from feed_posts where id = (select post_id from post1)));
select t.expect_error('one post per trade', format($$select share_trade(%L)$$, (select offer_id from ids)), 'already');
select t.expect_error('no direct posts',
  format($$insert into feed_posts (offer_id, author_id, gave, got) values (%L, auth.uid(), 'a', 'b')$$, (select offer_id from ids3)), 'row-level security');
select t.expect_error('banned note refused', format($$select share_trade(%L, 'bring vodka')$$, (select offer_id from ids3)), 'banned');
create temp table post2 as select share_trade((select offer_id from ids3)) as post_id;
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect_error('cannot share an unfinished trade', format($$select share_trade(%L)$$, (select offer_id from ids2)), 'finished');
insert into post_likes (post_id) select post_id from post2;
select t.expect_error('cannot like twice', $$insert into post_likes (post_id) select post_id from post2$$, 'duplicate');
select t.expect_error('cannot like as someone else',
  $$insert into post_likes (post_id, user_id) select post_id, '00000000-0000-0000-0000-00000000000a' from post1$$, 'row-level security');
insert into post_comments (post_id, body) select post_id, 'Nice swap!' from post2;
select t.expect_error('banned comment refused', $$insert into post_comments (post_id, body) select post_id, 'got any nudes' from post2$$, 'row-level security');
select t.expect('feed shows counts and my like',
  (select like_count = 1 and comment_count = 1 and liked from campus_feed() where id = (select post_id from post2)));
select t.expect('Trade of the Week is the most-liked post', trade_of_the_week() = (select post_id from post2));
select t.as_user('00000000-0000-0000-0000-00000000000b');
insert into post_likes (post_id) select post_id from post1;
select t.as_user('00000000-0000-0000-0000-00000000000d');
reset role; update profiles set rules_accepted_at = now(), first_name = 'Sam' where id = '00000000-0000-0000-0000-00000000000d'; set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000d');
insert into post_likes (post_id) select post_id from post1;
select t.expect('more likes takes the lead', trade_of_the_week() = (select post_id from post1));

select t.expect('featured: this week''s most-liked, not marked last week',
  (select post_id = (select post_id from post1) and not last_week and week_start = (date_trunc('week', now() at time zone 'America/New_York'))::date from featured_trade()));
-- Move post1 (3 likes) to last week: this week's post2 (1 like) now leads this week
reset role;
update feed_posts set created_at = ((date_trunc('week', now() at time zone 'America/New_York') - interval '3 days 12 hours') at time zone 'America/New_York')
 where id = (select post_id from post1);
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.expect('a liked post this week beats a bigger one from last week',
  (select post_id = (select post_id from post2) and not last_week from featured_trade()));
-- No likes this week: last week's winner stays up, marked as last week
select t.as_user('00000000-0000-0000-0000-00000000000c');
delete from post_likes where post_id = (select post_id from post2);
select t.expect('no likes this week shows last week''s winner',
  (select post_id = (select post_id from post1) and last_week from featured_trade()));
-- Two weeks ago doesn't count
reset role;
update feed_posts set created_at = created_at - interval '7 days' where id = (select post_id from post1);
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect('nothing from two weeks ago', not exists (select 1 from featured_trade()));

select t.as_user('00000000-0000-0000-0000-00000000000a');
update profiles set class_year = '2028' where id = auth.uid();
select t.expect('class year saves', (select class_year = '2028' from profiles where id = auth.uid()));
select t.expect_error('class year must be a year or Grad', $$update profiles set class_year = 'sophomore' where id = auth.uid()$$, 'class_year');
update profiles set class_year = 'Grad' where id = auth.uid();
update profiles set class_year = '2029' where id = '00000000-0000-0000-0000-00000000000b';
select t.expect('cannot set someone else''s class year', (select class_year is null from profiles where id = '00000000-0000-0000-0000-00000000000b'));

-- ISO board
select t.as_user('00000000-0000-0000-0000-00000000000c');
insert into iso_posts (id, want, can_offer) values ('40000000-0000-0000-0000-000000000001', 'Rain jacket, size S', 'guitar lessons');
select t.expect_error('banned want refused', $$insert into iso_posts (want) values ('fake id')$$, 'row-level security');
select t.expect_error('cannot answer your own ISO',
  $$insert into iso_responses (iso_id, listing_id) values ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001')$$, 'row-level security');
select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.expect_error('can only answer with your own active item',
  $$insert into iso_responses (iso_id, listing_id) values ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')$$, 'row-level security');
insert into iso_responses (iso_id, listing_id) values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002');
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.expect('others cannot see who responded', not exists (select 1 from iso_responses));
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect('ISO author sees the response', exists (select 1 from iso_responses where iso_id = '40000000-0000-0000-0000-000000000001'));
update iso_posts set open = false where id = '40000000-0000-0000-0000-000000000001';
select t.as_user('00000000-0000-0000-0000-00000000000b');
update iso_posts set open = true where id = '40000000-0000-0000-0000-000000000001';
select t.expect('others cannot reopen it', (select not open from iso_posts where id = '40000000-0000-0000-0000-000000000001'));

-- Notifications (created by the database as everything above happened)
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.expect('owner was told about the new offer',
  exists (select 1 from notifications where kind = 'offer' and ref = (select offer_id from ids) and body like 'Alex sent an offer for your Mini fridge%'));
select t.expect('messages collapse into one notification',
  (select count(*) = 1 from notifications where kind = 'message' and ref = (select offer_id from ids)));
select t.expect('cannot see other people''s notifications',
  not exists (select 1 from notifications where user_id <> auth.uid()));
select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.expect('sender was told the offer was accepted',
  exists (select 1 from notifications where kind = 'status' and ref = (select offer_id from ids) and body like 'Jordan accepted%'));
select t.expect('nobody is notified about their own actions',
  not exists (select 1 from notifications where kind = 'offer' and user_id = auth.uid() and body like 'Alex %'));
select t.expect('likes collapse with a count',
  exists (select 1 from notifications where kind = 'like' and ref = (select post_id from post1) and count = 2 and body like '% and 1 other liked your trade'));
select t.expect('comment on my post notified me', exists (select 1 from notifications where kind = 'comment' and body like 'Riley commented: Nice swap!%'));
select t.expect('counter notified me', exists (select 1 from notifications where kind = 'counter' and body like 'Riley countered%'));
select mark_read('campus');
select t.expect('mark_read clears a tab', not exists (select 1 from notifications where tab = 'campus' and read_at is null));
select t.expect('other tabs stay unread', exists (select 1 from notifications where tab = 'trades' and read_at is null));
select t.expect_error('cannot create notifications directly',
  $$insert into notifications (user_id, tab, kind, body, link) values (auth.uid(), 'me', 'x', 'x', '/')$$, 'row-level security');
select t.expect_error('cannot call notify directly',
  $$select notify('00000000-0000-0000-0000-00000000000b', 'me', 'x', 'spam', '/', null)$$, 'permission denied');
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect('ISO author told about the answer', exists (select 1 from notifications where kind = 'iso' and body like 'Alex has Desk lamp, brass for your ISO'));
-- Saved item traded away
select t.as_user('00000000-0000-0000-0000-00000000000b');
insert into saves (listing_id) values ('20000000-0000-0000-0000-000000000003');
select t.as_user('00000000-0000-0000-0000-00000000000a');
update listings set status = 'removed' where id = '20000000-0000-0000-0000-000000000003';
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.expect('saver told when a saved item goes away', exists (select 1 from notifications where tab = 'me' and kind = 'saved'));

-- Safety: blocked words everywhere
select t.as_user('00000000-0000-0000-0000-00000000000a');
create temp table chat_id as select offer_id from ids2;  -- Riley's declined offer: use an open trade instead
reset role;
insert into listings (id, owner_id, title) values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Toaster');
insert into listings (id, owner_id, title) values ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Kettle');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000a');
create temp table safe_offer as select create_offer('50000000-0000-0000-0000-000000000001', array['50000000-0000-0000-0000-000000000002']::uuid[], '{}', 'van-pelt') as offer_id;
insert into messages (offer_id, body) select offer_id, 'Can we meet after my exam? Summa cum laude vibes, see you in Essex' from safe_offer;
select t.expect('normal chat is allowed', exists (select 1 from messages where body like 'Can we meet after my exam%'));
select t.expect_error('sexual words blocked in chat', $$insert into messages (offer_id, body) select offer_id, 'send nudes' from safe_offer$$, 'row-level security');
select t.expect_error('number disguises blocked', $$insert into messages (offer_id, body) select offer_id, 'ur s3xy' from safe_offer$$, 'row-level security');
select t.expect_error('stretched letters blocked', $$insert into messages (offer_id, body) select offer_id, 'nuuuudes?' from safe_offer$$, 'row-level security');
select t.expect_error('double letters blocked', $$insert into messages (offer_id, body) select offer_id, 'nice boooobs' from safe_offer$$, 'row-level security');
select t.expect('look-alike words allowed', blocked_anywhere('analysis of a peacock in Sussex, dickens novel') is null);
select t.expect('chat still allows listing-only words like weed', blocked_anywhere('I will weed the garden') is null);
insert into post_comments (post_id, body) select post_id, 'great for my exam season' from post2;
select t.expect('comments allow ordinary words like exam', exists (select 1 from post_comments where body = 'great for my exam season'));
select t.expect_error('sexual words blocked in comments', $$insert into post_comments (post_id, body) select post_id, 'so sexy' from post2$$, 'row-level security');
select t.expect_error('sexual names blocked', $$select complete_signup('Sexy', 'A')$$, 'different name');
select t.expect_error('sexual words blocked in listings', $$insert into listings (title) values ('p0rn dvd')$$, 'banned');

-- Safety: chat reports
select t.as_user('00000000-0000-0000-0000-00000000000b');
insert into chat_reports (offer_id, reason, details) select offer_id, 'sexual', 'sent something gross' from safe_offer;
select t.expect('reporter cannot read chat reports', not exists (select 1 from chat_reports));
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect_error('outsider cannot report a chat', $$insert into chat_reports (offer_id, reason) select offer_id, 'other' from safe_offer$$, 'row-level security');
select t.expect_error('non-reviewer cannot see chat reports', $$select * from chat_report_queue()$$, 'reviewers');
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.expect('reviewer sees the chat with its messages',
  (select reason = 'sexual' and other_name = 'Alex' and jsonb_array_length(messages) >= 1 from chat_report_queue() limit 1));
select reviewer_delete_message((select id from messages where body like 'Can we meet after my exam%'));
select t.expect('reviewer can delete a message', not exists (select 1 from messages where body like 'Can we meet after my exam%'));
select resolve_chat_report((select report_id from chat_report_queue() limit 1));
select t.expect('resolved chat reports leave the queue', not exists (select 1 from chat_report_queue()));

-- Pausing accounts (Jordan, b, is a reviewer)
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect_error('non-reviewer cannot pause', $$select pause_account('00000000-0000-0000-0000-00000000000a', 1, 'test')$$, 'reviewers');
reset role;
insert into listings (id, owner_id, title) values ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'Lamp shade');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.expect_error('reviewer cannot pause themselves', $$select pause_account('00000000-0000-0000-0000-00000000000b', 1, 'test')$$, 'yourself');
select t.expect_error('only 1, 3 or 7 days', $$select pause_account('00000000-0000-0000-0000-00000000000c', 2, 'test')$$, '1, 3 or 7');
select pause_listing_owner('60000000-0000-0000-0000-000000000001', 3, 'Sent sexual messages');
select t.expect('paused person shows in the list', exists (select 1 from paused_accounts() where name = 'Riley K.' and past_pauses = 1));
select t.expect('paused person''s listings are hidden', not exists (select 1 from listings where id = '60000000-0000-0000-0000-000000000001'));
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect('paused person is told why', exists (select 1 from notifications where kind = 'paused' and body like 'Your account is paused until % Reason: Sent sexual messages'));
select t.expect('paused person still sees own listing', exists (select 1 from listings where id = '60000000-0000-0000-0000-000000000001'));
select t.expect('paused person sees own pause', exists (select 1 from suspensions));
select t.expect_error('paused: cannot post', $$insert into listings (title) values ('Bike')$$, 'paused');
select t.expect_error('paused: cannot offer',
  $$select create_offer('50000000-0000-0000-0000-000000000001', array['60000000-0000-0000-0000-000000000001']::uuid[], '{}', 'van-pelt')$$, 'paused');
select t.expect_error('paused: cannot comment', $$insert into post_comments (post_id, body) select post_id, 'hi' from post1$$, 'paused');
select t.expect_error('paused: cannot like', $$insert into post_likes (post_id) select post_id from post1$$, 'paused');
select t.expect_error('paused: cannot post to ISO', $$insert into iso_posts (want) values ('Bike')$$, 'paused');
select t.as_user('00000000-0000-0000-0000-00000000000b');
select lift_pause('00000000-0000-0000-0000-00000000000c');
select t.expect('lifting a pause shows listings again', exists (select 1 from listings where id = '60000000-0000-0000-0000-000000000001'));
select t.expect('history counts past pauses', pause_count('00000000-0000-0000-0000-00000000000c') = 1);
select t.as_user('00000000-0000-0000-0000-00000000000c');
insert into listings (title) values ('Bike after pause');
select t.expect('unpaused person can post again', exists (select 1 from listings where title = 'Bike after pause'));
select t.expect('non-reviewer sees 0 pause history for others', pause_count('00000000-0000-0000-0000-00000000000a') = 0);

-- Categories, spots, times, custom places
select t.expect('misc category exists', exists (select 1 from pg_enum where enumlabel = 'misc'));
select t.expect('six meetup spots', (select count(*) = 6 from safe_spots));
reset role;
insert into listings (id, owner_id, title) values ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Rug');
insert into listings (id, owner_id, title) values ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Mirror');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000a');
create temp table late_offer as select create_offer('70000000-0000-0000-0000-000000000001', array['70000000-0000-0000-0000-000000000002']::uuid[], '{}', 'harnwell') as offer_id;
select t.as_user('00000000-0000-0000-0000-00000000000b');
select respond_offer((select offer_id from late_offer), 'accept');
select set_meetup((select offer_id from late_offer), 'stommons',
  (date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 20 hours') at time zone 'America/New_York');
select t.expect('8 PM meetup allowed', (select meet_spot = 'stommons' from offers where id = (select offer_id from late_offer)));
select t.expect_error('9 PM meetup refused',
  $$select set_meetup((select offer_id from late_offer), 'stommons', (date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 21 hours') at time zone 'America/New_York')$$, '8 PM');
select t.expect_error('students cannot set a map place directly',
  $$select set_meetup_place((select offer_id from late_offer), auth.uid(), '1920 Commons', '3800 Locust Walk', 39.9527, -75.1999, 4, false, now() + interval '2 days')$$, 'permission denied');
reset role;
select t.expect_error('off-campus place refused',
  $$select set_meetup_place((select offer_id from late_offer), '00000000-0000-0000-0000-00000000000b', 'Rittenhouse Square', 'Walnut St', 39.9496, -75.1718, 25, false,
    (date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 14 hours') at time zone 'America/New_York')$$, 'off campus');
select set_meetup_place((select offer_id from late_offer), '00000000-0000-0000-0000-00000000000b', '4012 Pine St', '4012 Pine St, Philadelphia, PA', 39.9505, -75.2040, 6, true,
  (date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 14 hours') at time zone 'America/New_York');
select t.expect('on-campus address saved as a pickup',
  (select meet_custom = '4012 Pine St' and meet_pickup and meet_walk_min = 6 and meet_spot is null from offers where id = (select offer_id from late_offer)));
select t.expect('the other person is told, not the one who set it',
  exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-00000000000a' and kind = 'meetup' and body like 'Jordan proposed a meetup%')
  and not exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-00000000000b' and kind = 'meetup' and ref = (select offer_id from late_offer)));
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000b');
select set_meetup((select offer_id from late_offer), 'harnwell',
  (date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 12 hours') at time zone 'America/New_York');
select t.expect('picking a listed spot clears the map place',
  (select meet_spot = 'harnwell' and meet_custom is null and not meet_pickup and meet_lat is null from offers where id = (select offer_id from late_offer)));
set role authenticated;

-- Blocking: Alex blocks Jordan
select t.as_user('00000000-0000-0000-0000-00000000000a');
insert into listings (id, title, category, tier) values ('70000000-0000-0000-0000-0000000000b1', 'Block test lamp', 'dorm', 'S');
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.expect('before blocking, Jordan sees Alex''s listing', exists (select 1 from listings where id = '70000000-0000-0000-0000-0000000000b1'));
select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.expect_error('cannot block yourself', $$select block_user(auth.uid())$$, 'yourself');
select block_user('00000000-0000-0000-0000-00000000000b');
select t.expect('blocking ends the open trade', (select status = 'cancelled' from offers where id = (select offer_id from late_offer)));
select t.expect('Alex sees Jordan in Blocked people', exists (select 1 from my_blocks() where user_id = '00000000-0000-0000-0000-00000000000b' and first_name = 'Jordan'));
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.expect('Jordan can''t see who blocked them', not exists (select 1 from blocks));
select t.expect('Jordan no longer sees Alex''s listing', not exists (select 1 from listings where id = '70000000-0000-0000-0000-0000000000b1'));
select t.expect('Jordan no longer sees Alex''s Campus posts', not exists (select 1 from campus_feed() where author_id = '00000000-0000-0000-0000-00000000000a'));
select t.expect_error('Jordan cannot message Alex', format($$insert into messages (offer_id, body) values (%L, 'hey')$$, (select offer_id from late_offer)), 'message this person');
reset role;
select t.expect_error('even the server cannot add a message between them',
  format($$insert into messages (offer_id, sender_id, body) values (%L, '00000000-0000-0000-0000-00000000000b', 'hey')$$, (select offer_id from late_offer)), 'message this person');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000b');
reset role;
select t.expect_error('no new offers between them',
  $$insert into offers (listing_id, from_user, to_user) values ('70000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a')$$, 'trade with this person');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect('other people still see Alex''s listing', exists (select 1 from listings where id = '70000000-0000-0000-0000-0000000000b1'));
select t.as_user('00000000-0000-0000-0000-00000000000a');
select unblock_user('00000000-0000-0000-0000-00000000000b');
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.expect('after unblocking, Jordan sees the listing again', exists (select 1 from listings where id = '70000000-0000-0000-0000-0000000000b1'));

-- Push subscriptions
select save_push_subscription('https://push.example.com/abc', 'key', 'auth');
select t.expect('a device saves for push', exists (select 1 from push_subscriptions where endpoint = 'https://push.example.com/abc'));
select t.expect_error('only https push addresses', $$select save_push_subscription('http://x', 'k', 'a')$$, 'notifications');
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.expect('nobody else sees your devices', not exists (select 1 from push_subscriptions));
select t.expect('quiet hours on by default', (select quiet_hours from profiles where id = auth.uid()));

reset role;
\o
select case when ok then 'PASS' else 'FAIL' end as result, name, case when not ok then detail end as detail
from t.results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
