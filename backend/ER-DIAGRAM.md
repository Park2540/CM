# ER Diagram — ฐานข้อมูลหลังบ้าน (MongoDB)

สร้างจากโค้ดใน `src/domain/` ที่ลงทะเบียนด้วย `persistArray` / `persistMap` / `persistObject` (`src/db/state.ts`) — ทั้งหมด 27 collection

- MongoDB ไม่บังคับ foreign key ความสัมพันธ์ด้านล่างเป็นการอ้างอิงด้วยรหัสในโค้ด
- collection แบบ `persistMap` เก็บเป็น `{ _id: key, value }` เช่น `progress_updates` มี 1 เอกสารต่อโครงการ เก็บบันทึกทั้งหมดเป็นอาร์เรย์ใน `value`
- `UserRef` (`requestedBy`, `decidedBy`, `author`, `user` ฯลฯ) เป็นสำเนา `{ id, name, roleLabel }` ณ เวลาที่เกิดเหตุการณ์ ไม่ได้ join กลับ
- ช่องที่เขียนว่า "คำนวณ" ไม่ได้เก็บใน DB หลังบ้านคำนวณตอนตอบ API

## 1. ภาพรวมความสัมพันธ์

```mermaid
erDiagram
    projects ||--o| project_setups : "ตั้งค่างานก่อสร้าง"
    projects ||--o| project_timelines : "ไทม์ไลน์"
    projects ||--o| progress_updates : "บันทึกหน้างาน"
    projects ||--o| project_staff : "ทีมงาน"
    projects ||--o| project_subcontractors : "ผู้รับเหมาที่จ้าง"
    projects ||--o| project_houses : "ข้อมูลแบบบ้าน"
    projects ||--o| project_models : "แบบ 3 มิติ"
    projects ||--o| installment_payments : "รับชำระงวดงาน"
    projects ||--o{ change_orders : "งานเพิ่ม-ลด"
    projects ||--o{ approvals : "คำขออนุมัติ"
    projects ||--o{ purchase_requests : "จัดซื้อวัสดุ"
    projects ||--o{ rentals : "เช่า/ยืมอุปกรณ์"
    projects ||--o| project_boq : "BOQ วัสดุ"
    projects ||--o{ stock_movements : "คืนคลัง/เบิกคลัง"
    projects |o--o{ estimates : "BOQ/ประมาณราคา"
    change_orders |o--|| approvals : "change-order"
    purchase_requests |o--|| approvals : "pr และ po"
    rentals |o--o| approvals : "rental"
    materials |o--o{ purchase_requests : "items.materialCode"
    materials |o--o{ project_boq : "items.materialCode"
    materials |o--o{ stock_movements : "materialCode"
    personnel ||--o{ project_staff : "personnelId"
    subcontractors ||--o{ project_subcontractors : "subcontractorId"
    personnel ||--o| user_accounts : "personnelId"
    user_accounts }o--o{ projects : "projectCodes"
    user_accounts ||--o| user_passwords : "รหัสผ่าน"
    registrations ||--|| registration_passwords : "รหัสผ่านที่ขอ"
    registrations |o--o| user_accounts : "accountId"
    user_accounts ||--o{ audit_logs : "user.id"
```

`approval_settings`, `company_profile` เป็นเอกสารเดียว (singleton) ไม่ผูกกับตารางอื่น · `uploads` ถูกอ้างอิงจากหลายตาราง (ดูหัวข้อ 6)

## 2. โครงการและแผนงาน

