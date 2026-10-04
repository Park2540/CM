import { Router } from 'express';
import type { ApiSchemas } from '../api/api.js';
import {
    Result,
    cancelPurchase,
    cancelRental,
    createPurchase,
    createStockMovement,
    createRental,
    extendRental,
    findPurchaseRecord,
    findRentalRecord,
    isRequester,
    listPurchases,
    listRentals,
    materialUsage,
    orderPurchase,
    receivePurchase,
    returnRental,
    startRental
} from '../domain/procurement.js';
import { createMaterial, getBoq, listMaterials, listProjectMovements, listWarehouseMovements, saveBoq, saveCompanyProfile, companyProfile, updateMaterial, warehouseStock } from '../domain/materials.js';
import { findContracted, findProject, getTimeline } from '../domain/projects.js';
import { body, can, fail } from '../http/respond.js';

/** จัดซื้อวัสดุและเช่า/ยืมอุปกรณ์ของโครงการ (/projects/{code}/purchases, /rentals) */
export const procurementRouter = Router();

/** มีโครงการและบันทึกสัญญาแล้ว */
function requireProject(code: string) {
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    if (!findContracted(code)) fail(409, 'โครงการยังไม่ได้บันทึกสัญญา', 'บันทึกสัญญาก่อนจัดซื้อหรือเช่าอุปกรณ์');
}

/** ขอซื้อ/ขอเช่า: ทีมหน้างาน ผู้จัดการโครงการ หรือฝ่ายจัดซื้อ */
const canRequest = () => can('progress.update') || can('project.manage') || can('procurement.manage');
/** ตรวจรับของ/อุปกรณ์ที่หน้างาน และคลังหน้างาน: ผู้จัดการโครงการ วิศวกร โฟร์แมน เจ้าของบริษัท (หรือฝ่ายจัดซื้อ) */
const canReceive = () => can('procurement.receive') || can('procurement.manage');

/** ส่งผลลัพธ์จาก domain (สำเร็จ = JSON, ไม่สำเร็จ = Problem) */
function send<T>(res: import('express').Response, result: Result<T>, created = false) {
    if ('ok' in result) {
        res.status(created ? 201 : 200).json(result.ok);
        return;
    }
    fail(result.status, result.title, result.detail, result.errors);
}

// ---------- ใบขอซื้อ ----------

procurementRouter.get('/projects/:code/purchases', (req, res) => {
    const code = req.params['code']!;
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    res.json(listPurchases(code));
});

procurementRouter.post('/projects/:code/purchases', (req, res) => {
    const code = req.params['code']!;
    if (!canRequest()) fail(403, 'ไม่มีสิทธิ์ขอซื้อวัสดุ');
    requireProject(code);
    send(res, createPurchase(code, body<ApiSchemas['PurchaseRequestInput']>(req)), true);
});

procurementRouter.post('/projects/:code/purchases/:id/order', (req, res) => {
    const code = req.params['code']!;
    if (!can('procurement.manage')) fail(403, 'ไม่มีสิทธิ์ออกใบสั่งซื้อ');
    requireProject(code);
    send(res, orderPurchase(code, req.params['id']!, body<ApiSchemas['PurchaseOrderInput']>(req)));
});

procurementRouter.post('/projects/:code/purchases/:id/receive', (req, res) => {
    const code = req.params['code']!;
    if (!canReceive()) fail(403, 'ไม่มีสิทธิ์ตรวจรับของ');
    requireProject(code);
    send(res, receivePurchase(code, req.params['id']!, body<ApiSchemas['PurchaseReceiveInput']>(req)));
});

procurementRouter.post('/projects/:code/purchases/:id/cancel', (req, res) => {
    const code = req.params['code']!;
    requireProject(code);
    const purchase = findPurchaseRecord(code, req.params['id']!);
    if (purchase && !(isRequester(purchase) || can('procurement.manage') || can('project.manage'))) fail(403, 'ไม่มีสิทธิ์ยกเลิกใบขอซื้อนี้');
    send(res, cancelPurchase(code, req.params['id']!, body<ApiSchemas['CancelInput']>(req).reason));
});

// ---------- เช่า / ยืมอุปกรณ์ ----------

procurementRouter.get('/projects/:code/rentals', (req, res) => {
    const code = req.params['code']!;
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    res.json(listRentals(code));
});

procurementRouter.post('/projects/:code/rentals', (req, res) => {
    const code = req.params['code']!;
    if (!canRequest()) fail(403, 'ไม่มีสิทธิ์ขอเช่า/ยืมอุปกรณ์');
    requireProject(code);
    send(res, createRental(code, body<ApiSchemas['RentalInput']>(req)), true);
});

