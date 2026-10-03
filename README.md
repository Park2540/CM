# CM Planning

ระบบบริหารงานก่อสร้าง PP Prime Construction (หน้าบ้าน) — Angular 21, PrimeNG 21, Tailwind CSS v4 สร้างจาก template [Sakai-NG](https://github.com/primefaces/sakai-ng)

## เริ่มใช้งาน

```bash
npm install
npm start          # http://localhost:4200
npm run build      # ผลลัพธ์อยู่ใน dist/
```

ตอนนี้ยังไม่มีหลังบ้าน ข้อมูลทั้งหมดมาจาก API จำลอง (MSW) ที่ทำงานในเบราว์เซอร์ รีเฟรชแล้วข้อมูลกลับเป็นค่าเริ่มต้น
สลับไปใช้หลังบ้านจริงได้ที่ `src/environments/environment.ts` (`useMock: false` และ `apiBaseUrl`)

## สัญญา API

`api/openapi.yaml` คือข้อตกลงระหว่างหน้าบ้านและหลังบ้าน ขั้นตอนเพิ่ม/แก้ endpoint และกฎที่หลังบ้านต้องทำ อยู่ใน [api/README.md](api/README.md)

```bash
npm run api:types  # สร้าง src/app/api/schema.ts ใหม่จาก openapi.yaml
```

## โครงสร้างหลัก

- `src/app/pages/` — หน้าจอ (Dashboard, โครงการ, ตั้งค่างานก่อสร้าง, ศูนย์อนุมัติ, บุคลากร, ผู้รับเหมาช่วง, Audit Log)
- `src/app/pages/service/` — service ที่เรียก API
- `src/mocks/` — API จำลอง: endpoint (`handlers/`), ข้อมูลและกฎทางธุรกิจ (`data/`), แม่แบบแผนงานก่อสร้าง (`generators/`)