```mermaid
erDiagram
    projects {
        string _id PK "= code เช่น CR690001 (ภูมิภาค + ปี พ.ศ. + ลำดับ)"
        string name
        string customerName
        string phone
        string customerEmail
        string customerLineId
        string customerAddress
        string responsibleName
        string housePlanName "ตั้งจาก designBrief ถ้าไม่ระบุ เช่น บ้าน 2 ชั้น 3 ห้องนอน (รอออกแบบ)"
        string housePlanCode "แบบในคลัง (โครงการเดิม)"
        object designBrief "floors, bedrooms, bathrooms, parking, usableArea, landArea, budget, style, rooms[]"
        string requirements "รายละเอียดเพิ่มเติมของลูกค้า"
        object siteCoordinates "lat, lng, updatedBy, updatedAt (หมุดแผนที่/นำทาง Google Maps)"
        number value "null จนกว่าจะบันทึกสัญญา"
        date contractSignedAt
        date startDate
        date deliveryDate
        string location "ที่ตั้งหน้างาน (บันทึกตอนทำสัญญา)"
        int progress
        string status "pending-contract | planning | in-progress | delayed | completed (คำนวณ)"
        datetime createdAt
        date handedOverAt
        number changeOrderTotal
        number revisedValue "คำนวณ: value + changeOrderTotal"
        array warranties "คำนวณ: สถาปัตย์ 1 ปี โครงสร้าง 5 ปี นับจากส่งมอบ"
        int _index
    }

    project_setups {
        string _id PK,FK "= projects.code"
        datetime configuredAt "value.*"
        string configuredBy
        object options "buildingType, floors (บ้าน 1-3 / พาณิชย์ 1-8), foundation ฯลฯ"
        array excludedTasks "รหัสงานที่ตัดออก"
        array customTasks "CustomTaskInput[]"
        array paymentPercents "สัดส่วนงวดเงิน (%)"
    }

    project_timelines {
        string _id PK,FK "= projects.code"
        int progress "value.*"
        array phases "TimelinePhase[] ซ้อน tasks[] (code ชั้น 3+ ต่อท้าย -ชั้น เช่น 06.09-3)"
        date tasks_startedOn "คำนวณ: บันทึกหน้างานครั้งแรกของงาน"
        date tasks_lastUpdatedOn "คำนวณ: บันทึกหน้างาน/ผลตรวจล่าสุด"
    }

    progress_updates {
        string _id PK,FK "= projects.code"
        array value "ProgressUpdate[]: id, reportDate, author, weather, workers, taskChanges[taskCode], inspection, issues, photos, documents, overallProgress"
    }

    project_staff {
        string _id PK,FK "= projects.code"
        array value "StoredStaff[]: id, personnelId FK, role, note"
    }

    project_subcontractors {
        string _id PK,FK "= projects.code"
        array value "StoredSub[]: id, subcontractorId FK, scope, phaseCodes, contractValue, note"
    }

    project_houses {
        string _id PK,FK "= projects.code"
        object value "name, description, usableArea, width, depth, floors, bedrooms, bathrooms, kitchens, parking, floorPlans[label,image], renders{front,back,left,right}"
    }

    project_models {
        string _id PK,FK "= projects.code"
        array value "ProjectModel[]: id, version, title, sourceApp, format, file, sourceFile (.skp/.ifc), elements, conversion, upAxis, uploadedBy, uploadedAt, deletedAt"
    }

    projects ||--o| project_setups : "ตั้งค่า"
    projects ||--o| project_timelines : "ไทม์ไลน์"
    projects ||--o| progress_updates : "บันทึกหน้างาน"
    progress_updates }o--o{ project_timelines : "taskChanges.taskCode"
    projects ||--o| project_staff : "ทีมงาน"
    projects ||--o| project_subcontractors : "ผู้รับเหมา"
    projects ||--o| project_houses : "แบบบ้าน"
    projects ||--o| project_models : "แบบ 3 มิติ"
```

## 3. การเงิน งานเพิ่ม-ลด และการอนุมัติ

