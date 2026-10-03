import { Router } from 'express';
import type { ApiSchemas } from '../api/api.js';
import { approvalLevel, approvalSettings, approvals } from '../domain/approvals.js';
import { recordAudit } from '../domain/audit-logs.js';
import { applyDecision, blockApproval } from '../domain/change-orders.js';
import { CURRENT_USER } from '../domain/users.js';
import { matchesQuery, paginate } from '../domain/utils.js';
import { body, fail, query } from '../http/respond.js';
import { HttpProblem } from '../http/problem.js';

type Approval = ApiSchemas['Approval'];

const TYPE_LABEL: Record<Approval['type'], string> = {
    pr: 'ใบขอซื้อ',
    po: 'ใบสั่งซื้อ',
    subcontract: 'เบิกงวดผู้รับเหมาช่วง',
    'change-order': 'งานเพิ่ม-ลด',
    'petty-cash': 'เบิกเงินสดย่อย',
    rental: 'เช่าอุปกรณ์'
};

/** ตรวจว่าตัดสินคำขอได้ไหม โยน Problem ถ้าไม่ได้ */
function assertDecidable(approval: Approval | undefined): asserts approval is Approval {
    if (!approval) fail(404, 'ไม่พบคำขอ');
    if (approval.status !== 'pending') fail(409, 'คำขอนี้ถูกตัดสินไปแล้ว', `สถานะปัจจุบัน: ${approval.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}`);
    if (approval.approvalLevel === 'owner' && !CURRENT_USER.permissions.includes('approval.any')) fail(403, 'ยอดนี้ต้องให้เจ้าของบริษัทอนุมัติ');
}

/** อนุมัติได้ไหม (นอกจากสถานะและวงเงิน): งานเพิ่ม-ลดที่ลูกค้าขอต้องให้ลูกค้ายืนยันก่อน */
function assertApprovable(approval: Approval) {
    const blocked = blockApproval(approval);
    if (blocked) fail(blocked.status, blocked.title, blocked.detail);
}

function decide(approval: Approval, status: 'approved' | 'rejected', note?: string) {
    approval.status = status;
    approval.history.push({ action: status, user: { id: CURRENT_USER.id, name: CURRENT_USER.name, roleLabel: CURRENT_USER.roleLabel }, at: new Date().toISOString(), note: note || undefined });
    recordAudit({
        module: 'approval',
        action: status === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ',
        target: approval.id,
        detail: `${TYPE_LABEL[approval.type]} ${approval.projectCode} ฿${approval.amount.toLocaleString('th-TH')}${note ? ` · ${note}` : ''}`
    });
    // งานเพิ่ม-ลด: ปรับมูลค่าสัญญา กำหนดส่งมอบ และไทม์ไลน์ของโครงการ
    applyDecision(approval, status, note);
}

const findApproval = (id: string) => approvals.find((item) => item.id === id);

export const approvalRouter = Router();

approvalRouter.get('/settings/approval', (_req, res) => {
    res.json(approvalSettings);
});

approvalRouter.put('/settings/approval', (req, res) => {
    // เกณฑ์อนุมัติแก้ได้เฉพาะแอดมินหรือเจ้าของบริษัท
    if (CURRENT_USER.roleId !== 'admin' && CURRENT_USER.roleId !== 'owner') fail(403, 'ไม่มีสิทธิ์แก้เกณฑ์อนุมัติ');
    const input = body<ApiSchemas['ApprovalSettings']>(req);
    if (!(Number(input.projectManagerLimit) >= 0)) fail(422, 'ข้อมูลไม่ถูกต้อง', undefined, { projectManagerLimit: 'ต้องเป็นจำนวนเงินตั้งแต่ 0 ขึ้นไป' });
    Object.assign(approvalSettings, { projectManagerLimit: Number(input.projectManagerLimit), changeOrderRequiresOwner: input.changeOrderRequiresOwner ?? approvalSettings.changeOrderRequiresOwner });
    for (const approval of approvals) if (approval.status === 'pending') approval.approvalLevel = approvalLevel(approval.type, approval.amount);
    recordAudit({ module: 'system', action: 'แก้ไขเกณฑ์อนุมัติ', target: 'ผู้จัดการโครงการ', detail: `วงเงินอนุมัติ ฿${approvalSettings.projectManagerLimit.toLocaleString('th-TH')} ต่อรายการ` });
    res.json(approvalSettings);
});

approvalRouter.get('/approvals/summary', (_req, res) => {
    const pending = approvals.filter((item) => item.status === 'pending');
    const summary: ApiSchemas['ApprovalSummary'] = {
        pending: pending.length,
        approved: approvals.filter((item) => item.status === 'approved').length,
        rejected: approvals.filter((item) => item.status === 'rejected').length,
        pendingAmount: pending.reduce((sum, item) => sum + item.amount, 0),
        ownerPending: pending.filter((item) => item.approvalLevel === 'owner').length
    };
    res.json(summary);
});

approvalRouter.get('/approvals', (req, res) => {
    const status = query(req, 'status');
    const type = query(req, 'type');
    const projectCode = query(req, 'projectCode');
    const q = query(req, 'q');
    const sort = query(req, 'sort') ?? 'newest';
    const items = approvals
        .filter((item) => (!status || item.status === status) && (!type || item.type === type) && (!projectCode || item.projectCode === projectCode) && matchesQuery(q, item.id, item.title, item.requestedBy.name, item.projectCode))
        .sort((a, b) => (sort === 'priority' ? Number(b.approvalLevel === 'owner') - Number(a.approvalLevel === 'owner') || b.amount - a.amount : Date.parse(b.requestedAt) - Date.parse(a.requestedAt)));
    res.json(paginate(items, req.query));
});

approvalRouter.get('/approvals/:id', (req, res) => {
    const approval = findApproval(req.params['id']!);
    if (!approval) fail(404, 'ไม่พบคำขอ');
    res.json(approval);
});

approvalRouter.post('/approvals/bulk-approve', (req, res) => {
    const input = body<{ ids: string[]; note: string }>(req);
    if (!input.ids?.length) fail(422, 'กรุณาเลือกอย่างน้อย 1 รายการ', undefined, { ids: 'จำเป็นต้องระบุ' });
    const result: ApiSchemas['BulkApproveResult'] = { approved: [], skipped: [] };
    for (const id of input.ids) {
        const approval = findApproval(id);
        try {
            assertDecidable(approval);
            assertApprovable(approval);
        } catch (error) {
            if (!(error instanceof HttpProblem)) throw error;
            result.skipped.push({ id, reason: error.title });
            continue;
        }
        decide(approval, 'approved', input.note?.trim());
        result.approved.push(approval);
    }
    res.json(result);
});

approvalRouter.post('/approvals/:id/approve', (req, res) => {
    const approval = findApproval(req.params['id']!);
    assertDecidable(approval);
    assertApprovable(approval);
    decide(approval, 'approved', body<ApiSchemas['DecisionInput']>(req).note?.trim());
    res.json(approval);
});

approvalRouter.post('/approvals/:id/reject', (req, res) => {
    const approval = findApproval(req.params['id']!);
    assertDecidable(approval);
    const note = body<ApiSchemas['RejectInput']>(req).note?.trim();
    if (!note) fail(422, 'กรุณาระบุเหตุผลที่ไม่อนุมัติ', undefined, { note: 'จำเป็นต้องระบุ' });
    decide(approval, 'rejected', note);
    res.json(approval);
});
