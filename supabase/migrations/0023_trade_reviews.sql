-- Past trade recap: both people's star ratings for one trade.
-- You see the rating the other person gave you only after you've rated them,
-- so nobody rates in reaction to the score they got.
create or replace function trade_reviews(p_offer uuid)
returns table (my_stars int, their_stars int, they_rated boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  o offers;
  other uuid;
  mine int;
  theirs int;
begin
  select * into o from offers where id = p_offer;
  if o.id is null or auth.uid() not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  other := case when o.from_user = auth.uid() then o.to_user else o.from_user end;
  select stars into mine from ratings where offer_id = p_offer and rater_id = auth.uid();
  select stars into theirs from ratings where offer_id = p_offer and rater_id = other;
  return query select mine, case when mine is not null then theirs end, theirs is not null;
end $$;

revoke execute on function trade_reviews(uuid) from public, anon;
grant execute on function trade_reviews(uuid) to authenticated;
notify pgrst, 'reload schema';
