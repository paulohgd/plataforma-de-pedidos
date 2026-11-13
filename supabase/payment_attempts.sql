-- Rodar no SQL Editor do Supabase (idempotente).
alter table public.orders add column if not exists payment_method text not null default '';
alter table public.orders add column if not exists parent_order_id uuid references public.orders (id) on delete set null;
alter table public.orders add column if not exists payment_duplicate boolean not null default false;
alter table public.orders add column if not exists payment_duplicate_note text not null default '';

create index if not exists orders_parent_key on public.orders (parent_order_id) where parent_order_id is not null;
