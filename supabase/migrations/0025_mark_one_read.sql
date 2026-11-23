-- Tapping a notification clears just that one (used for updates with no trade or post attached,
-- like "Your account is active again"). Everything else clears by trade/post with mark_read.
create or replace function mark_one_read(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now()
   where id = p_id and user_id = auth.uid() and read_at is null
$$;

revoke execute on function mark_one_read(uuid) from public, anon;
grant execute on function mark_one_read(uuid) to authenticated;
