import { HttpResponse, delay, http } from 'msw';
import { ApiSchemas } from '@/app/api/api';
import { auditLogs } from '../data/audit-logs';
import { api, matchesQuery, paginate } from '../utils';

const MODULE_LABEL: Record<ApiSchemas['AuditModule'], string> = {
    approval: 'อนุมัติ',
    project: 'โครงการ',
    personnel: 'บุคลากร',
    procurement: 'จัดซื้อ',
    finance: 'การเงิน',
    system: 'ระบบ'
};

function filterLogs(url: URL) {
    const module = url.searchParams.get('module');
    const userId = url.searchParams.get('userId');
    const query = url.searchParams.get('q');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    return auditLogs.filter((entry) => (!module || entry.module === module) && (!userId || entry.user.id === userId) && (!from || entry.at >= from) && (!to || entry.at <= to) && matchesQuery(query, entry.action, entry.target, entry.detail));
}

const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

export const auditLogHandlers = [
    http.get(api('/audit-logs/export'), async ({ request }) => {
        await delay(300);
        const header = ['เวลา', 'ผู้ใช้', 'บทบาท', 'ระบบ', 'การกระทำ', 'รายการ', 'รายละเอียด'];
        const rows = filterLogs(new URL(request.url)).map((entry) => [entry.at, entry.user.name, entry.user.roleLabel, MODULE_LABEL[entry.module], entry.action, entry.target, entry.detail ?? '']);
        const csv = '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
        return new HttpResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
    }),

    http.get(api('/audit-logs'), async ({ request }) => {
        await delay(300);
        const url = new URL(request.url);
        return HttpResponse.json(paginate(filterLogs(url), url));
    })
];
