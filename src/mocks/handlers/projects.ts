import { HttpResponse, delay, http } from 'msw';
import { ApiSchemas } from '@/app/api/api';
import { recordAudit } from '../data/audit-logs';
import { CONSTRUCTION_OPTIONS, normalizeOptions } from '../data/construction-options';
import {
    PROJECT_REGIONS,
    createProject,
    currentProject,
    findContracted,
    findProject,
    findTask,
    getSetup,
    getTimeline,
    getUpdates,
    inGroup,
    isConfigured,
    isSetupLocked,
    listProjects,
    normalizeOverrides,
    previewSetup,
    recalculate,
    recordContract,
    saveSetup,
    todayIso,
    uploads
} from '../data/projects';
import { HOUSE_PLANS } from '../data/house-plans';
import { apiDocuments, apiInstallments, apiPhotos } from '../data/project-records';
import { projectTeam } from '../data/project-team';
import { CURRENT_USER } from '../data/users';
import { api, matchesQuery, paginate, problem } from '../utils';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** นามสกุลเอกสารที่รับ (ชนิด MIME ของ DWG/Office ไม่แน่นอนในแต่ละเบราว์เซอร์ จึงดูจากนามสกุล) */
const DOCUMENT_EXTENSIONS: Record<string, ApiSchemas['ProjectDocument']['fileType']> = { pdf: 'pdf', xlsx: 'xlsx', xls: 'xlsx', docx: 'docx', doc: 'docx', dwg: 'dwg' };
const DOCUMENT_CATEGORIES: ApiSchemas['DocumentCategory'][] = ['contract', 'drawing', 'permit', 'inspection', 'billing', 'handover'];

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const isImage = (file: ApiSchemas['UploadedFile']) => IMAGE_TYPES.includes(file.contentType);
const fileTypeOf = (file: ApiSchemas['UploadedFile']): ApiSchemas['ProjectDocument']['fileType'] => (isImage(file) ? 'image' : (DOCUMENT_EXTENSIONS[extensionOf(file.name)] ?? 'pdf'));

const currentAuthor = (): ApiSchemas['UserRef'] => ({ id: CURRENT_USER.id, name: CURRENT_USER.name, roleLabel: CURRENT_USER.roleLabel });

/** 404 ถ้าไม่มีโครงการ, 409 ถ้ายังไม่บันทึกสัญญา */
function requireContract(code: string) {
    if (!findProject(code)) return problem(404, 'ไม่พบโครงการ');
    if (!findContracted(code)) return problem(409, 'โครงการยังไม่ได้บันทึกสัญญา', 'บันทึกสัญญาก่อน');
    return null;
}

/** ข้อมูลรายโครงการ (ไทม์ไลน์ งวด ภาพ เอกสาร ทีม) มีได้หลังบันทึกสัญญาและตั้งค่างานก่อสร้างแล้ว */
function requirePlan(code: string) {
    const blocked = requireContract(code);
    if (blocked) return blocked;
    if (!isConfigured(code)) return problem(409, 'ยังไม่ได้ตั้งค่างานก่อสร้าง', 'ตั้งค่างานก่อสร้างเพื่อสร้างไทม์ไลน์ก่อน');
    return null;
}

