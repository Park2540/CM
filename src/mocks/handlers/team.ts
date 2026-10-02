import { HttpResponse, delay, http } from 'msw';
import { ApiSchemas } from '@/app/api/api';
import { Outcome, activeProjectCount, addStaff, addSubAssignment, projectAssignments, removeStaff, removeSubAssignment, updateStaff, updateSubAssignment } from '../data/project-team';
import { findContracted, findProject, isConfigured } from '../data/projects';
import { createSubcontractor, findSubcontractor, listSubcontractors, updateSubcontractor, validateSubcontractor } from '../data/subcontractors';
import { CURRENT_USER } from '../data/users';
import { api, matchesQuery, problem } from '../utils';

const canManage = () => CURRENT_USER.permissions.includes('project.manage');

/** ทีมงานและผู้รับเหมาของโครงการมีหลังบันทึกสัญญาและตั้งค่างานก่อสร้างแล้ว (ใช้ขั้นตอนจากไทม์ไลน์) */
function requirePlan(code: string) {
    if (!findProject(code)) return problem(404, 'ไม่พบโครงการ');
    if (!findContracted(code)) return problem(409, 'โครงการยังไม่ได้บันทึกสัญญา', 'บันทึกสัญญาก่อน');
    if (!isConfigured(code)) return problem(409, 'ยังไม่ได้ตั้งค่างานก่อสร้าง', 'ตั้งค่างานก่อสร้างเพื่อสร้างไทม์ไลน์ก่อน');
    return null;
}

function respond<T>(outcome: Outcome<T>, status = 200) {
    if ('ok' in outcome) return outcome.ok === true ? new HttpResponse(null, { status: 204 }) : HttpResponse.json(outcome.ok as object, { status });
    return problem(outcome.status, outcome.title, outcome.detail, outcome.errors);
}

export const teamHandlers = [
    // ---------- ทะเบียนผู้รับเหมาช่วง ----------
    http.get(api('/subcontractors'), async ({ request }) => {
        await delay(200);
        const url = new URL(request.url);
        const query = url.searchParams.get('q');
        const trade = url.searchParams.get('trade') as ApiSchemas['SubcontractorTrade'] | null;
        const status = url.searchParams.get('status');
        return HttpResponse.json(listSubcontractors(activeProjectCount).filter((item) => matchesQuery(query, item.code, item.name, item.contactName) && (!trade || item.trades.includes(trade)) && (!status || item.status === status)));
    }),

    http.post(api('/subcontractors'), async ({ request }) => {
        await delay(400);
        if (!canManage()) return problem(403, 'ไม่มีสิทธิ์เพิ่มผู้รับเหมาช่วง');
        const input = (await request.json()) as ApiSchemas['SubcontractorInput'];
        const { errors, conflict } = validateSubcontractor(input);
        if (Object.keys(errors).length) return problem(422, 'ข้อมูลไม่ถูกต้อง', Object.values(errors)[0], errors);
        if (conflict) return problem(409, 'ผู้รับเหมาซ้ำ', conflict, { taxId: conflict });
        const record = createSubcontractor(input);
        return HttpResponse.json({ ...record, activeProjects: 0 }, { status: 201 });
    }),

    http.put(api('/subcontractors/:id'), async ({ params, request }) => {
        await delay(400);
        if (!canManage()) return problem(403, 'ไม่มีสิทธิ์แก้ไขผู้รับเหมาช่วง');
        const existing = findSubcontractor(String(params['id']));
        if (!existing) return problem(404, 'ไม่พบผู้รับเหมา');
        const input = (await request.json()) as ApiSchemas['SubcontractorInput'];
        const { errors, conflict } = validateSubcontractor(input, existing.id);
        if (Object.keys(errors).length) return problem(422, 'ข้อมูลไม่ถูกต้อง', Object.values(errors)[0], errors);
        if (conflict) return problem(409, 'ผู้รับเหมาซ้ำ', conflict, { taxId: conflict });
        const record = updateSubcontractor(existing, input);
        return HttpResponse.json({ ...record, activeProjects: activeProjectCount(record.id) });
    }),

    // ---------- ทีมงานรายโครงการ ----------
    http.get(api('/projects/:code/assignments'), async ({ params }) => {
        await delay(200);
        const code = String(params['code']);
        return requirePlan(code) ?? HttpResponse.json(projectAssignments(code));
    }),

    http.post(api('/projects/:code/staff'), async ({ params, request }) => {
        await delay(350);
        const code = String(params['code']);
        if (!canManage()) return problem(403, 'ไม่มีสิทธิ์จัดการทีมงานโครงการ');
        return requirePlan(code) ?? respond(addStaff(code, (await request.json()) as ApiSchemas['StaffAssignmentInput']), 201);
    }),

    http.put(api('/projects/:code/staff/:id'), async ({ params, request }) => {
        await delay(350);
        const code = String(params['code']);
        if (!canManage()) return problem(403, 'ไม่มีสิทธิ์จัดการทีมงานโครงการ');
        return requirePlan(code) ?? respond(updateStaff(code, String(params['id']), (await request.json()) as ApiSchemas['StaffAssignmentInput']));
    }),

    http.delete(api('/projects/:code/staff/:id'), async ({ params }) => {
        await delay(300);
        const code = String(params['code']);
        if (!canManage()) return problem(403, 'ไม่มีสิทธิ์จัดการทีมงานโครงการ');
        return requirePlan(code) ?? respond(removeStaff(code, String(params['id'])));
    }),

    http.post(api('/projects/:code/subcontractors'), async ({ params, request }) => {
        await delay(350);
        const code = String(params['code']);
        if (!canManage()) return problem(403, 'ไม่มีสิทธิ์จัดการผู้รับเหมาช่วง');
        return requirePlan(code) ?? respond(addSubAssignment(code, (await request.json()) as ApiSchemas['SubcontractorAssignmentInput']), 201);
    }),

    http.put(api('/projects/:code/subcontractors/:id'), async ({ params, request }) => {
        await delay(350);
        const code = String(params['code']);
        if (!canManage()) return problem(403, 'ไม่มีสิทธิ์จัดการผู้รับเหมาช่วง');
        return requirePlan(code) ?? respond(updateSubAssignment(code, String(params['id']), (await request.json()) as ApiSchemas['SubcontractorAssignmentInput']));
    }),

    http.delete(api('/projects/:code/subcontractors/:id'), async ({ params }) => {
        await delay(300);
        const code = String(params['code']);
        if (!canManage()) return problem(403, 'ไม่มีสิทธิ์จัดการผู้รับเหมาช่วง');
        return requirePlan(code) ?? respond(removeSubAssignment(code, String(params['id'])));
    })
];
