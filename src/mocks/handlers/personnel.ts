import { HttpResponse, delay, http } from 'msw';
import { ApiSchemas } from '@/app/api/api';
import { createPersonnel, findPersonnel, licenseAlerts, listPersonnel, present, updatePersonnel } from '../data/personnel';
import { staffHistory } from '../data/project-team';
import { api, matchesQuery, problem } from '../utils';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FIELDS = ['birthDate', 'hireDate', 'endDate', 'professionalLicenseExpiresAt', 'workPermitExpiresAt'] as const;

function validate(input: ApiSchemas['PersonnelInput']): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!input.fullName?.trim()) errors['fullName'] = 'กรุณาระบุชื่อ-นามสกุล';
    for (const field of DATE_FIELDS) if (input[field] && !DATE.test(input[field]!)) errors[field] = 'รูปแบบวันที่ไม่ถูกต้อง';
    if (input.email && !/^[^\s@]+@[^\s@]+$/.test(input.email)) errors['email'] = 'รูปแบบอีเมลไม่ถูกต้อง';
    if (input.hireDate && input.endDate && input.endDate < input.hireDate) errors['endDate'] = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มงาน';
    if (input.documents?.some((doc) => !doc.type?.trim() || !doc.url)) errors['documents'] = 'เอกสารแนบต้องมีประเภทและไฟล์';
    return errors;
}

export const personnelHandlers = [
    http.get(api('/personnel/license-alerts'), async ({ request }) => {
        await delay(200);
        const withinDays = Math.max(1, Number(new URL(request.url).searchParams.get('withinDays')) || 90);
        return HttpResponse.json(licenseAlerts(withinDays));
    }),

    http.get(api('/personnel'), async ({ request }) => {
        await delay(250);
        const query = new URL(request.url).searchParams.get('q');
        return HttpResponse.json(
            listPersonnel()
                .filter((record) => matchesQuery(query, record.employeeCode, record.fullName, record.position, record.phone))
                .map(present)
        );
    }),

    http.get(api('/personnel/:id'), async ({ params }) => {
        await delay(200);
        const record = findPersonnel(String(params['id']));
        if (!record) return problem(404, 'ไม่พบข้อมูลบุคลากร');
        // ประวัติโครงการ = ประวัติเดิม + การมอบหมายในโครงการ (หลังบ้านสร้างจากการมอบหมายงาน)
        const presented = present(record);
        const assigned = staffHistory(record.id).filter((item) => !presented.projectHistory.some((history) => history.projectCode === item.projectCode && history.role === item.role));
        return HttpResponse.json({ ...presented, projectHistory: [...presented.projectHistory, ...assigned] });
    }),

    http.post(api('/personnel'), async ({ request }) => {
        await delay(350);
        const input = (await request.json()) as ApiSchemas['PersonnelInput'];
        const errors = validate(input);
        if (Object.keys(errors).length) return problem(422, 'ข้อมูลไม่ถูกต้อง', Object.values(errors)[0], errors);
        return HttpResponse.json(present(createPersonnel(input)), { status: 201 });
    }),

    http.put(api('/personnel/:id'), async ({ params, request }) => {
        await delay(350);
        const existing = findPersonnel(String(params['id']));
        if (!existing) return problem(404, 'ไม่พบข้อมูลบุคลากร');
        const input = (await request.json()) as ApiSchemas['PersonnelInput'];
        const errors = validate(input);
        if (Object.keys(errors).length) return problem(422, 'ข้อมูลไม่ถูกต้อง', Object.values(errors)[0], errors);
        return HttpResponse.json(present(updatePersonnel(existing, input)));
    })
];
