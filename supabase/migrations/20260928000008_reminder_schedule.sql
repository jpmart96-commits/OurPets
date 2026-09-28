-- Run the reminder sender every 5 minutes. The cron secret lives in private.app_config (set once, not in git):
--   insert into private.app_config(key, value) values
--     ('vapid_public', '<public key>'), ('vapid_private', '<private key>'),
--     ('vapid_subject', 'mailto:you@example.com'), ('cron_secret', '<random string>');
select cron.schedule('ourpets-reminders', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://gqasnxmvloofdphaminj.supabase.co/functions/v1/send-reminders',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from private.app_config where key = 'cron_secret')),
    timeout_milliseconds := 30000)
$$);
select cron.schedule('ourpets-trim-net-responses', '17 3 * * *', $$ delete from net._http_response where created < now() - interval '1 day' $$);
