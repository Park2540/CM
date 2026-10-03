# CM Planning — หลังบ้าน

API ของระบบบริหารงานก่อสร้าง ใช้ Node.js + TypeScript, Express 5 และ MongoDB ทำครบทุก endpoint ในสัญญา [`../api/openapi.yaml`](../api/openapi.yaml)

## เริ่มใช้งาน

```bash
cd backend
npm install
npm run dev        # http://localhost:3000/api (รีโหลดอัตโนมัติเมื่อแก้โค้ด)
```

หรือจากโฟลเดอร์หลัก `npm run backend` แล้วเปิดหน้าบ้านอีกหน้าต่างด้วย `npm start` หน้าบ้านส่งต่อ `/api` มาที่พอร์ต 3000 ให้เอง (`../proxy.conf.json`)

**ฐานข้อมูล:**
- **ไม่ได้ตั้ง `MONGODB_URI`:** ระบบดาวน์โหลด MongoDB มาเปิดให้เอง ครั้งแรกประมาณ 100 MB ข้อมูลเก็บถาวรที่ `backend/.data/db` และไฟล์ที่อัปโหลดเก็บที่ `backend/.data/uploads` ปิดเปิดเซิร์ฟเวอร์ใหม่แล้วข้อมูลยังอยู่
- **ครั้งแรกที่ฐานข้อมูลว่าง:** ระบบใส่ข้อมูลตั้งต้นให้ ได้แก่ โครงการ บุคลากร ผู้รับเหมา คำขออนุมัติ บัญชีผู้ใช้ และ Audit Log
- **อยากเริ่มใหม่ทั้งหมด:** ปิดเซิร์ฟเวอร์แล้วลบโฟลเดอร์ `backend/.data`
- **ใช้ MongoDB ที่ติดตั้งเองหรือ MongoDB Atlas:** คัดลอก `.env.example` เป็น `.env` แล้วตั้ง `MONGODB_URI`

**บัญชีทดลอง:** ทุกบัญชีใช้รหัสผ่าน `demo1234` เช่น
- `owner@example.invalid` (เจ้าของบริษัท)
- `thanakrit@example.invalid` (ผู้จัดการโครงการ)
- `kittisak@example.invalid` (โฟร์แมน)

```bash
npm run build && npm start   # build เป็น dist/ แล้วรัน (production ต้องตั้ง MONGODB_URI และ AUTH_SECRET)
npm run typecheck
npm run api:types            # สร้าง src/api/schema.ts ใหม่จาก openapi.yaml (ห้ามแก้ไฟล์นั้นด้วยมือ)
```

## โครงสร้าง

- `src/server.ts`: เชื่อมต่อฐานข้อมูล โหลดข้อมูล แล้วเปิดเซิร์ฟเวอร์
- `src/app.ts`: ลำดับ middleware ดังนี้
  1. แยกผู้ใช้ตามคำขอ
  2. endpoint ที่ไม่ต้องล็อกอิน (`/auth/login`, `/auth/register`, `/auth/logout`, `/files/*`)
  3. ตรวจ token
  4. endpoint อื่นทั้งหมด
- `src/routes/`: รับคำขอ HTTP ตรวจสิทธิ์ ตรวจข้อมูล แล้วเรียกตรรกะทางธุรกิจ
- `src/domain/`: ตรรกะทางธุรกิจและข้อมูลตั้งต้น ได้แก่ โครงการ ไทม์ไลน์ งวดงาน ทีมงาน ผู้ใช้ และการอนุมัติ
  - ผู้ใช้ของคำขอปัจจุบันอ่านจาก `CURRENT_USER` ซึ่งแยกตามคำขอด้วย AsyncLocalStorage คำขอที่ทำงานพร้อมกันจึงไม่ปนกัน
- `src/db/state.ts`: เก็บข้อมูลของ `domain/` ลง MongoDB
  - 1 รายการต่อ 1 เอกสาร (`_id` = รหัสรายการ)
  - โหลดเข้าหน่วยความจำตอนเริ่มเซิร์ฟเวอร์
  - เขียนเฉพาะเอกสารที่เปลี่ยน หลังทุกคำขอที่แก้ข้อมูลสำเร็จ และเขียนทุก 30 วินาทีสำหรับข้อมูลที่สร้างตอนอ่าน
- `src/domain/session.ts`: เข้าสู่ระบบ
  - token ลงลายเซ็น HMAC มีวันหมดอายุ
  - ผิดติดกัน 5 ครั้งล็อก 15 นาที
  - บัญชีที่ถูกระงับใช้ token เดิมต่อไม่ได้
