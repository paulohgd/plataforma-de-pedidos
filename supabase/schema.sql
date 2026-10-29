-- Cada conta tem uma loja. O cardápio público fica em /loja/nome-da-loja.
-- Apagar a conta apaga a loja, o cardápio e as fotos.

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  whatsapp text not null default '',
  address text not null default '',
  hours text not null default '',
  is_open boolean not null default true,
  open_label text not null default 'Aberto agora',
  closed_label text not null default 'Loja fechada',
  slug text,
  created_at timestamptz not null default now()
);

create unique index if not exists shops_owner_id_key on public.shops (owner_id);

delete from public.shops where owner_id is null;
alter table public.shops drop constraint if exists shops_owner_id_fkey;
alter table public.shops
  add constraint shops_owner_id_fkey
  foreign key (owner_id) references auth.users (id) on delete cascade;
alter table public.shops alter column owner_id set not null;

alter table public.shops add column if not exists slug text;

update public.shops
set slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
where slug is null or btrim(slug) = '';

update public.shops
set slug = 'loja'
where slug is null or btrim(slug) = '';

alter table public.shops alter column slug set not null;
create unique index if not exists shops_slug_key on public.shops (slug);
drop index if exists shops_one_row;

create table if not exists public.categories (
  shop_id uuid not null references public.shops (id) on delete cascade,
  id text not null,
  name text not null,
  position integer not null default 0,
  primary key (shop_id, id)
);

create table if not exists public.products (
  shop_id uuid not null references public.shops (id) on delete cascade,
  id text not null,
  category_id text not null,
  kind text not null default 'simple',
  name text not null,
  description text not null default '',
  price numeric(10, 2) not null default 0,
  image text not null default '',
  featured boolean not null default false,
  position integer not null default 0,
  primary key (shop_id, id),
  foreign key (shop_id, category_id) references public.categories (shop_id, id) on update cascade on delete restrict,
  constraint products_kind check (kind in ('beef', 'chicken', 'sandwich', 'fries', 'simple')),
  constraint products_price check (price >= 0 and price <= 9999)
);

alter table public.shops enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.shops, public.categories, public.products to anon, authenticated;
grant insert, update, delete on public.shops, public.categories, public.products to authenticated;

drop policy if exists shops_select on public.shops;
drop policy if exists shops_insert on public.shops;
drop policy if exists shops_update on public.shops;
drop policy if exists shops_claim on public.shops;
drop policy if exists categories_select on public.categories;
drop policy if exists categories_write on public.categories;
drop policy if exists products_select on public.products;
drop policy if exists products_write on public.products;

create policy shops_select on public.shops
  for select to anon, authenticated
  using (true);

create policy shops_insert on public.shops
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and not exists (select 1 from public.shops as existing where existing.owner_id = auth.uid())
  );

create policy shops_update on public.shops
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy categories_select on public.categories
  for select to anon, authenticated
  using (true);

create policy categories_write on public.categories
  for all to authenticated
  using (
    exists (
      select 1 from public.shops
      where shops.id = categories.shop_id and shops.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.shops
      where shops.id = categories.shop_id and shops.owner_id = auth.uid()
    )
  );

create policy products_select on public.products
  for select to anon, authenticated
  using (true);

create policy products_write on public.products
  for all to authenticated
  using (
    exists (
      select 1 from public.shops
      where shops.id = products.shop_id and shops.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.shops
      where shops.id = products.shop_id and shops.owner_id = auth.uid()
    )
  );

create or replace function public.create_store(shop jsonb, categories jsonb, products jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_id uuid;
  raw_slug text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if exists (select 1 from public.shops where owner_id = auth.uid()) then
    raise exception 'shop exists';
  end if;

  raw_slug := lower(coalesce(shop->>'slug', ''));
  if raw_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(raw_slug) > 48 then
    raise exception 'invalid slug';
  end if;
  if exists (select 1 from public.shops where slug = raw_slug) then
    raise exception 'slug taken';
  end if;

  insert into public.shops (owner_id, slug, name, whatsapp, address, hours, is_open, open_label, closed_label)
  values (
    auth.uid(),
    raw_slug,
    left(coalesce(nullif(shop->>'name', ''), 'Loja'), 80),
    left(coalesce(shop->>'whatsapp', ''), 15),
    left(coalesce(shop->>'address', ''), 120),
    left(coalesce(shop->>'hours', ''), 80),
    coalesce((shop->>'is_open')::boolean, true),
    left(coalesce(nullif(shop->>'open_label', ''), 'Aberto agora'), 60),
    left(coalesce(nullif(shop->>'closed_label', ''), 'Loja fechada'), 80)
  )
  returning id into new_id;

  insert into public.categories (shop_id, id, name, position)
  select
    new_id,
    c->>'id',
    left(c->>'name', 40),
    coalesce((c->>'position')::integer, 0)
  from jsonb_array_elements(categories) as c;

  insert into public.products (shop_id, id, category_id, kind, name, description, price, image, featured, position)
  select
    new_id,
    p->>'id',
    p->>'category_id',
    coalesce(p->>'kind', 'simple'),
    left(p->>'name', 80),
    left(coalesce(p->>'description', ''), 400),
    coalesce((p->>'price')::numeric, 0),
    coalesce(p->>'image', ''),
    coalesce((p->>'featured')::boolean, false),
    coalesce((p->>'position')::integer, 0)
  from jsonb_array_elements(products) as p;

  return new_id;
end;
$$;

revoke execute on function public.create_store(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_store(jsonb, jsonb, jsonb) to authenticated;

create or replace function public.delete_shop_files()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  delete from storage.objects
  where bucket_id = 'products'
    and (storage.foldername(name))[1] = old.owner_id::text;
  return old;
exception
  when others then
    return old;
end;
$$;

drop trigger if exists shops_delete_files on public.shops;
create trigger shops_delete_files
  before delete on public.shops
  for each row
  execute function public.delete_shop_files();

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('products', 'products', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists products_bucket_read on storage.objects;
drop policy if exists products_bucket_insert on storage.objects;
drop policy if exists products_bucket_update on storage.objects;
drop policy if exists products_bucket_delete on storage.objects;

create policy products_bucket_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'products');

create policy products_bucket_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'products'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy products_bucket_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'products'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'products'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy products_bucket_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'products'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
