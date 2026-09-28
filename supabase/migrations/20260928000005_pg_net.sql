-- pg_net lets the database call HTTP endpoints (used for testing the product-lookup function, and later for scheduled reminders).
create extension if not exists pg_net with schema extensions;
