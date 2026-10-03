import { Router } from 'express';
import type { ApiSchemas } from '../api/api.js';
import { auditLogs } from '../domain/audit-logs.js';
import { dashboardSummary, monthlyCashFlow } from '../domain/finance.js';
import { HOUSE_PLANS } from '../domain/house-plans.js';
import { createPersonnel, findPersonnel, licenseAlerts, listPersonnel, present, updatePersonnel } from '../domain/personnel.js';
import { staffHistory } from '../domain/project-team.js';
import { projectPortfolio } from '../domain/projects.js';
import { matchesQuery, paginate } from '../domain/utils.js';
import { body, can, fail, failIfInvalid, query } from '../http/respond.js';

/** แบบบ้าน บุคลากร Dashboard และ Audit Log */
export const recordsRouter = Router();

// ---------- แบบบ้าน ----------

recordsRouter.get('/house-plans', (_req, res) => {
    res.json(HOUSE_PLANS);
});

recordsRouter.get('/house-plans/:code', (req, res) => {
    const plan = HOUSE_PLANS.find((item) => item.code === req.params['code']);
    if (!plan) fail(404, 'ไม่พบแบบบ้าน');
    res.json(plan);
});

// ---------- Dashboard (การเงินระดับบริษัทเฉพาะผู้มีสิทธิ์ finance.company) ----------

const requireCompanyFinance = () => {
    if (!can('finance.company')) fail(403, 'ไม่มีสิทธิ์ดูข้อมูลการเงินของบริษัท');
};

recordsRouter.get('/dashboard/summary', (_req, res) => {
    requireCompanyFinance();
    res.json(dashboardSummary());
});

recordsRouter.get('/dashboard/projects', (_req, res) => {
    // จำนวนโครงการดูได้ทุกคน ส่วนมูลค่าเฉพาะผู้มีสิทธิ์การเงินบริษัท
    res.json(projectPortfolio(can('finance.company')));
});

recordsRouter.get('/dashboard/cash-flow', (req, res) => {
    requireCompanyFinance();
    res.json(monthlyCashFlow(Math.min(24, Math.max(1, Number(query(req, 'months')) || 6))));
});

// ---------- บุคลากร ----------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FIELDS = ['birthDate', 'hireDate', 'endDate', 'professionalLicenseExpiresAt', 'workPermitExpiresAt'] as const;

function validatePersonnel(input: Partial<ApiSchemas['PersonnelInput']>) {
    const errors: Record<string, string> = {};
    if (!input.fullName?.trim()) errors['fullName'] = 'กรุณาระบุชื่อ-นามสกุล';
    for (const field of DATE_FIELDS) if (input[field] && !DATE.test(input[field]!)) errors[field] = 'รูปแบบวันที่ไม่ถูกต้อง';
    if (input.email && !/^[^\s@]+@[^\s@]+$/.test(input.email)) errors['email'] = 'รูปแบบอีเมลไม่ถูกต้อง';
    if (input.hireDate && input.endDate && input.endDate < input.hireDate) errors['endDate'] = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มงาน';
    if (input.documents?.some((doc) => !doc.type?.trim() || !doc.url)) errors['documents'] = 'เอกสารแนบต้องมีประเภทและไฟล์';
    failIfInvalid(errors);
    return input as ApiSchemas['PersonnelInput'];
}

recordsRouter.get('/personnel/license-alerts', (req, res) => {
    res.json(licenseAlerts(Math.max(1, Number(query(req, 'withinDays')) || 90)));
});

recordsRouter.get('/personnel', (req, res) => {
    const q = query(req, 'q');
    res.json(
        listPersonnel()
            .filter((record) => matchesQuery(q, record.employeeCode, record.fullName, record.position, record.phone))
            .map(present)
    );
});

recordsRouter.get('/personnel/:id', (req, res) => {
    const record = findPersonnel(req.params['id']!);
    if (!record) fail(404, 'ไม่พบข้อมูลบุคลากร');
    // ประวัติโครงการ = ประวัติเดิม + การมอบหมายในโครงการ
    const presented = present(record);
    const assigned = staffHistory(record.id).filter((item) => !presented.projectHistory.some((history) => history.projectCode === item.projectCode && history.role === item.role));
    res.json({ ...presented, projectHistory: [...presented.projectHistory, ...assigned] });
});

recordsRouter.post('/personnel', (req, res) => {
    res.status(201).json(present(createPersonnel(validatePersonnel(body<ApiSchemas['PersonnelInput']>(req)))));
});

recordsRouter.put('/personnel/:id', (req, res) => {
    const existing = findPersonnel(req.params['id']!);
    if (!existing) fail(404, 'ไม่พบข้อมูลบุคลากร');
    res.json(present(updatePersonnel(existing, validatePersonnel(body<ApiSchemas['PersonnelInput']>(req)))));
});

// ---------- Audit Log ----------

const MODULE_LABEL: Record<ApiSchemas['AuditModule'], string> = {
    approval: 'อนุมัติ',
    project: 'โครงการ',
    personnel: 'บุคลากร',
    procurement: 'จัดซื้อ',
    finance: 'การเงิน',
    system: 'ระบบ'
};

function filterLogs(req: Parameters<Parameters<typeof recordsRouter.get>[1]>[0]) {
    const module = query(req, 'module');
    const userId = query(req, 'userId');
    const q = query(req, 'q');
    const from = query(req, 'from');
    const to = query(req, 'to');
    return auditLogs.filter((entry) => (!module || entry.module === module) && (!userId || entry.user.id === userId) && (!from || entry.at >= from) && (!to || entry.at <= to) && matchesQuery(q, entry.action, entry.target, entry.detail));
}

const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

recordsRouter.get('/audit-logs/export', (req, res) => {
    const header = ['เวลา', 'ผู้ใช้', 'บทบาท', 'ระบบ', 'การกระทำ', 'รายการ', 'รายละเอียด'];
    const rows = filterLogs(req).map((entry) => [entry.at, entry.user.name, entry.user.roleLabel, MODULE_LABEL[entry.module], entry.action, entry.target, entry.detail ?? '']);
    // BOM ให้ Excel อ่านภาษาไทยถูกต้อง
    res.type('text/csv; charset=utf-8').send('﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n'));
});

recordsRouter.get('/audit-logs', (req, res) => {
    res.json(paginate(filterLogs(req), req.query));
});
