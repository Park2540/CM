# สัญญา API (Contract-first)

`openapi.yaml` คือข้อตกลงกลางระหว่างหน้าบ้านและหลังบ้าน แก้ไฟล์นี้ก่อนเสมอ แล้วจึงแก้โค้ด

เปิดอ่านเป็นเอกสาร: วางไฟล์ใน https://editor.swagger.io หรือใช้ส่วนขยาย OpenAPI ใน VS Code

## ขั้นตอนเมื่อเพิ่มหรือแก้ endpoint

1. แก้ `api/openapi.yaml`
2. `npm run api:types` เพื่อสร้าง `src/app/api/schema.ts` ใหม่ (ห้ามแก้ไฟล์นั้นด้วยมือ)
3. `ng build` แล้วแก้จุดที่ type ไม่ตรง
4. เพิ่มหรือแก้ mock ใน `src/mocks/handlers/` ข้อมูลตัวอย่างอยู่ใน `src/mocks/data/`
5. ฝั่งหน้าบ้านเรียกผ่าน service ใน `src/app/pages/service/` ด้วย `HttpClient` + `apiUrl()`

## สลับ mock / หลังบ้านจริง

แก้ `src/environments/environment.ts`:

- `useMock: true`: ใช้ API จำลอง (MSW) ในเบราว์เซอร์ ข้อมูลอยู่ในหน่วยความจำ รีเฟรชแล้วกลับเป็นค่าเริ่มต้น
- `useMock: false` + `apiBaseUrl`: เรียกหลังบ้านจริง

## สถานะการย้ายไปใช้ API

ข้อมูลทุกส่วนของระบบดึงผ่าน API แล้ว (ไม่รวมหน้าตัวอย่างของ Sakai ใน `uikit/`, `crud/`, `landing/`)

| ส่วน | Endpoint |
|---|---|
| ผู้ใช้ที่ล็อกอิน สิทธิ์ และตารางบทบาท | `/auth/me`, `/auth/logout`, `/roles`, `/users` |
| ศูนย์อนุมัติ | `/approvals`, `/approvals/summary`, `/settings/approval` |
| Audit Log | `/audit-logs`, `/audit-logs/export` |
| Dashboard | `/dashboard/summary`, `/dashboard/cash-flow`, `/dashboard/projects` (จำนวนโครงการตามกลุ่มและโครงการในระยะประกัน) |
| โครงการ: เปิดโครงการ (ข้อมูลเบื้องต้น) และบันทึกสัญญา | `/projects` (GET, POST), `/projects/{code}`, `/projects/{code}/contract`, `/settings/project-regions` |
| ตั้งค่างานก่อสร้าง (ตัวเลือกของบ้านแต่ละหลัง → งานในไทม์ไลน์) | `/settings/construction-options`, `/projects/{code}/setup` (GET, PUT), `/projects/{code}/setup/preview` |
| ไทม์ไลน์ อัปเดตงาน ผลตรวจ | `/projects/{code}/timeline`, `/updates`, `/tasks/{taskCode}/inspection` |
| งวดงาน ภาพถ่าย เอกสาร ทีมงาน | `/projects/{code}/installments`, `/photos`, `/documents`, `/team` |
| แบบบ้าน | `/house-plans`, `/house-plans/{code}` |
| ทีมงานโครงการ: ผู้รับผิดชอบและผู้รับเหมาช่วงตามขั้นตอน | `/projects/{code}/assignments`, `/projects/{code}/staff`, `/projects/{code}/subcontractors` (POST, PUT, DELETE) |
| ทะเบียนผู้รับเหมาช่วง | `/subcontractors` (GET, POST), `/subcontractors/{id}` (PUT) |
| บุคลากร | `/personnel`, `/personnel/{id}`, `/personnel/license-alerts` |
| อัปโหลดไฟล์ (รูป/PDF) | `/uploads` |

## โครงสร้างโค้ด

- `src/app/pages/service/` — service ฝั่งหน้าบ้าน: เรียก API และแปลงข้อมูลให้หน้าจอ (ไม่มีข้อมูลตัวอย่าง)
- `src/mocks/handlers/` — endpoint จำลอง (เทียบเท่า controller ของหลังบ้าน)
- `src/mocks/data/` — ข้อมูลและกฎทางธุรกิจของหลังบ้านจำลอง
- `src/mocks/generators/` — ตัวสร้างข้อมูลตัวอย่าง (แม่แบบแผนงาน ไทม์ไลน์ งวด ภาพ เอกสาร)

