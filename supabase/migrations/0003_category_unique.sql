-- กันหมวดชื่อซ้ำ (เช่น สร้างหมวดเริ่มต้นซ้อนจากหลายแท็บ)
create unique index categories_user_name_key on public.categories (user_id, lower(btrim(name)));
