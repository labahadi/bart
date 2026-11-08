-- Supabase grants table access to these roles by default; RLS then narrows it.
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
