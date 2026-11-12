-- Optional class year on profiles: a graduation year like 2028, or 'Grad' for grad students.
-- People set it themselves in Settings; it shows on their profile.
alter table profiles add column if not exists class_year text;
do $$ begin
  alter table profiles add constraint profiles_class_year_check
    check (class_year is null or class_year ~ '^20[2-4][0-9]$' or class_year = 'Grad');
exception when duplicate_object then null; end $$;
