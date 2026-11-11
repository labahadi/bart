-- bart: profile photos
--
-- Adds an optional profile photo. Like every other photo, it goes through the server
-- (src/app/api/photo/route.ts, kind = "avatar"), which checks it with AI and only then
-- stores it in the public listing-photos bucket under <user id>/avatar-<random>.jpg.
--
-- Safe to run before the redesign branch is merged: it only adds a nullable column.

alter table profiles add column if not exists avatar_path text;

-- A profile can only point at a photo in its own folder that the server named as an avatar.
-- Phones can't upload into that folder themselves (0009_safety.sql removed that), so any
-- file there has passed the photo check.
create or replace function profiles_check_avatar() returns trigger
language plpgsql as $$
begin
  if new.avatar_path is not null
     and new.avatar_path !~ ('^' || new.id::text || '/avatar-[0-9a-f]{32}\.jpg$') then
    raise exception 'That photo can''t be used as a profile photo.';
  end if;
  return new;
end $$;

drop trigger if exists profiles_avatar_check on profiles;
create trigger profiles_avatar_check
  before insert or update of avatar_path on profiles
  for each row execute function profiles_check_avatar();
