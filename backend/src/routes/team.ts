import { Router } from 'express';
import type { ApiSchemas } from '../api/api.js';
import { activeProjectCount, addStaff, addSubAssignment, projectAssignments, removeStaff, removeSubAssignment, updateStaff, updateSubAssignment } from '../domain/project-team.js';
import { createSubcontractor, findSubcontractor, listSubcontractors, updateSubcontractor, validateSubcontractor } from '../domain/subcontractors.js';
import { matchesQuery } from '../domain/utils.js';
import { body, can, fail, failIfInvalid, query, send } from '../http/respond.js';
import { requirePlan } from './projects.js';

const requireManage = (message: string) => {
    if (!can('project.manage')) fail(403, message);
};

/** ทะเบียนผู้รับเหมาช่วง และทีมงาน/ผู้รับเหมารายโครงการ */
export const teamRouter = Router();

// ---------- ทะเบียนผู้รับเหมาช่วง ----------

teamRouter.get('/subcontractors', (req, res) => {
    const q = query(req, 'q');
    const trade = query(req, 'trade') as ApiSchemas['SubcontractorTrade'] | null;
    const status = query(req, 'status');
    res.json(listSubcontractors(activeProjectCount).filter((item) => matchesQuery(q, item.code, item.name, item.contactName) && (!trade || item.trades.includes(trade)) && (!status || item.status === status)));
});

teamRouter.post('/subcontractors', (req, res) => {
    requireManage('ไม่มีสิทธิ์เพิ่มผู้รับเหมาช่วง');
    const input = body<ApiSchemas['SubcontractorInput']>(req) as ApiSchemas['SubcontractorInput'];
    const { errors, conflict } = validateSubcontractor(input);
    failIfInvalid(errors);
    if (conflict) fail(409, 'ผู้รับเหมาซ้ำ', conflict, { taxId: conflict });
    res.status(201).json({ ...createSubcontractor(input), activeProjects: 0 });
});

teamRouter.put('/subcontractors/:id', (req, res) => {
    requireManage('ไม่มีสิทธิ์แก้ไขผู้รับเหมาช่วง');
    const existing = findSubcontractor(req.params['id']!);
    if (!existing) fail(404, 'ไม่พบผู้รับเหมา');
    const input = body<ApiSchemas['SubcontractorInput']>(req) as ApiSchemas['SubcontractorInput'];
    const { errors, conflict } = validateSubcontractor(input, existing.id);
    failIfInvalid(errors);
    if (conflict) fail(409, 'ผู้รับเหมาซ้ำ', conflict, { taxId: conflict });
    const record = updateSubcontractor(existing, input);
    res.json({ ...record, activeProjects: activeProjectCount(record.id) });
});

// ---------- ทีมงานรายโครงการ ----------

teamRouter.get('/projects/:code/assignments', (req, res) => {
    const code = req.params['code']!;
    requirePlan(code);
    res.json(projectAssignments(code));
});

teamRouter.post('/projects/:code/staff', (req, res) => {
    const code = req.params['code']!;
    requireManage('ไม่มีสิทธิ์จัดการทีมงานโครงการ');
    requirePlan(code);
    send(res, addStaff(code, body<ApiSchemas['StaffAssignmentInput']>(req) as ApiSchemas['StaffAssignmentInput']), 201);
});

teamRouter.put('/projects/:code/staff/:id', (req, res) => {
    const code = req.params['code']!;
    requireManage('ไม่มีสิทธิ์จัดการทีมงานโครงการ');
    requirePlan(code);
    send(res, updateStaff(code, req.params['id']!, body<ApiSchemas['StaffAssignmentInput']>(req) as ApiSchemas['StaffAssignmentInput']));
});

teamRouter.delete('/projects/:code/staff/:id', (req, res) => {
    const code = req.params['code']!;
    requireManage('ไม่มีสิทธิ์จัดการทีมงานโครงการ');
    requirePlan(code);
    send(res, removeStaff(code, req.params['id']!));
});

teamRouter.post('/projects/:code/subcontractors', (req, res) => {
    const code = req.params['code']!;
    requireManage('ไม่มีสิทธิ์จัดการผู้รับเหมาช่วง');
    requirePlan(code);
    send(res, addSubAssignment(code, body<ApiSchemas['SubcontractorAssignmentInput']>(req) as ApiSchemas['SubcontractorAssignmentInput']), 201);
});

teamRouter.put('/projects/:code/subcontractors/:id', (req, res) => {
    const code = req.params['code']!;
    requireManage('ไม่มีสิทธิ์จัดการผู้รับเหมาช่วง');
    requirePlan(code);
    send(res, updateSubAssignment(code, req.params['id']!, body<ApiSchemas['SubcontractorAssignmentInput']>(req) as ApiSchemas['SubcontractorAssignmentInput']));
});

teamRouter.delete('/projects/:code/subcontractors/:id', (req, res) => {
    const code = req.params['code']!;
    requireManage('ไม่มีสิทธิ์จัดการผู้รับเหมาช่วง');
    requirePlan(code);
    send(res, removeSubAssignment(code, req.params['id']!));
});
