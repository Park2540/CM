# CM Planning

ระบบบริหารงานก่อสร้าง PP Prime Construction (หน้าบ้าน) — Angular 21, PrimeNG 21, Tailwind CSS v4 สร้างจาก template [Sakai-NG](https://github.com/primefaces/sakai-ng)

## เริ่มใช้งาน

ต้องใช้ Node.js 20.19 ขึ้นไป (หรือ 22.12 ขึ้นไป) ตามที่ Angular 21 กำหนด

ต้องเปิด 2 ส่วน (คนละหน้าต่าง terminal):

```bash
npm install && npm --prefix backend install   # ครั้งแรก
npm run backend    # หลังบ้าน + ฐานข้อมูล http://localhost:3000/api
npm start          # หน้าบ้าน http://localhost:4200 (ส่งต่อ /api ไปหลังบ้านให้เอง)
npm run build      # ผลลัพธ์อยู่ใน dist/
npm run format     # จัดรูปแบบโค้ดด้วย Prettier
```

เข้าสู่ระบบด้วยบัญชีทดลอง เช่น `owner@example.invalid` รหัสผ่าน `demo1234` (มีรายชื่อบัญชีทดลองให้เลือกที่หน้าเข้าสู่ระบบ) วิธีตั้งค่าฐานข้อมูลและรายละเอียดหลังบ้านดูที่ [backend/README.md](backend/README.md)

## สัญญา API

`api/openapi.yaml` คือข้อตกลงระหว่างหน้าบ้านและหลังบ้าน ขั้นตอนเพิ่ม/แก้ endpoint, รายการ endpoint ที่ใช้อยู่ และกฎที่หลังบ้านต้องทำ อยู่ใน [api/README.md](api/README.md)

```bash
npm run api:types  # สร้าง src/app/api/schema.ts ใหม่จาก openapi.yaml (ห้ามแก้ไฟล์นั้นด้วยมือ)
```

## หน้าจอที่ใช้งานได้

| เมนู | Path |
|---|---|
| Dashboard | `/dashboard` |
| ศูนย์อนุมัติ | `/approvals` |
| โครงการรวม | `/projects` |
| เปิดโครงการ | `/projects/new` |
| จัดการโครงการ (ไทม์ไลน์ อัปเดตงาน งวดงาน ภาพถ่าย เอกสาร ทีมงาน แบบบ้าน) | `/projects/:code` |
| ตั้งค่างานก่อสร้างของโครงการ | `/projects/:code/setup` |
| บุคลากร (รายการ / รายละเอียด พร้อมบัญชีผู้ใช้ / เพิ่ม) | `/master/personnel`, `/master/personnel/:id`, `/master/personnel/new` |
| ผู้รับเหมาช่วง | `/master/subcontractors` |
| ผู้ใช้งาน (บัญชีของบุคลากร บทบาท สิทธิ์รายคน) | `/system/users` |
| บทบาทและสิทธิ์ | `/system/roles` |
| Audit Log | `/system/audit-log` |
| เข้าสู่ระบบ / สมัครสมาชิก (รอแอดมินหรือเจ้าของบริษัทอนุมัติ) | `/auth/login`, `/auth/register` |

เมนูอื่นใน sidebar (การเงิน จัดซื้อ วัสดุ ทรัพย์สิน รับประกัน เอกสาร ลูกค้า ซัพพลายเออร์ ฯลฯ) วางโครงไว้แล้วแต่ยังไม่มีหน้าจอ

## โครงสร้างหลัก

- `src/app.routes.ts` — เส้นทางของหน้าจอทั้งหมด
- `src/app/layout/` — โครงหน้า (topbar, sidebar, เมนูใน `app.menu.ts`)
- `src/app/pages/` — หน้าจอแยกตามโมดูล คอมโพเนนต์ย่อยของหน้าโครงการอยู่ใน `projects/components/`
- `src/app/pages/service/` — service ที่เรียก API ด้วย `HttpClient` + `apiUrl()`
- `src/app/api/` — type ที่สร้างจากสัญญา API (`schema.ts`) และตัวช่วยเรียก API (`api.ts`)
- `proxy.conf.json` — ตอน `npm start` ส่งต่อ `/api` ไปที่หลังบ้าน http://localhost:3000
- `backend/` — หลังบ้าน (Express + MongoDB) ทำครบทุก endpoint ดู [backend/README.md](backend/README.md)