```mermaid
erDiagram
    installment_payments {
        string _id PK,FK "= projects.code"
        array value "PaymentRecord[]: id, key (no:n | co:changeOrderId), installmentNo, paidDate, amount, withholdingTax, method, reference, evidence, recordedBy, cancelledAt, cancelReason"
    }

    change_orders {
        string _id PK "เช่น CO-CR690002-01"
        string projectCode FK
        string approvalId FK
        string title
        string source "customer | site | design"
        string status "pending | approved | rejected | cancelled"
        array items "ChangeOrderItem[] (add/deduct)"
        number addTotal
        number deductTotal
        number total
        int scheduleImpactDays
        object newTask "phaseCode, name, durationDays"
        boolean customerConfirmed
        object requestedBy "UserRef"
        object decidedBy "UserRef"
        string appliedTaskCode
        date deliveryDateBefore
        date deliveryDateAfter
    }

    approvals {
        string _id PK "= เลขเอกสาร เช่น PR-6910-0037, PO-6910-0021"
        string type "pr | po | subcontract | change-order | petty-cash | rental"
        string projectCode FK
        string changeOrderId FK "type change-order"
        string purchaseId FK "type pr และ po"
        string rentalId FK "type rental"
        string title
        string reason
        number amount
        string status "pending | approved | rejected"
        string approvalLevel "project-manager | owner"
        array items "ApprovalItem[]"
        array history "ApprovalStep[]"
        object requestedBy "UserRef"
        datetime requestedAt
    }

    approval_settings {
        string _id PK "singleton"
        number projectManagerLimit "วงเงินผู้จัดการโครงการ (ใช้ทั้งใบขอซื้อและใบสั่งซื้อ)"
        boolean changeOrderRequiresOwner
    }

    change_orders |o--|| approvals : "approvalId / changeOrderId"
    change_orders |o--o{ installment_payments : "key co:changeOrderId"
```

## 4. จัดซื้อ เช่า วัสดุ และคลัง

```mermaid
erDiagram
    purchase_requests {
        string _id PK "= approvalId ของใบขอซื้อ เช่น PR-6910-0037"
        string projectCode FK
        string approvalId FK
        string title
        date neededDate
        string phaseCode
        string supplier "ร้านที่เสนอ"
        array items "ProcurementItem[]: materialCode FK, name, quantity, unit, unitPrice"
        number amount "ประมาณการ"
        string status "pending | approved | rejected | po-pending | ordered | partial | received | cancelled"
        object order "PurchaseOrder: poNumber (= approvalId), status, vendor, orderDate, expectedDate, unitPrices (รวม VAT), amount, amountBeforeVat, vatAmount, paymentTerms, quotationFiles, orderedBy"
        array rejectedOrders "ใบสั่งซื้อที่ไม่ผ่านอนุมัติ"
        array received "จำนวนที่รับแล้วต่อรายการ"
        array receipts "date, quantities, note, files, receivedBy"
        object requestedBy "UserRef"
        string cancelReason
    }

    rentals {
        string _id PK "RT-yymm-nnnn (เช่า) | BR-yymm-nnnn (ยืม)"
        string projectCode FK
        string approvalId FK "เฉพาะเช่า"
        string source "rent | borrow"
        string equipment
        number quantity
        string unit
        date startDate
        date endDate
        string vendor
        number rate
        string rateUnit "day | month"
        string status "pending | approved | rejected | in-use | returned | cancelled"
        date deliveredAt
        object deliveredBy "UserRef"
        date returnedAt
        object returnedBy "UserRef"
        string returnCondition "good | damaged | lost"
        array extensions "from, to, note, by, at"
        number cost "คำนวณ: ค่าเช่าจริง"
    }

    materials {
        string _id PK "= code เช่น MAT-0001"
        string name
        string unit
        string category
        string spec
        number lastPrice "จากใบสั่งซื้อที่อนุมัติล่าสุด (รวม VAT)"
        boolean active
    }

    project_boq {
        string _id PK,FK "= projects.code"
        array items "BoqItem[]: materialCode FK, name, unit, quantity, phaseCode, note"
        object updatedBy "UserRef"
        datetime updatedAt
    }

    stock_movements {
        string _id PK "SM-yymm-nnnn"
        string projectCode FK
        string type "return (ของเหลือเข้าคลังหลัก) | issue (เบิกจากคลังหลัก)"
        string materialCode FK
        string name
        string unit
        number quantity
        date date
        string note
        object recordedBy "UserRef"
    }

    company_profile {
        string _id PK "singleton (หัวกระดาษใบสั่งซื้อ)"
        string name
        string branch
        string address
        string taxId
        string phone
        string email
    }

    purchase_requests }o--o{ materials : "items.materialCode"
    project_boq }o--o{ materials : "items.materialCode"
    stock_movements }o--o| materials : "materialCode"
```