procurementRouter.post('/projects/:code/rentals/:id/start', (req, res) => {
    const code = req.params['code']!;
    if (!canReceive()) fail(403, 'ไม่มีสิทธิ์รับอุปกรณ์เข้าหน้างาน');
    requireProject(code);
    send(res, startRental(code, req.params['id']!, body<ApiSchemas['RentalStartInput']>(req)));
});

procurementRouter.post('/projects/:code/rentals/:id/extend', (req, res) => {
    const code = req.params['code']!;
    if (!can('procurement.manage')) fail(403, 'ไม่มีสิทธิ์ขยายเวลาเช่า/ยืม');
    requireProject(code);
    send(res, extendRental(code, req.params['id']!, body<ApiSchemas['RentalExtendInput']>(req)));
});

procurementRouter.post('/projects/:code/rentals/:id/return', (req, res) => {
    const code = req.params['code']!;
    if (!canReceive()) fail(403, 'ไม่มีสิทธิ์บันทึกการคืนอุปกรณ์');
    requireProject(code);
    send(res, returnRental(code, req.params['id']!, body<ApiSchemas['RentalReturnInput']>(req)));
});

procurementRouter.post('/projects/:code/rentals/:id/cancel', (req, res) => {
    const code = req.params['code']!;
    requireProject(code);
    const rental = findRentalRecord(code, req.params['id']!);
    if (rental && !(isRequester(rental) || can('procurement.manage') || can('project.manage'))) fail(403, 'ไม่มีสิทธิ์ยกเลิกรายการนี้');
    send(res, cancelRental(code, req.params['id']!, body<ApiSchemas['CancelInput']>(req).reason));
});

// ---------- BOQ และการใช้วัสดุ ----------

procurementRouter.get('/projects/:code/boq', (req, res) => {
    const code = req.params['code']!;
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    res.json(getBoq(code));
});

procurementRouter.put('/projects/:code/boq', (req, res) => {
    const code = req.params['code']!;
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์แก้ไข BOQ');
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    send(res, saveBoq(code, body<ApiSchemas['ProjectBoqInput']>(req), getTimeline(code)?.phases.map((phase) => phase.code) ?? []));
});

procurementRouter.get('/projects/:code/material-usage', (req, res) => {
    const code = req.params['code']!;
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    res.json(materialUsage(code));
});

// ---------- คลังหลัก ----------

procurementRouter.get('/projects/:code/stock-movements', (req, res) => {
    const code = req.params['code']!;
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    res.json(listProjectMovements(code));
});

procurementRouter.post('/projects/:code/stock-movements', (req, res) => {
    const code = req.params['code']!;
    if (!canReceive()) fail(403, 'ไม่มีสิทธิ์บันทึกรับเข้า/เบิกคลัง');
    requireProject(code);
    send(res, createStockMovement(code, body<ApiSchemas['StockMovementInput']>(req)), true);
});

procurementRouter.get('/warehouse/stock', (_req, res) => {
    res.json(warehouseStock());
});

procurementRouter.get('/warehouse/movements', (_req, res) => {
    res.json(listWarehouseMovements());
});

// ---------- รายการวัสดุ ----------

const canEditMaterials = () => can('procurement.manage') || can('project.manage');

procurementRouter.get('/materials', (_req, res) => {
    res.json(listMaterials());
});

procurementRouter.post('/materials', (req, res) => {
    if (!canEditMaterials()) fail(403, 'ไม่มีสิทธิ์แก้ไขรายการวัสดุ');
    send(res, createMaterial(body<ApiSchemas['MaterialInput']>(req)), true);
});

procurementRouter.put('/materials/:materialCode', (req, res) => {
    if (!canEditMaterials()) fail(403, 'ไม่มีสิทธิ์แก้ไขรายการวัสดุ');
    send(res, updateMaterial(req.params['materialCode']!, body<ApiSchemas['MaterialInput']>(req)));
});

// ---------- ข้อมูลบริษัท (หัวกระดาษใบสั่งซื้อ) ----------

procurementRouter.get('/settings/company', (_req, res) => {
    res.json(companyProfile);
});

procurementRouter.put('/settings/company', (req, res) => {
    if (!can('user.manage')) fail(403, 'ไม่มีสิทธิ์แก้ไขข้อมูลบริษัท');
    send(res, saveCompanyProfile(body<ApiSchemas['CompanyProfile']>(req)));
});
