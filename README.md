# GreenPocket — Full Supabase setup

แอปรายรับรายจ่ายบน Expo Snack SDK 55 พร้อมระบบสมาชิก แยกข้อมูลผู้ใช้ แก้ไขรายการ เลือกวันที่ สรุปรายเดือน กราฟ งบประมาณ หมวดหมู่ ค้นหา และส่งออก CSV

## เริ่มต้นใช้งาน

```bash
npm install
cp .env.example .env
npx expo start
```

แก้ `.env` ให้เป็น Project URL และ Publishable/Anon Key จาก Supabase ก่อนเปิดแอป ห้ามใส่ Service Role Key ในแอปมือถือ

## สร้างไฟล์ APK สำหรับติดตั้งเอง

```bash
npx eas-cli login
npx eas-cli build --platform android --profile preview
```

เมื่อ build เสร็จ EAS จะแสดงลิงก์ดาวน์โหลดไฟล์ `.apk`

## 1) เปิดระบบสมาชิก

ใน Supabase ไปที่ **Authentication > Providers > Email** แล้วเปิด Email provider ตามค่าเริ่มต้น หากเปิด Confirm email ผู้สมัครต้องกดยืนยันในอีเมลก่อนเข้าสู่ระบบ

## 2) รัน SQL migration

เปิด **SQL Editor** แล้วรันทั้งหมดนี้กับฐานข้อมูลเดิม:

```sql
alter table public.transactions
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists transaction_date date default current_date;

update public.transactions
set transaction_date = created_at::date
where transaction_date is null;

alter table public.transactions enable row level security;

drop policy if exists "demo can read transactions" on public.transactions;
drop policy if exists "demo can add transactions" on public.transactions;
drop policy if exists "demo can delete transactions" on public.transactions;
drop policy if exists "users manage own transactions" on public.transactions;

create policy "users manage own transactions"
on public.transactions for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);

alter table public.categories enable row level security;
drop policy if exists "users manage own categories" on public.categories;
create policy "users manage own categories"
on public.categories for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  amount numeric(12,2) not null check (amount > 0),
  month text not null check (month ~ '^\\d{4}-\\d{2}$'),
  created_at timestamptz not null default now(),
  unique(user_id, category, month)
);

alter table public.budgets enable row level security;
drop policy if exists "users manage own budgets" on public.budgets;
create policy "users manage own budgets"
on public.budgets for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists transactions_user_date_idx
on public.transactions(user_id, transaction_date desc);
```

ข้อมูลเดโมเดิมที่ไม่มี `user_id` จะถูกซ่อนหลังเปิด Policy ใหม่ สามารถลบออกภายหลังได้จาก Table Editor

## 3) ตั้งค่า API

ค่าที่ส่วนบนของ `App.js` ต้องเป็น Project URL และ Publishable/Anon Key จาก **Project Settings > API** ห้ามนำ Service Role Key มาใส่ในแอป

## ฟีเจอร์

- สมัครสมาชิกและเข้าสู่ระบบด้วย Supabase Auth
- RLS แยกข้อมูลตามผู้ใช้
- เพิ่ม แก้ไข และลบรายการ พร้อมวันที่
- เลือกเดือน ดูยอดรวมและกราฟหมวดหมู่
- ตั้งงบประมาณรายหมวดต่อเดือน
- เพิ่มหรือลบหมวดหมู่ส่วนตัว
- ค้นหาและกรองประเภท/หมวดหมู่
- ส่งออก CSV (ดาวน์โหลดบนเว็บ หรือ Share Sheet บนมือถือ)
- โหมดทดลองสำหรับดูหน้าตาโดยไม่บันทึกลงฐานข้อมูล

หมายเหตุ: เซสชันล็อกอินของ Snack เวอร์ชันนี้อยู่ในหน่วยความจำ จึงต้องเข้าสู่ระบบใหม่เมื่อรีโหลดแอป