/** ตรวจตัวเลือกและการปรับงานย่อยของหน้าตั้งค่างานก่อสร้าง */
async function readSetupInput(request: Request) {
    const body = ((await request.json()) ?? {}) as Partial<ApiSchemas['ProjectSetupInput']>;
    const { options, errors } = normalizeOptions(body.options);
    if (Object.keys(errors).length) return { problem: problem(422, 'ตัวเลือกไม่ถูกต้อง', Object.values(errors)[0], errors) };
    const { overrides, errors: taskErrors } = normalizeOverrides(options, body);
    if (Object.keys(taskErrors).length) return { problem: problem(422, 'งานย่อยไม่ถูกต้อง', Object.values(taskErrors)[0], taskErrors) };
    return { options, overrides };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE = /^0\d{8,9}$/;

function validateCommon(code: string, reportDate: string | undefined, photoIds: string[] | undefined, errors: Record<string, string>) {
    const project = findContracted(code)!;
    if (!reportDate) errors['reportDate'] = 'กรุณาระบุวันที่';
    else if (reportDate > todayIso()) errors['reportDate'] = 'บันทึกล่วงหน้าไม่ได้';
    else if (reportDate < project.startDate) errors['reportDate'] = 'ก่อนวันเริ่มโครงการ';
    if (photoIds?.some((id) => !uploads.has(id))) errors['photoIds'] = 'ไม่พบรูปที่อัปโหลด กรุณาอัปโหลดใหม่';
    else if (photoIds?.some((id) => !isImage(uploads.get(id)!))) errors['photoIds'] = 'รูปหน้างานต้องเป็นไฟล์รูปเท่านั้น (แนบเอกสารในส่วนเอกสารแนบ)';
}

function validateDocuments(documents: ApiSchemas['DocumentAttachmentInput'][] | undefined, errors: Record<string, string>) {
    if (documents?.some((doc) => !uploads.has(doc.fileId))) errors['documents'] = 'ไม่พบไฟล์เอกสารที่อัปโหลด กรุณาอัปโหลดใหม่';
    else if (documents?.some((doc) => !DOCUMENT_CATEGORIES.includes(doc.category))) errors['documents'] = 'กรุณาเลือกหมวดของเอกสารทุกไฟล์';
}

/** เอกสารแนบกลายเป็นเอกสารของโครงการ (ขึ้นในแท็บเอกสาร) */
function toProjectDocuments(updateId: string, reportDate: string, documents: ApiSchemas['DocumentAttachmentInput'][] | undefined): ApiSchemas['ProjectDocument'][] {
    return (documents ?? []).map((doc, index) => {
        const file = uploads.get(doc.fileId)!;
        return { id: `${updateId}-doc-${index + 1}`, category: doc.category, name: doc.name?.trim() || file.name, date: reportDate, fileType: fileTypeOf(file), sizeKb: file.sizeKb, downloadUrl: file.url, uploadedBy: CURRENT_USER.name, updateId };
    });
}

export const projectHandlers = [
    http.get(api('/projects'), async ({ request }) => {
        await delay(250);
        const url = new URL(request.url);
        const status = url.searchParams.get('status');
        const group = url.searchParams.get('group') as ApiSchemas['ProjectGroup'] | null;
        const query = url.searchParams.get('q');
        return HttpResponse.json(listProjects().filter((project) => (!status || project.status === status) && (!group || inGroup(project, group)) && matchesQuery(query, project.code, project.customerName, project.responsibleName)));
    }),

    http.post(api('/projects'), async ({ request }) => {
        await delay(450);
        if (!CURRENT_USER.permissions.includes('project.create')) return problem(403, 'ไม่มีสิทธิ์เปิดโครงการ');
        const input = (await request.json()) as ApiSchemas['ProjectInput'];
        const errors: Record<string, string> = {};
        const required: Array<[keyof ApiSchemas['ProjectInput'], string]> = [
            ['customerName', 'กรุณาระบุชื่อลูกค้า'],
            ['name', 'กรุณาระบุชื่อโครงการ'],
            ['housePlanName', 'กรุณาระบุแบบบ้านที่ลูกค้าต้องการ'],
            ['responsibleName', 'กรุณาเลือกผู้รับผิดชอบโครงการ']
        ];
        for (const [field, message] of required) if (!String(input[field] ?? '').trim()) errors[field] = message;
        if (!PHONE.test((input.phone ?? '').replace(/[\s-]/g, ''))) errors['phone'] = 'เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0';
        if (input.customerEmail?.trim() && !/^[^\s@]+@[^\s@]+$/.test(input.customerEmail.trim())) errors['customerEmail'] = 'รูปแบบอีเมลไม่ถูกต้อง';
        if (!PROJECT_REGIONS.some((region) => region.code === input.regionCode)) errors['regionCode'] = 'กรุณาเลือกจังหวัด';
        if (input.housePlanCode && !HOUSE_PLANS.some((plan) => plan.code === input.housePlanCode)) errors['housePlanCode'] = 'ไม่พบแบบบ้านนี้ในคลัง';
        if (Object.keys(errors).length) return problem(422, 'ข้อมูลไม่ถูกต้อง', Object.values(errors)[0], errors);
        return HttpResponse.json(createProject(input), { status: 201 });
    }),

    http.post(api('/projects/:code/contract'), async ({ params, request }) => {
        await delay(450);
        const code = String(params['code']);
        if (!CURRENT_USER.permissions.includes('project.manage')) return problem(403, 'ไม่มีสิทธิ์บันทึกสัญญา');
        if (!findProject(code)) return problem(404, 'ไม่พบโครงการ');
        if (findContracted(code)) return problem(409, 'โครงการนี้บันทึกสัญญาแล้ว');
        const input = (await request.json()) as ApiSchemas['ContractInput'];
        const errors: Record<string, string> = {};
        if (!(input.value > 0)) errors['value'] = 'มูลค่าสัญญาต้องมากกว่า 0';
        if (!input.location?.trim()) errors['location'] = 'กรุณาระบุที่ตั้งหน้างาน';
        if (!DATE.test(input.signedDate ?? '')) errors['signedDate'] = 'กรุณาระบุวันที่เซ็นสัญญา';
        else if (input.signedDate > todayIso()) errors['signedDate'] = 'วันเซ็นสัญญาต้องไม่เกินวันนี้';
        if (!DATE.test(input.startDate ?? '')) errors['startDate'] = 'กรุณาระบุวันเริ่มงาน';
        else if (DATE.test(input.signedDate ?? '') && input.startDate < input.signedDate) errors['startDate'] = 'วันเริ่มงานต้องไม่ก่อนวันเซ็นสัญญา';
        if (!DATE.test(input.deliveryDate ?? '')) errors['deliveryDate'] = 'กรุณาระบุกำหนดส่งมอบ';
        else if (DATE.test(input.startDate ?? '') && (Date.parse(input.deliveryDate) - Date.parse(input.startDate)) / 86_400_000 < 30) errors['deliveryDate'] = 'กำหนดส่งมอบต้องห่างจากวันเริ่มอย่างน้อย 30 วัน';
        if (Object.keys(errors).length) return problem(422, 'ข้อมูลไม่ถูกต้อง', Object.values(errors)[0], errors);
        return HttpResponse.json(recordContract(code, input));
    }),

    http.get(api('/settings/construction-options'), async () => {
        await delay(100);
        return HttpResponse.json(CONSTRUCTION_OPTIONS);
    }),

    http.get(api('/projects/:code/setup'), async ({ params }) => {
        await delay(150);
        const code = String(params['code']);
        return requireContract(code) ?? HttpResponse.json(getSetup(code));
    }),

    http.post(api('/projects/:code/setup/preview'), async ({ params, request }) => {
        await delay(150);
        const code = String(params['code']);
        const blocked = requireContract(code);
        if (blocked) return blocked;
        const setup = await readSetupInput(request);
        if ('problem' in setup) return setup.problem;
        return HttpResponse.json(previewSetup(code, setup.options, setup.overrides));
    }),

    http.put(api('/projects/:code/setup'), async ({ params, request }) => {
        await delay(450);
        const code = String(params['code']);
        if (!CURRENT_USER.permissions.includes('project.manage')) return problem(403, 'ไม่มีสิทธิ์ตั้งค่างานก่อสร้าง');
        const blocked = requireContract(code);
        if (blocked) return blocked;
        if (isSetupLocked(code)) return problem(409, 'แก้การตั้งค่าไม่ได้', getSetup(code).lockedReason);
        const setup = await readSetupInput(request);
        if ('problem' in setup) return setup.problem;
        return HttpResponse.json(saveSetup(code, setup.options, setup.overrides, CURRENT_USER.name));
    }),

    http.get(api('/settings/project-regions'), async () => {
        await delay(100);
        return HttpResponse.json(PROJECT_REGIONS);
    }),

    http.get(api('/projects/:code'), async ({ params }) => {
        await delay(150);
        const project = currentProject(String(params['code']));
        return project ? HttpResponse.json(project) : problem(404, 'ไม่พบโครงการ');
    }),

    http.get(api('/projects/:code/installments'), async ({ params }) => {
        await delay(200);
        const code = String(params['code']);
        return requirePlan(code) ?? HttpResponse.json(apiInstallments(code)!);
    }),

    http.get(api('/projects/:code/photos'), async ({ params, request }) => {
        await delay(250);
        const code = String(params['code']);
        const blocked = requirePlan(code);
        if (blocked) return blocked;
        const photos = apiPhotos(code)!;
        const url = new URL(request.url);
        const phaseCode = url.searchParams.get('phaseCode');
        const phases = new Map<string, ApiSchemas['SitePhotoPage']['phases'][number]>();
        for (const photo of photos) {
            const phase = phases.get(photo.phaseCode) ?? { phaseCode: photo.phaseCode, phaseStep: photo.phaseStep, phaseShortName: photo.phaseShortName, count: 0 };
            phase.count++;
            phases.set(photo.phaseCode, phase);
        }
        const page = paginate(phaseCode ? photos.filter((photo) => photo.phaseCode === phaseCode) : photos, url);
        return HttpResponse.json({ ...page, phases: [...phases.values()].sort((a, b) => a.phaseStep - b.phaseStep) });
    }),

    http.get(api('/projects/:code/documents'), async ({ params, request }) => {
        await delay(200);
        const code = String(params['code']);
        const blocked = requirePlan(code);
        if (blocked) return blocked;
        const documents = apiDocuments(code)!;
        const url = new URL(request.url);
        const category = url.searchParams.get('category');
        const query = url.searchParams.get('q');
        return HttpResponse.json(documents.filter((doc) => (!category || doc.category === category) && matchesQuery(query, doc.name)));
    }),

    http.get(api('/projects/:code/team'), async ({ params }) => {
        await delay(150);
        const code = String(params['code']);
        return requirePlan(code) ?? HttpResponse.json(projectTeam(code));
    }),

    http.get(api('/projects/:code/timeline'), async ({ params }) => {
        await delay(250);
        const code = String(params['code']);
        return requirePlan(code) ?? HttpResponse.json(getTimeline(code)!);
    }),

    http.get(api('/projects/:code/updates'), async ({ params, request }) => {
        await delay(250);
        const code = String(params['code']);
        return requirePlan(code) ?? HttpResponse.json(paginate(getUpdates(code), new URL(request.url)));
    }),

    http.post(api('/projects/:code/updates'), async ({ params, request }) => {
        await delay(400);
        const code = String(params['code']);
        const blocked = requirePlan(code);
        if (blocked) return blocked;
        const timeline = getTimeline(code)!;
        const body = (await request.json()) as ApiSchemas['ProgressUpdateInput'];
        const note = body.note?.trim();
        const changes = body.taskChanges ?? [];
        const errors: Record<string, string> = {};

        validateCommon(code, body.reportDate, body.photoIds, errors);
        validateDocuments(body.documents, errors);
        if (!(body.workers >= 0)) errors['workers'] = 'จำนวนแรงงานต้องไม่ติดลบ';
        if (!changes.length && !note && !body.documents?.length) errors['note'] = 'ระบุงานที่คืบหน้า เขียนหมายเหตุ หรือแนบเอกสาร อย่างน้อย 1 อย่าง';
        if (body.issues?.some((issue) => !issue.title?.trim())) errors['issues'] = 'กรุณาระบุรายละเอียดปัญหาให้ครบ';

        const resolved = changes.map((change) => ({ change, found: findTask(timeline, change.taskCode) }));
        for (const { change, found } of resolved) {
            const key = `taskChanges.${change.taskCode}`;
            if (!found) errors[key] = 'ไม่พบงานนี้ในแผน';
            else if (found.task.isMilestone) errors[key] = 'หมุดหมายจะเสร็จเองเมื่องานในขั้นตอนเสร็จครบ';
            else if (found.task.isHoldPoint) errors[key] = 'จุดตรวจต้องบันทึกผลตรวจแทนการปรับ %';
            else if (!Number.isInteger(change.progress) || change.progress < 0 || change.progress > 100) errors[key] = 'ความคืบหน้าต้องอยู่ระหว่าง 0-100';
            else if (change.progress < found.task.progress && !note) errors[key] = 'ลดความคืบหน้าต้องระบุเหตุผลในหมายเหตุ';
        }
        if (Object.keys(errors).length) return problem(422, 'ข้อมูลไม่ถูกต้อง', Object.values(errors)[0], errors);

        const taskChanges = resolved.map(({ change, found }) => {
            const from = found!.task.progress;
            found!.task.progress = change.progress;
            return { taskCode: change.taskCode, taskName: found!.task.name, phaseStep: found!.phase.step, from, to: change.progress };
        });
        recalculate(timeline);

        const updateId = `upd-${code}-${Date.now()}`;
        const update: ApiSchemas['ProgressUpdate'] = {
            id: updateId,
            projectCode: code,
            reportDate: body.reportDate,
            createdAt: new Date().toISOString(),
            author: currentAuthor(),
            weather: body.weather,
            workers: body.workers,
            note,
            taskChanges,
            issues: (body.issues ?? []).map((issue) => ({ ...issue, title: issue.title.trim() })),
            photos: (body.photoIds ?? []).map((id) => uploads.get(id)!),
            documents: toProjectDocuments(updateId, body.reportDate, body.documents),
            overallProgress: timeline.progress
        };
        getUpdates(code).unshift(update);
        recordAudit({ module: 'project', action: 'บันทึกความคืบหน้า', target: code, detail: `${taskChanges.length} งาน · ภาพรวม ${timeline.progress}%${update.documents.length ? ` · เอกสาร ${update.documents.length} ไฟล์` : ''}` });
        return HttpResponse.json(update, { status: 201 });
    }),

    http.post(api('/projects/:code/tasks/:taskCode/inspection'), async ({ params, request }) => {
        await delay(400);
        const code = String(params['code']);
        const blocked = requirePlan(code);
        if (blocked) return blocked;
        const timeline = getTimeline(code)!;
        const found = findTask(timeline, String(params['taskCode']));
        if (!found || !found.task.isHoldPoint) return problem(404, 'ไม่พบจุดตรวจนี้');
        if (found.task.status === 'done') return problem(409, 'จุดตรวจนี้ผ่านแล้ว');

        const body = (await request.json()) as ApiSchemas['InspectionInput'];
        const note = body.note?.trim();
        const errors: Record<string, string> = {};
        validateCommon(code, todayIso(), body.photoIds, errors);
        validateDocuments(body.documents, errors);
        if (body.result !== 'passed' && body.result !== 'failed') errors['result'] = 'กรุณาเลือกผลการตรวจ';
        if (body.result === 'failed' && !note) errors['note'] = 'กรุณาระบุสิ่งที่ต้องแก้ไข';
        if (Object.keys(errors).length) return problem(422, 'ข้อมูลไม่ถูกต้อง', Object.values(errors)[0], errors);

        const from = found.task.progress;
        // Failed inspections stay open (in progress) until re-inspected.
        found.task.progress = body.result === 'passed' ? 100 : Math.max(from, 50);
        recalculate(timeline);

        const updateId = `upd-${code}-${Date.now()}`;
        const update: ApiSchemas['ProgressUpdate'] = {
            id: updateId,
            projectCode: code,
            reportDate: todayIso(),
            createdAt: new Date().toISOString(),
            author: currentAuthor(),
            weather: 'sunny',
            workers: 0,
            note,
            taskChanges: [{ taskCode: found.task.code, taskName: found.task.name, phaseStep: found.phase.step, from, to: found.task.progress }],
            inspection: { taskCode: found.task.code, taskName: found.task.name, result: body.result },
            issues: body.result === 'failed' ? [{ title: `ตรวจไม่ผ่าน: ${found.task.name}`, severity: 'high' }] : [],
            photos: (body.photoIds ?? []).map((id) => uploads.get(id)!),
            documents: toProjectDocuments(updateId, todayIso(), body.documents),
            overallProgress: timeline.progress
        };
        getUpdates(code).unshift(update);
        recordAudit({ module: 'project', action: body.result === 'passed' ? 'ตรวจผ่าน' : 'ตรวจไม่ผ่าน', target: `${code} ${found.task.code}`, detail: found.task.name + (note ? ` · ${note}` : '') });
        return HttpResponse.json(update, { status: 201 });
    }),

    http.post(api('/uploads'), async ({ request }) => {
        await delay(300);
        const file = (await request.formData()).get('file');
        if (!(file instanceof File)) return problem(422, 'ไม่พบไฟล์');
        if (!IMAGE_TYPES.includes(file.type) && !DOCUMENT_EXTENSIONS[extensionOf(file.name)]) return problem(422, 'รองรับรูป JPG, PNG, WebP และเอกสาร PDF, Excel, Word, DWG');
        if (file.size > MAX_UPLOAD_BYTES) return problem(413, 'ไฟล์ใหญ่เกิน 10 MB');
        // Mock storage: the browser keeps the file; a real backend returns a storage URL.
        const uploaded: ApiSchemas['UploadedFile'] = { id: `file-${Date.now()}-${uploads.size + 1}`, url: URL.createObjectURL(file), name: file.name, sizeKb: Math.ceil(file.size / 1024), contentType: file.type };
        uploads.set(uploaded.id, uploaded);
        return HttpResponse.json(uploaded, { status: 201 });
    })
];
