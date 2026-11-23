-- bart: six more item categories (12 in all)
-- Run after 0001–0023 in the Supabase SQL Editor.
-- Existing ones keep their ids; the app now labels them:
--   textbooks = "School supplies", dorm = "Dorm & decor", skills = "Skills & lessons"
alter type listing_category add value if not exists 'tech';
alter type listing_category add value if not exists 'kitchen';
alter type listing_category add value if not exists 'accessories';
alter type listing_category add value if not exists 'sports';
alter type listing_category add value if not exists 'games';
alter type listing_category add value if not exists 'beauty';
