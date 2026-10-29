-- The admin marks which WhatsApp contact receives messages about requests, cleanings and comments
-- sent from the QR app (the sender taps a wa.me link; nothing is sent automatically).
alter table contacts add column if not exists notify_on_events boolean not null default false;
