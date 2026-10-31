# รวยยัง?

แอปบันทึกรายรับรายจ่ายส่วนตัว (PWA) สำหรับ iPhone เป็นหลัก · เวอร์ชัน 0.3.0

- **หน้าหลัก:** เงินพร้อมใช้จากยอดปิดล่าสุด เปลี่ยนรอบทันทีเมื่อปิดยอด โดยเก็บวันที่ใช้เงินจริงตามเดิม
- **แผนรายเดือน:** รายรับ, จ่ายประจำ (ประมาณ / รอจ่าย / จ่ายแล้ว), เพิ่มหลักฐานทีละรูปพร้อมอ่านยอด OCR และกันจ่ายเมื่อยอดไม่ตรง · รูปและยอดบันทึกพร้อมกันเมื่อกดบันทึกบิล
- **รายจ่ายรายวัน:** สแกนสลิปให้อ่านยอดอัตโนมัติ (OCR ทำงานในเครื่อง) หรือกรอกเอง · เปิดรายการแล้วเห็นสลิปทันที
- **ตั้งค่า → รายการประจำ → ยอดรายการนี้แต่ละเดือน:** ดูยอดจริงและแก้แยกเดือน · หลายหลักฐานเลือกได้ว่าแบ่งจ่ายรวมยอด หรือแต่ละใบเป็นหลักฐานยอดเดียวกัน
- **ปฏิทิน:** สลับดูใช้จ่ายรายวันกับจ่ายประจำเดือน โดยไม่รวมยอดซ้ำ
- **ปิดยอด + เงินเก็บ:** จ่ายประจำให้ครบ → ใส่คงเหลือจริงรวมเงินเก่า → แยกเก็บ → เริ่มเงินรอบใหม่ทันที · รายการวันปิดยอดเลือกรอบก่อน/หลังได้
- **Export Excel:** ไว้สำรองข้อมูล

Stack: Vite + React + TypeScript · Supabase (Auth, Postgres + RLS, Storage) · tesseract.js · GitHub Pages

## พัฒนา

```bash
npm install
npm run dev        # ไม่มี .env = โหมดตัวอย่าง เก็บข้อมูลใน localStorage (login ใส่อะไรก็ได้)
npm test           # unit + SQL/RLS บน PGlite
npm run build      # ต้องตั้ง VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
```

ข้อมูลส่วนตัวอยู่ใน `private/` และไฟล์ `.xlsx` ซึ่ง gitignore ไว้ทั้งหมด ห้าม commit เด็ดขาด
- `private/seed.json` สร้างจากชีตด้วยสคริปต์ที่เก็บไว้ในเครื่องเท่านั้น (ไม่อยู่ใน repo)
- ตอนรัน dev แอปจะโหลด `private/seed.json` อัตโนมัติ ผ่าน middleware ของ dev server เท่านั้น ไม่ถูกรวมเข้า build

## ขึ้นใช้งานจริง (ครั้งแรก)

> ต้องใช้บัญชี **ainz.th45** ทั้ง Supabase และ GitHub (`ainzth45-commits`)

1. **Supabase:** สร้าง project ใหม่ เช่นชื่อ `ruayyang` region Singapore
2. **Migration:** รัน `supabase/migrations/0001_init.sql` → `0002_storage.sql` → `0003_category_unique.sql` → `0004_budget_savings.sql` → `20261031060000_cycle_receipts.sql` → `20261031110000_multi_receipts.sql` ตามลำดับ ก่อน deploy frontend ใหม่ · สำรองข้อมูลก่อนรัน ไม่รันไฟล์เดิมซ้ำ
3. **Auth → Sign In / Providers:** ปิด *Allow new users to sign up* แล้วไปที่ **Auth → Users → Add user** สร้างบัญชีเจ้านาย (ติ๊ก Auto Confirm)
4. **นำเข้าข้อมูลจากชีต:** เอา user id จากข้อ 3 แล้วรัน
   `node scripts/seedToSql.ts private/seed.json <user-id> > private/import.sql`
   จากนั้นรันไฟล์ `private/import.sql` ใน SQL editor (สคริปต์กันนำเข้าซ้ำไว้แล้ว)
5. **GitHub:** สร้าง repo public `ruayyang` ในบัญชี `ainzth45-commits` แล้วตั้งค่า:
   - Settings → Secrets and variables → Actions → **Variables** ใส่ `VITE_SUPABASE_URL` และ `VITE_SUPABASE_ANON_KEY` (ใช้ publishable/anon key ซึ่งเปิดเผยได้)
   - Settings → Pages → Source = **GitHub Actions**
6. **Deploy:** push ขึ้น `main` แล้ว workflow จะเทส → build → deploy ให้เอง
7. **ติดตั้งบน iPhone:** เปิด `https://ainzth45-commits.github.io/ruayyang/` ใน Safari → ปุ่มแชร์ → **เพิ่มไปยังหน้าจอโฮม** → เปิดจากไอคอนแล้วล็อกอินครั้งเดียว

### ข้อควรรู้
- **Supabase แบบฟรี:** ถ้าไม่มีใครใช้งานติดต่อกัน 7 วัน project จะถูกพักไว้ ต้องเข้าไปกด Restore ใน dashboard
- **การล็อกอิน:** ระบบต่ออายุ session ให้อัตโนมัติ ไม่ต้องล็อกอินใหม่ ยกเว้นกดออกจากระบบ หรือลบแอปออกจากหน้าโฮม
- **OCR:** ครั้งแรกจะโหลดไฟล์ภาษาไทยและอังกฤษ (ประมาณ 6MB) จาก jsDelivr หลังจากนั้นเก็บ cache ไว้ในเครื่อง
