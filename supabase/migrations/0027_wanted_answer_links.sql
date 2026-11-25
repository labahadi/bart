-- "Jordan has a desk lamp for your request" now opens Wanted (Your asks), not Campus.
create or replace function notify_iso_response() returns trigger
language plpgsql security definer set search_path = public as $$
declare i iso_posts;
begin
  select * into i from iso_posts where id = new.iso_id;
  perform notify(i.author_id, 'campus', 'iso',
    first_name_of(new.responder_id) || ' has ' || (select title from listings where id = new.listing_id) || ' for your request',
    '/wanted?iso=' || new.iso_id, new.iso_id);
  return new;
end $$;

-- Fix the links on answers people already got
update notifications set link = '/wanted?iso=' || ref where kind = 'iso' and ref is not null;
notify pgrst, 'reload schema';
