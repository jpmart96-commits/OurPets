#!/usr/bin/env bash
# Copies the app's date/stock maths into the Edge Functions that need it (send-reminders, calendar) so the
# server computes "days left" exactly like the app. Run after changing src/lib/{calc,dates,types}.ts.
set -euo pipefail
cd "$(dirname "$0")/.."
for dst in supabase/functions/send-reminders supabase/functions/calendar; do
  mkdir -p "$dst"
  for f in calc dates types; do
    sed -E "s#from '\./(calc|dates|types)'#from './\1.ts'#g" "src/lib/$f.ts" > "$dst/$f.ts"
  done
  echo "synced calc.ts, dates.ts, types.ts -> $dst"
done
