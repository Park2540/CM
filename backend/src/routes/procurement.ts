import { Router } from 'express';
import type { ApiSchemas } from '../api/api.js';
import {
    Result,
    cancelPurchase,
    cancelRental,
    createPurchase,
    createRental,
    extendRental,
    findPurchaseRecord,
    findRentalRecord,
    isRequester,
    listPurchases,
    listRentals,
    orderPurchase,
    receivePurchase,
    returnRental,
    startRental
} from '../domain/procurement.js';
import { findContracted, findProject } from '../domain/projects.js';
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
    if (!can('procurement.manage')) fail(403, 'ไม่มีสิทธิ์สั่งซื้อ');
    requireProject(code);
    send(res, orderPurchase(code, req.params['id']!, body<ApiSchemas['PurchaseOrderInput']>(req)));
});

procurementRouter.post('/projects/:code/purchases/:id/receive', (req, res) => {
    const code = req.params['code']!;
    if (!can('procurement.manage')) fail(403, 'ไม่มีสิทธิ์รับของ');
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
    if (!can('procurement.manage')) fail(403, 'ไม่มีสิทธิ์รับอุปกรณ์เข้าหน้างาน');
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
    if (!can('procurement.manage')) fail(403, 'ไม่มีสิทธิ์บันทึกการคืนอุปกรณ์');
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