การใช้วัสดุจริงของโครงการ (`GET /projects/{code}/material-usage`) คำนวณจาก `purchase_requests.received` + `stock_movements` (issue − return) เทียบ `project_boq` · ยอดคงเหลือคลังหลัก (`GET /warehouse/stock`) คำนวณจาก `stock_movements` ทั้งหมด

## 4.1 ถอดปริมาณและ BOQ (ประมาณราคา)

```mermaid
erDiagram
    estimates {
        string _id PK "EST-yymm-nnnn"
        string title
        string projectCode FK "ไม่บังคับ (ประมาณราคาก่อนได้งานได้)"
        string location
        string ownerName
        string estimator
        date estimateDate
        number area "ตร.ม. ใช้คำนวณราคาเฉลี่ย"
        number overheadPercent "ค่าดำเนินการ (%)"
        number profitPercent "กำไร (%)"
        number vatPercent "ภาษีมูลค่าเพิ่ม (%)"
        json statement "เอกสารชี้แจงค่าดำเนินการ (หัวข้อ เนื้อหา ตารางแบ่งความรับผิดชอบ)"
        string status "draft | final"
        array notes "หมายเหตุท้ายสรุป"
        array categories "หมวดงาน → groups → items (kind, description, unit, quantity, materialPrice, laborPrice, waste, indent, takeoff[])"
        object totals "คำนวณ: วัสดุ ค่าแรง ต่อหมวด + ค่าดำเนินการ + ราคาต่อ ตร.ม."
        object source "ถอดจากโมเดล IFC: projectCode, modelId FK, fileName, warnings, materials[], components[], appliedAt"
        object createdBy "UserRef"
        datetime updatedAt
    }
    projects |o--o{ estimates : "projectCode"
    project_models |o--o{ estimates : "source.modelId (ถอดจาก IFC)"
    estimates |o--o| project_boq : "apply-materials → BOQ วัสดุ"
```

ถอดจากโมเดล IFC (`POST /estimates/from-model`): อ่านไฟล์ต้นฉบับ .ifc ของแบบ 3 มิติใน worker thread (`src/convert/ifc-takeoff.ts`) แล้วจัดเป็นรายการ BOQ + รายการวัสดุ (`src/domain/estimate-from-ifc.ts`) — ชนิดงานตัดสินจากประเภท IFC + ชื่อชนิด + วัสดุ ปริมาณจาก BaseQuantities หรือรูปทรง

ปริมาณของรายการที่มีบรรทัดถอด (`takeoff`: volume, area, length, count, rebar, steel พร้อมบรรทัดหัก) = ผลรวม × (1 + เผื่อเสีย%) หลังบ้านคำนวณใหม่ทุกครั้งที่บันทึก · คลังราคาต่อหน่วย (`GET /estimate-rates`) รวบรวมจากรายการใน BOQ ทุกฉบับ

## 5. บุคลากร ผู้ใช้ และการสมัคร

