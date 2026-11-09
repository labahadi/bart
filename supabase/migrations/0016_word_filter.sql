-- Stronger word filter:
--  1. Swearing, slurs and threats are blocked everywhere (chat, comments, names, listings, ISO).
--  2. Reviewers can add or remove blocked words from the Review reports page; they work right away.
--  3. First names are one word, so nobody can put a full name in the name field.

alter table banned_terms add column if not exists added_by uuid references profiles(id) on delete set null;
alter table banned_terms add column if not exists added_at timestamptz;

insert into banned_terms (term, kind, everywhere) values
  ('fuck', 'language', true), ('fucking', 'language', true), ('fucker', 'language', true), ('fucked', 'language', true),
  ('motherfucker', 'language', true), ('fck', 'language', true), ('fuk', 'language', true), ('stfu', 'language', true),
  ('shit', 'language', true), ('shitty', 'language', true), ('bullshit', 'language', true),
  ('bitch', 'language', true), ('cunt', 'language', true), ('asshole', 'language', true), ('dickhead', 'language', true),
  ('bastard', 'language', true), ('whore', 'language', true), ('slut', 'language', true), ('hoe', 'language', true),
  ('retard', 'slur', true), ('retarded', 'slur', true), ('faggot', 'slur', true), ('fag', 'slur', true),
  ('nigger', 'slur', true), ('nigga', 'slur', true), ('chink', 'slur', true), ('spic', 'slur', true),
  ('kike', 'slur', true), ('tranny', 'slur', true), ('dyke', 'slur', true), ('wetback', 'slur', true),
  ('gook', 'slur', true), ('raghead', 'slur', true),
  ('kys', 'threat', true), ('kill yourself', 'threat', true), ('kill you', 'threat', true)
on conflict (term) do update set everywhere = true, kind = excluded.kind;

-- The full list, so the app can warn while you type (it's enforced here either way)
create or replace function banned_term_list() returns table (term text, everywhere boolean, custom boolean)
language sql stable security definer set search_path = public as $$
  select term, everywhere, added_by is not null from banned_terms order by term
$$;
grant execute on function banned_term_list() to authenticated;

-- Reviewers add a word: "everywhere" (chat too) or listings and ISO only
create or replace function add_banned_term(p_term text, p_everywhere boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare
  t text := lower(regexp_replace(trim(coalesce(p_term, '')), '\s+', ' ', 'g'));
begin
  if not is_reviewer() then raise exception 'Only bart reviewers can do this.'; end if;
  if char_length(t) < 2 or char_length(t) > 40 then raise exception 'Words are 2 to 40 characters.'; end if;
  if t !~ '^[a-z0-9 ''-]+$' then raise exception 'Use letters, numbers, spaces, hyphens or apostrophes.'; end if;
  insert into banned_terms (term, kind, everywhere, added_by, added_at)
  values (t, 'added by reviewer', coalesce(p_everywhere, true), auth.uid(), now())
  on conflict (term) do update set everywhere = excluded.everywhere or banned_terms.everywhere;
end $$;
grant execute on function add_banned_term(text, boolean) to authenticated;

-- Reviewers can only remove words a reviewer added (the built-in list stays)
create or replace function remove_banned_term(p_term text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_reviewer() then raise exception 'Only bart reviewers can do this.'; end if;
  delete from banned_terms where term = lower(trim(p_term)) and added_by is not null;
end $$;
grant execute on function remove_banned_term(text) to authenticated;

-- Names: one word (Mary-Kate is fine, "Mary Smith" isn't), and no blocked words
create or replace function profiles_check_name() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.first_name ~ '\s' then
    raise exception 'Just your first name, as one word (for example Mary-Kate).';
  end if;
  if blocked_anywhere(new.first_name) is not null then
    raise exception 'Pick a different name.';
  end if;
  return new;
end $$;
