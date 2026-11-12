#!/usr/bin/env bash
# Runs the migration and access-rule tests on a local Postgres (no Supabase needed).
# Usage: PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists bart_test" -c "create database bart_test"
$P -d bart_test -f supabase/tests/supabase_stub.sql
$P -d bart_test -f supabase/migrations/0001_core.sql
$P -d bart_test -f supabase/migrations/0003_report_review.sql
$P -d bart_test -f supabase/migrations/0004_counters_chat_photos.sql
$P -d bart_test -f supabase/migrations/0005_handoff_codes.sql
$P -d bart_test -f supabase/migrations/0006_lock_listings_in_trades.sql
$P -d bart_test -f supabase/migrations/0007_campus_feed.sql
$P -d bart_test -f supabase/migrations/0008_notifications.sql
$P -d bart_test -f supabase/migrations/0009_safety.sql
$P -d bart_test -f supabase/migrations/0010_pauses.sql
$P -d bart_test -f supabase/migrations/0011_categories_spots_times.sql
$P -d bart_test -f supabase/migrations/0012_map_places.sql
$P -d bart_test -f supabase/migrations/0013_typed_times.sql
$P -d bart_test -f supabase/migrations/0014_earlier_start.sql
$P -d bart_test -f supabase/migrations/0015_confirm_and_calendar.sql
$P -d bart_test -f supabase/migrations/0016_word_filter.sql
$P -d bart_test -f supabase/migrations/0017_profile_photos.sql
$P -d bart_test -f supabase/migrations/0018_trade_of_the_week_dates.sql
$P -d bart_test -f supabase/migrations/0019_class_year.sql
$P -d bart_test -f supabase/migrations/0020_blocking_and_push.sql
$P -d bart_test -f supabase/migrations/0021_feed_photos.sql
$P -d bart_test -f supabase/tests/grants_stub.sql
$P -d bart_test -f supabase/tests/access_rules_test.sql