ทีมหลังบ้านใช้ `src/mocks/data/` เป็นตัวอย่างพฤติกรรมที่หน้าบ้านคาดหวังได้ เช่น สูตรคำนวณ % และการตรวจข้อมูล

## ข้อตกลงสำคัญสำหรับหลังบ้าน

- error ตอบเป็น `application/problem+json` และ `title` เป็นข้อความภาษาไทยที่แสดงผู้ใช้ได้ทันที
- หลังบ้านเป็นผู้คำนวณระดับผู้อนุมัติ (`approvalLevel`) กำไร-ขาดทุน ไทม์ไลน์ และสถานะงวด
- หลังบ้านบันทึก Audit Log ทุกครั้งที่ข้อมูลเปลี่ยน หน้าบ้านไม่มี API เขียน Audit Log
- ตัดสินคำขอที่ไม่ใช่ `pending` ต้องตอบ `409` ส่วนไม่อนุมัติโดยไม่มีเหตุผลต้องตอบ `422`
- `/auth/me` ส่ง `permissions` ของผู้ใช้มาให้หน้าบ้านใช้ซ่อน/แสดงปุ่ม แต่หลังบ้านต้องตรวจสิทธิ์ซ้ำทุกคำขอ
- ข้อมูลอ่อนไหวของบุคลากร (`sensitive`, `paidAmount`) ส่งเฉพาะผู้มีสิทธิ์ `personnel.sensitive` และละเว้นค่าที่ผู้ไม่มีสิทธิ์ส่งมา
- รหัสบุคลากรและประวัติการแก้ไข หลังบ้านเป็นผู้สร้าง
- โครงการมี 3 ขั้นก่อนเริ่มก่อสร้าง: เปิดโครงการ (สถานะ `pending-contract` ยังไม่มีมูลค่า/วันที่) → บันทึกสัญญา → ตั้งค่างานก่อสร้าง (สร้างไทม์ไลน์และงวดงาน) ข้อมูลรายโครงการตอบ `409` จนกว่าจะครบทั้งสองขั้น ส่วน Dashboard การเงินนับมูลค่าตั้งแต่บันทึกสัญญา
- กลุ่มโครงการ (`ProjectGroup`, ใช้กับ `GET /projects?group=`): ในมือ = รอทำสัญญา + กำลังดำเนินการ, เสร็จแล้ว = ส่งมอบแล้ว (`handedOverAt`), อยู่ในประกัน = ส่งมอบแล้วและ `warrantyUntil` ยังไม่ถึง หลังบ้านเป็นผู้คำนวณวันหมดประกัน
- งานย่อยรายโครงการ (ขั้นที่ 2 ของหน้าตั้งค่า): `excludedTasks` = รหัสงานจากแม่แบบที่ไม่ทำ (ตัดจุดตรวจ/หมุดหมายไม่ได้ ตอบ 422), `customTasks` = งานที่เพิ่มเอง หลังบ้านออกรหัส `<ขั้นตอน>.X<ลำดับ>` และวางต่อจาก `afterCode` ส่วน preview ต้องส่งงานที่ตัดออกมาด้วย (`included: false`) ให้ผู้ใช้เลือกกลับได้
- ทีมงานโครงการ: ผู้จัดการโครงการคนแรกคือ `responsibleName` ของโครงการ (ต้องมีอย่างน้อย 1 คน), `/team` สร้างจากผู้รับผิดชอบที่มอบหมาย; ผู้รับเหมาช่วงมอบหมายตามขั้นตอนในไทม์ไลน์ หลังบ้านคำนวณความคืบหน้า/สถานะจากขั้นตอนนั้น ยกเลิกไม่ได้เมื่อเริ่มงานแล้ว (409) และส่ง `contractValue` เฉพาะผู้มีสิทธิ์ `project.manage`
- ตั้งค่างานก่อสร้าง: หลังบ้านเป็นผู้กำหนดตัวเลือก (`/settings/construction-options`) และงานที่แต่ละตัวเลือกเพิ่ม/เปลี่ยน (ตัวอย่างอยู่ที่ `when` ใน `src/mocks/generators/construction-plan.template.ts`) หน้าบ้านสร้างฟอร์มจากรายการนั้นเอง แก้การตั้งค่าไม่ได้ (`409`) เมื่อเริ่มรายงานความคืบหน้าแล้ว