```mermaid
erDiagram
    personnel {
        string _id PK
        string employeeCode "เช่น EMP690001"
        string fullName
        string position
        string department
        string phone
        string email
        string photoUrl
        array documents "PersonnelDocument[]"
        array trainings
        object sensitive "ข้อมูลอ่อนไหว"
        array projectHistory
        array auditHistory
        int _index
    }

    subcontractors {
        string _id PK
        string code "เช่น SUB-001"
        string name
        array trades
        string contactName
        string phone
        string taxId "ไม่ซ้ำ"
        string status "active | inactive"
        int _index
    }

    user_accounts {
        string _id PK
        string personnelId FK "1 คน 1 บัญชี"
        string email "ไม่ซ้ำ"
        string roleId "สิทธิ์ตั้งต้นมาจากบทบาท"
        array projectCodes "FK projects.code[]"
        array grantedPermissions
        array revokedPermissions
        string status "invited | active | suspended"
        boolean passwordSet
        datetime createdAt
        datetime lastLoginAt
        int _index
    }

    user_passwords {
        string _id PK,FK "= user_accounts.id"
        string value "scrypt hash"
    }

    registrations {
        string _id PK
        string fullName
        string email
        string phone
        string employeeCode
        string position
        string status "pending | approved | rejected"
        datetime submittedAt
        object decidedBy "UserRef"
        string rejectReason
        string accountId FK "บัญชีที่สร้างเมื่ออนุมัติ"
    }

    registration_passwords {
        string _id PK,FK "= registrations.id"
        string value "scrypt hash"
    }

    personnel ||--o| user_accounts : "personnelId"
    user_accounts ||--o| user_passwords : "รหัสผ่าน"
    registrations ||--|| registration_passwords : "รหัสผ่านที่ขอ"
    registrations |o--o| user_accounts : "accountId"
```

สิทธิ์ (permission) มาจากบทบาทใน `src/domain/roles.ts` (ไม่เก็บใน DB) ปรับรายคนได้ด้วย `grantedPermissions` / `revokedPermissions` เช่น `procurement.manage` (ฝ่ายจัดซื้อ) และ `procurement.receive` (เจ้าของ ผู้จัดการโครงการ วิศวกร โฟร์แมน ตรวจรับของ)

## 6. ไฟล์และบันทึกการใช้งาน

```mermaid
erDiagram
    uploads {
        string _id PK "= file id (UUID) ตัวไฟล์อยู่ที่ DATA_DIR/uploads"
        string url
        string name
        int sizeKb
        string contentType
    }

    audit_logs {
        string _id PK "log-N"
        datetime at
        object user "UserRef"
        string module "approval | project | personnel | procurement | finance | system"
        string action
        string target
        string detail
    }

    uploads |o--o{ progress_updates : "photos / documents"
    uploads |o--o{ installment_payments : "evidence"
    uploads |o--o{ purchase_requests : "receipts.files / order.quotationFiles"
    uploads |o--o{ project_houses : "ภาพแปลน / ทัศนียภาพ"
    uploads |o--o{ project_models : "file / sourceFile"
    uploads |o--o{ personnel : "photoUrl / documents"
```

## สรุป collection

| กลุ่ม | collection | รูปแบบ | คีย์ (`_id`) |
|---|---|---|---|
| โครงการ | `projects` | array | รหัสโครงการ |
| | `project_setups`, `project_timelines`, `progress_updates`, `project_staff`, `project_subcontractors` | map | รหัสโครงการ |
| | `project_houses`, `project_models` | map | รหัสโครงการ |
| การเงิน | `installment_payments` | map | รหัสโครงการ (รวมรายการที่ยกเลิก) |
| | `change_orders` | array | รหัสงานเพิ่ม-ลด |
| การอนุมัติ | `approvals` | array | เลขเอกสาร |
| | `approval_settings` | object | `singleton` |
| จัดซื้อ/เช่า | `purchase_requests` | array | เลขใบขอซื้อ (= เลขคำขออนุมัติ) |
| | `rentals` | array | เลขเช่า/ยืม |
| วัสดุและคลัง | `materials` | array | รหัสวัสดุ |
| | `project_boq` | map | รหัสโครงการ |
| | `stock_movements` | array | เลขรายการคลัง |
| | `company_profile` | object | `singleton` |
| ประมาณราคา | `estimates` | array | เลข BOQ |
| บุคลากร | `personnel`, `subcontractors` | array | id |
| ผู้ใช้ | `user_accounts` | array | id |
| | `user_passwords` | map | id บัญชี |
| สมัครสมาชิก | `registrations` | array (ล่าสุดก่อน) | id |
| | `registration_passwords` | map | id คำขอสมัคร |
| อื่น ๆ | `uploads` | map | id ไฟล์ |
| | `audit_logs` | array (ล่าสุดก่อน) | `log-N` |
