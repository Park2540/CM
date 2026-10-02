import { HttpResponse, delay, http } from 'msw';
import { ApiSchemas } from '@/app/api/api';
import { recordAudit } from '../data/audit-logs';
import { approvalLevel, approvalSettings, approvals } from '../data/approvals';
import { CURRENT_USER } from '../data/users';
import { api, matchesQuery, paginate, problem } from '../utils';

type Approval = ApiSchemas['Approval'];

const TYPE_LABEL: Record<Approval['type'], string> = {
    pr: 'ใบขอซื้อ',
    po: 'ใบสั่งซื้อ',
    subcontract: 'เบิกงวดผู้รับเหมาช่วง',
    'change-order': 'งานเพิ่ม-ลด',
    'petty-cash': 'เบิกเงินสดย่อย',
    rental: 'เช่าอุปกรณ์'
};

/** ตรวจว่าตัดสินคำขอได้ไหม คืน problem response ถ้าไม่ได้ */
function checkDecidable(approval: Approval | undefined) {
    if (!approval) return problem(404, 'ไม่พบคำขอ');
    if (approval.status !== 'pending') return problem(409, 'คำขอนี้ถูกตัดสินไปแล้ว', `สถานะปัจจุบัน: ${approval.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}`);
    if (approval.approvalLevel === 'owner' && !CURRENT_USER.permissions.includes('approval.any')) return problem(403, 'ยอดนี้ต้องให้เจ้าของบริษัทอนุมัติ');
    return null;
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
}

export const approvalHandlers = [
    http.get(api('/settings/approval'), async () => {
        await delay(150);
        return HttpResponse.json(approvalSettings);
    }),

    http.put(api('/settings/approval'), async ({ request }) => {
        const body = (await request.json()) as ApiSchemas['ApprovalSettings'];
        if (!(body.projectManagerLimit >= 0)) return problem(422, 'ข้อมูลไม่ถูกต้อง', undefined, { projectManagerLimit: 'ต้องเป็นจำนวนเงินตั้งแต่ 0 ขึ้นไป' });
        Object.assign(approvalSettings, body);
        for (const approval of approvals) if (approval.status === 'pending') approval.approvalLevel = approvalLevel(approval.type, approval.amount);
        recordAudit({ module: 'system', action: 'แก้ไขเกณฑ์อนุมัติ', target: 'ผู้จัดการโครงการ', detail: `วงเงินอนุมัติ ฿${body.projectManagerLimit.toLocaleString('th-TH')} ต่อรายการ` });
        return HttpResponse.json(approvalSettings);
    }),

    http.get(api('/approvals/summary'), async () => {
        await delay(150);
        const pending = approvals.filter((item) => item.status === 'pending');
        const summary: ApiSchemas['ApprovalSummary'] = {
            pending: pending.length,
            approved: approvals.filter((item) => item.status === 'approved').length,
            rejected: approvals.filter((item) => item.status === 'rejected').length,
            pendingAmount: pending.reduce((sum, item) => sum + item.amount, 0),
            ownerPending: pending.filter((item) => item.approvalLevel === 'owner').length
        };
        return HttpResponse.json(summary);
    }),

    http.get(api('/approvals'), async ({ request }) => {
        await delay(300);
        const url = new URL(request.url);
        const status = url.searchParams.get('status');
        const type = url.searchParams.get('type');
        const projectCode = url.searchParams.get('projectCode');
        const query = url.searchParams.get('q');
        const sort = url.searchParams.get('sort') ?? 'newest';

        const items = approvals
            .filter((item) => (!status || item.status === status) && (!type || item.type === type) && (!projectCode || item.projectCode === projectCode) && matchesQuery(query, item.id, item.title, item.requestedBy.name, item.projectCode))
            .sort((a, b) => (sort === 'priority' ? Number(b.approvalLevel === 'owner') - Number(a.approvalLevel === 'owner') || b.amount - a.amount : Date.parse(b.requestedAt) - Date.parse(a.requestedAt)));
        return HttpResponse.json(paginate(items, url));
    }),

    http.get(api('/approvals/:id'), async ({ params }) => {
        await delay(150);
        const approval = approvals.find((item) => item.id === params['id']);
        return approval ? HttpResponse.json(approval) : problem(404, 'ไม่พบคำขอ');
    }),

    http.post(api('/approvals/:id/approve'), async ({ params, request }) => {
        await delay(300);
        const approval = approvals.find((item) => item.id === params['id']);
        const error = checkDecidable(approval);
        if (error) return error;
        const body = (await request.json().catch(() => ({}))) as ApiSchemas['DecisionInput'];
        decide(approval!, 'approved', body?.note?.trim());
        return HttpResponse.json(approval!);
    }),

    http.post(api('/approvals/:id/reject'), async ({ params, request }) => {
        await delay(300);
        const approval = approvals.find((item) => item.id === params['id']);
        const error = checkDecidable(approval);
        if (error) return error;
        const body = (await request.json().catch(() => ({}))) as Partial<ApiSchemas['RejectInput']>;
        const note = body?.note?.trim();
        if (!note) return problem(422, 'กรุณาระบุเหตุผลที่ไม่อนุมัติ', undefined, { note: 'จำเป็นต้องระบุ' });
        decide(approval!, 'rejected', note);
        return HttpResponse.json(approval!);
    }),

    http.post(api('/approvals/bulk-approve'), async ({ request }) => {
        await delay(400);
        const body = (await request.json()) as { ids?: string[]; note?: string };
        if (!body?.ids?.length) return problem(422, 'กรุณาเลือกอย่างน้อย 1 รายการ', undefined, { ids: 'จำเป็นต้องระบุ' });

        const result: ApiSchemas['BulkApproveResult'] = { approved: [], skipped: [] };
        for (const id of body.ids) {
            const approval = approvals.find((item) => item.id === id);
            const error = checkDecidable(approval);
            if (error) {
                const problemBody = (await error.json()) as ApiSchemas['Problem'];
                result.skipped.push({ id, reason: problemBody.title });
                continue;
            }
            decide(approval!, 'approved', body.note?.trim());
            result.approved.push(approval!);
        }
        return HttpResponse.json(result);
    })
];
