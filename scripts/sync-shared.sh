#!/usr/bin/env bash
# Copies the app's date/stock maths into the send-reminders Edge Function so the server
# computes "days left" exactly like the app. Run after changing src/lib/{calc,dates,types}.ts.
set -euo pipefail
cd "$(dirname "$0")/.."
dst=supabase/functions/send-reminders
for f in calc dates types; do
  sed -E "s#from '\./(calc|dates|types)'#from './\1.ts'#g" "src/lib/$f.ts" > "$dst/$f.ts"
done
echo "synced calc.ts, dates.ts, types.ts -> $dst"