- `src/domain/passwords.ts`: เก็บรหัสผ่านแบบ hash ด้วย scrypt
- `src/routes/files.ts`: อัปโหลดไฟล์ (รูป/PDF/Excel/Word/DWG ไม่เกิน 10 MB และแบบ 3 มิติ GLB/glTF/DAE/FBX/OBJ/SKP/RVT ไม่เกิน 200 MB) และดาวน์โหลดผ่าน `/api/files/:id`

**Collection ใน MongoDB:**

| ข้อมูล | collection |
|---|---|
| ผู้ใช้ | `user_accounts`, `user_passwords` |
| สมัครสมาชิก | `registrations`, `registration_passwords` |
| บุคลากรและผู้รับเหมา | `personnel`, `subcontractors` |
| โครงการ | `projects`, `project_setups`, `project_timelines`, `progress_updates`, `project_staff`, `project_subcontractors`, `change_orders` |
| การรับชำระเงิน | `installment_payments` |
| แบบบ้าน | `project_models` (แบบ 3 มิติ), `project_houses` (รายละเอียด ภาพแปลน ทัศนียภาพ) |
| การอนุมัติ | `approvals`, `approval_settings` |
| อื่น ๆ | `audit_logs`, `uploads` |

## ข้อจำกัดที่ควรรู้

- **โหลดข้อมูลทั้งหมดเข้าหน่วยความจำ:** เหมาะกับข้อมูลระดับบริษัทเดียว (หลักพันถึงหมื่นรายการ) และรันได้ 1 instance ถ้าข้อมูลโตมากหรือต้องรันหลาย instance ควรเปลี่ยนแต่ละโมดูลให้อ่านและเขียน MongoDB ตรงทีละคำขอ
- **ข้อมูลการเงินบางส่วนยังเป็นข้อมูลตัวอย่าง:** เงินรับใน Dashboard มาจากการบันทึกรับชำระจริง แต่ต้นทุนและกำไรยังคำนวณจากสมมติฐาน และภาพหน้างานตัวอย่างสร้างจากความคืบหน้า ยังไม่ได้เชื่อมระบบบัญชีจริง
- **การรับชำระของข้อมูลเดิม:** โครงการที่มีอยู่ก่อนมีการบันทึกรับชำระ ระบบสร้างรายการรับชำระตัวอย่าง (บันทึกโดย "ระบบ" ไม่มีหลักฐาน) ให้ครั้งเดียวตามสถานะเดิม
- **ไฟล์ที่อัปโหลดเปิดได้โดยไม่ต้องแนบ token:** เพราะต้องใช้ใน `<img>` แต่รหัสไฟล์เป็น UUID สุ่มที่เดาไม่ได้ ถ้าต้องการปลอดภัยขึ้นควรเปลี่ยนเป็น signed URL ที่หมดอายุได้
- **แปลง .skp เป็น 3 มิติต้องรันบน Windows ที่ติดตั้ง SketchUp:** `src/convert/` เรียก `SketchUpAPI.dll` ผ่าน koffi ใน worker thread แล้วเขียน .glb (พร้อม .glb.gz สำหรับส่งแบบ gzip) เปิดได้เฉพาะไฟล์ที่บันทึกจาก SketchUp รุ่นเดียวกันหรือเก่ากว่า ยังไม่ใส่ภาพ texture (ใช้สีเฉลี่ยของวัสดุ) — ถ้าเซิร์ฟเวอร์ไม่มี SketchUp สถานะจะเป็น `unavailable` และผู้ใช้ต้องส่งออก .glb เอง ใช้งานจริงควรดาวน์โหลด SketchUp C API SDK จาก Trimble แล้วตั้ง `SKETCHUP_API_DIR` ไปที่ SDK แทนการใช้ DLL ของโปรแกรม SketchUp ที่ติดตั้ง
- **ยังไม่ส่งอีเมลจริง:** ทั้งคำเชิญและลิงก์ตั้งรหัสผ่าน ตอนนี้แค่บันทึกใน Audit Log

## เพิ่มหรือแก้ endpoint

1. แก้ `../api/openapi.yaml` แล้วสั่ง `npm run api:types` ทั้งที่โฟลเดอร์หลักและใน `backend/`
2. เพิ่มตรรกะใน `src/domain/` ถ้ามีข้อมูลที่ต้องเก็บ ให้ลงทะเบียนด้วย `persistArray` / `persistMap` / `persistObject` ท้ายไฟล์
3. เพิ่ม route ใน `src/routes/` แล้ว export ใน `src/routes/index.ts` และลงทะเบียนใน `src/app.ts`
