import { Router } from 'express';
import type { ApiSchemas } from '../api/api.js';
import { recordAudit } from '../domain/audit-logs.js';
import { CONSTRUCTION_OPTIONS, normalizeOptions } from '../domain/construction-options.js';
import { HOUSE_PLANS } from '../domain/house-plans.js';
import { cancelChangeOrder, confirmByCustomer, createChangeOrder, listChangeOrders } from '../domain/change-orders.js';
import { apiDocuments, apiInstallments, apiPhotos } from '../domain/project-records.js';
import { projectTeam } from '../domain/project-team.js';
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
} from '../domain/projects.js';
import { CURRENT_USER } from '../domain/users.js';
import { matchesQuery, paginate } from '../domain/utils.js';
import { body, can, fail, failIfInvalid, query, send } from '../http/respond.js';
import { isImage } from './files.js';

/** นามสกุลเอกสารที่รับ (ชนิด MIME ของ DWG/Office ไม่แน่นอนในแต่ละเบราว์เซอร์ จึงดูจากนามสกุล) */
const DOCUMENT_EXTENSIONS: Record<string, ApiSchemas['ProjectDocument']['fileType']> = { pdf: 'pdf', xlsx: 'xlsx', xls: 'xlsx', docx: 'docx', doc: 'docx', dwg: 'dwg' };
const DOCUMENT_CATEGORIES: ApiSchemas['DocumentCategory'][] = ['contract', 'drawing', 'permit', 'inspection', 'billing', 'handover'];

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const fileTypeOf = (file: ApiSchemas['UploadedFile']): ApiSchemas['ProjectDocument']['fileType'] => (isImage(file) ? 'image' : (DOCUMENT_EXTENSIONS[extensionOf(file.name)] ?? 'pdf'));

const currentAuthor = (): ApiSchemas['UserRef'] => ({ id: CURRENT_USER.id, name: CURRENT_USER.name, roleLabel: CURRENT_USER.roleLabel });

/** 404 ถ้าไม่มีโครงการ, 409 ถ้ายังไม่บันทึกสัญญา */
function requireContract(code: string) {
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    if (!findContracted(code)) fail(409, 'โครงการยังไม่ได้บันทึกสัญญา', 'บันทึกสัญญาก่อน');
}

/** ข้อมูลรายโครงการ (ไทม์ไลน์ งวด ภาพ เอกสาร ทีม) มีได้หลังบันทึกสัญญาและตั้งค่างานก่อสร้างแล้ว */
export function requirePlan(code: string) {
    requireContract(code);
    if (!isConfigured(code)) fail(409, 'ยังไม่ได้ตั้งค่างานก่อสร้าง', 'ตั้งค่างานก่อสร้างเพื่อสร้างไทม์ไลน์ก่อน');
}

/** ตรวจตัวเลือกและการปรับงานย่อยของหน้าตั้งค่างานก่อสร้าง */
function readSetupInput(input: Partial<ApiSchemas['ProjectSetupInput']>) {
    const { options, errors } = normalizeOptions(input.options);
    failIfInvalid(errors, 'ตัวเลือกไม่ถูกต้อง');
    const { overrides, errors: taskErrors } = normalizeOverrides(options, input);
    failIfInvalid(taskErrors, 'งานย่อยไม่ถูกต้อง');
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

export const projectRouter = Router();

projectRouter.get('/projects', (req, res) => {
    const status = query(req, 'status');
    const group = query(req, 'group') as ApiSchemas['ProjectGroup'] | null;
    const q = query(req, 'q');
    res.json(listProjects().filter((project) => (!status || project.status === status) && (!group || inGroup(project, group)) && matchesQuery(q, project.code, project.customerName, project.responsibleName)));
});

projectRouter.post('/projects', (req, res) => {
    if (!can('project.create')) fail(403, 'ไม่มีสิทธิ์เปิดโครงการ');
    const input = body<ApiSchemas['ProjectInput']>(req);
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
    failIfInvalid(errors);
    res.status(201).json(createProject(input as ApiSchemas['ProjectInput']));
});

projectRouter.post('/projects/:code/contract', (req, res) => {
    const code = req.params['code']!;
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์บันทึกสัญญา');
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    if (findContracted(code)) fail(409, 'โครงการนี้บันทึกสัญญาแล้ว');
    const input = body<ApiSchemas['ContractInput']>(req) as ApiSchemas['ContractInput'];
    const errors: Record<string, string> = {};
    if (!(input.value > 0)) errors['value'] = 'มูลค่าสัญญาต้องมากกว่า 0';
    if (!input.location?.trim()) errors['location'] = 'กรุณาระบุที่ตั้งหน้างาน';
    if (!DATE.test(input.signedDate ?? '')) errors['signedDate'] = 'กรุณาระบุวันที่เซ็นสัญญา';
    else if (input.signedDate > todayIso()) errors['signedDate'] = 'วันเซ็นสัญญาต้องไม่เกินวันนี้';
    if (!DATE.test(input.startDate ?? '')) errors['startDate'] = 'กรุณาระบุวันเริ่มงาน';
    else if (DATE.test(input.signedDate ?? '') && input.startDate < input.signedDate) errors['startDate'] = 'วันเริ่มงานต้องไม่ก่อนวันเซ็นสัญญา';
    if (!DATE.test(input.deliveryDate ?? '')) errors['deliveryDate'] = 'กรุณาระบุกำหนดส่งมอบ';
    else if (DATE.test(input.startDate ?? '') && (Date.parse(input.deliveryDate) - Date.parse(input.startDate)) / 86_400_000 < 30) errors['deliveryDate'] = 'กำหนดส่งมอบต้องห่างจากวันเริ่มอย่างน้อย 30 วัน';
    failIfInvalid(errors);
    res.json(recordContract(code, input));
});

projectRouter.get('/settings/construction-options', (_req, res) => {
    res.json(CONSTRUCTION_OPTIONS);
});

projectRouter.get('/settings/project-regions', (_req, res) => {
    res.json(PROJECT_REGIONS);
});

projectRouter.get('/projects/:code/setup', (req, res) => {
    const code = req.params['code']!;
    requireContract(code);
    res.json(getSetup(code));
});

projectRouter.post('/projects/:code/setup/preview', (req, res) => {
    const code = req.params['code']!;
    requireContract(code);
    const { options, overrides } = readSetupInput(body<ApiSchemas['ProjectSetupInput']>(req));
    res.json(previewSetup(code, options, overrides));
});

projectRouter.put('/projects/:code/setup', (req, res) => {
    const code = req.params['code']!;
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์ตั้งค่างานก่อสร้าง');
    requireContract(code);
    if (isSetupLocked(code)) fail(409, 'แก้การตั้งค่าไม่ได้', getSetup(code).lockedReason);
    const { options, overrides } = readSetupInput(body<ApiSchemas['ProjectSetupInput']>(req));
    res.json(saveSetup(code, options, overrides, CURRENT_USER.name));
});

projectRouter.get('/projects/:code', (req, res) => {
    const project = currentProject(req.params['code']!);
    if (!project) fail(404, 'ไม่พบโครงการ');
    res.json(project);
});

projectRouter.get('/projects/:code/installments', (req, res) => {
    const code = req.params['code']!;
    requirePlan(code);
    res.json(apiInstallments(code));
});

projectRouter.get('/projects/:code/photos', (req, res) => {
    const code = req.params['code']!;
    requirePlan(code);
    const photos = apiPhotos(code)!;
    const phaseCode = query(req, 'phaseCode');
    const phases = new Map<string, ApiSchemas['SitePhotoPage']['phases'][number]>();
    for (const photo of photos) {
        const phase = phases.get(photo.phaseCode) ?? { phaseCode: photo.phaseCode, phaseStep: photo.phaseStep, phaseShortName: photo.phaseShortName, count: 0 };
        phase.count++;
        phases.set(photo.phaseCode, phase);
    }
    const page = paginate(phaseCode ? photos.filter((photo) => photo.phaseCode === phaseCode) : photos, req.query);
    res.json({ ...page, phases: [...phases.values()].sort((a, b) => a.phaseStep - b.phaseStep) });
});

projectRouter.get('/projects/:code/documents', (req, res) => {
    const code = req.params['code']!;
    requirePlan(code);
    const category = query(req, 'category');
    const q = query(req, 'q');
    res.json(apiDocuments(code)!.filter((doc) => (!category || doc.category === category) && matchesQuery(q, doc.name)));
});

projectRouter.get('/projects/:code/team', (req, res) => {
    const code = req.params['code']!;
    requirePlan(code);
    res.json(projectTeam(code));
});

projectRouter.get('/projects/:code/timeline', (req, res) => {
    const code = req.params['code']!;
    requirePlan(code);
    res.json(getTimeline(code));
});

projectRouter.get('/projects/:code/updates', (req, res) => {
    const code = req.params['code']!;
    requirePlan(code);
    res.json(paginate(getUpdates(code), req.query));
});

projectRouter.post('/projects/:code/updates', (req, res) => {
    const code = req.params['code']!;
    if (!can('progress.update')) fail(403, 'ไม่มีสิทธิ์บันทึกความคืบหน้า');
    requirePlan(code);
    const timeline = getTimeline(code)!;
    const input = body<ApiSchemas['ProgressUpdateInput']>(req) as ApiSchemas['ProgressUpdateInput'];
    const note = input.note?.trim();
    const changes = input.taskChanges ?? [];
    const errors: Record<string, string> = {};

    validateCommon(code, input.reportDate, input.photoIds, errors);
    validateDocuments(input.documents, errors);
    if (!(input.workers >= 0)) errors['workers'] = 'จำนวนแรงงานต้องไม่ติดลบ';
    if (!changes.length && !note && !input.documents?.length) errors['note'] = 'ระบุงานที่คืบหน้า เขียนหมายเหตุ หรือแนบเอกสาร อย่างน้อย 1 อย่าง';
    if (input.issues?.some((issue) => !issue.title?.trim())) errors['issues'] = 'กรุณาระบุรายละเอียดปัญหาให้ครบ';

    const resolved = changes.map((change) => ({ change, found: findTask(timeline, change.taskCode) }));
    for (const { change, found } of resolved) {
        const key = `taskChanges.${change.taskCode}`;
        if (!found) errors[key] = 'ไม่พบงานนี้ในแผน';
        else if (found.task.isMilestone) errors[key] = 'หมุดหมายจะเสร็จเองเมื่องานในขั้นตอนเสร็จครบ';
        else if (found.task.isHoldPoint) errors[key] = 'จุดตรวจต้องบันทึกผลตรวจแทนการปรับ %';
        else if (!Number.isInteger(change.progress) || change.progress < 0 || change.progress > 100) errors[key] = 'ความคืบหน้าต้องอยู่ระหว่าง 0-100';
        else if (change.progress < found.task.progress && !note) errors[key] = 'ลดความคืบหน้าต้องระบุเหตุผลในหมายเหตุ';
    }
    failIfInvalid(errors);

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
        reportDate: input.reportDate,
        createdAt: new Date().toISOString(),
        author: currentAuthor(),
        weather: input.weather,
        workers: input.workers,
        note,
        taskChanges,
        issues: (input.issues ?? []).map((issue) => ({ ...issue, title: issue.title.trim() })),
        photos: (input.photoIds ?? []).map((id) => uploads.get(id)!),
        documents: toProjectDocuments(updateId, input.reportDate, input.documents),
        overallProgress: timeline.progress
    };
    getUpdates(code).unshift(update);
    recordAudit({ module: 'project', action: 'บันทึกความคืบหน้า', target: code, detail: `${taskChanges.length} งาน · ภาพรวม ${timeline.progress}%${update.documents.length ? ` · เอกสาร ${update.documents.length} ไฟล์` : ''}` });
    res.status(201).json(update);
});

projectRouter.post('/projects/:code/tasks/:taskCode/inspection', (req, res) => {
    const code = req.params['code']!;
    if (!can('progress.update')) fail(403, 'ไม่มีสิทธิ์บันทึกผลตรวจ');
    requirePlan(code);
    const timeline = getTimeline(code)!;
    const found = findTask(timeline, req.params['taskCode']!);
    if (!found || !found.task.isHoldPoint) fail(404, 'ไม่พบจุดตรวจนี้');
    if (found.task.status === 'done') fail(409, 'จุดตรวจนี้ผ่านแล้ว');

    const input = body<ApiSchemas['InspectionInput']>(req) as ApiSchemas['InspectionInput'];
    const note = input.note?.trim();
    const errors: Record<string, string> = {};
    validateCommon(code, todayIso(), input.photoIds, errors);
    validateDocuments(input.documents, errors);
    if (input.result !== 'passed' && input.result !== 'failed') errors['result'] = 'กรุณาเลือกผลการตรวจ';
    if (input.result === 'failed' && !note) errors['note'] = 'กรุณาระบุสิ่งที่ต้องแก้ไข';
    failIfInvalid(errors);

    const from = found.task.progress;
    // ตรวจไม่ผ่าน: จุดตรวจยังเปิดอยู่ (กำลังดำเนินการ) จนกว่าจะตรวจใหม่
    found.task.progress = input.result === 'passed' ? 100 : Math.max(from, 50);
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
        inspection: { taskCode: found.task.code, taskName: found.task.name, result: input.result },
        issues: input.result === 'failed' ? [{ title: `ตรวจไม่ผ่าน: ${found.task.name}`, severity: 'high' }] : [],
        photos: (input.photoIds ?? []).map((id) => uploads.get(id)!),
        documents: toProjectDocuments(updateId, todayIso(), input.documents),
        overallProgress: timeline.progress
    };
    getUpdates(code).unshift(update);
    recordAudit({ module: 'project', action: input.result === 'passed' ? 'ตรวจผ่าน' : 'ตรวจไม่ผ่าน', target: `${code} ${found.task.code}`, detail: found.task.name + (note ? ` · ${note}` : '') });
    res.status(201).json(update);
});

// ---------- งานเพิ่ม-ลด (อนุมัติ/ไม่อนุมัติผ่าน /approvals/{approvalId}) ----------

projectRouter.get('/projects/:code/change-orders', (req, res) => {
    const code = req.params['code']!;
    requirePlan(code);
    res.json(listChangeOrders(code));
});

projectRouter.post('/projects/:code/change-orders', (req, res) => {
    const code = req.params['code']!;
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์ขอเพิ่ม-ลดงาน');
    requirePlan(code);
    send(res, createChangeOrder(code, body<ApiSchemas['ChangeOrderInput']>(req)), 201);
});

projectRouter.post('/projects/:code/change-orders/:id/customer-confirm', (req, res) => {
    const code = req.params['code']!;
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์บันทึกการยืนยันของลูกค้า');
    requirePlan(code);
    send(res, confirmByCustomer(code, req.params['id']!));
});

projectRouter.post('/projects/:code/change-orders/:id/cancel', (req, res) => {
    const code = req.params['code']!;
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์ยกเลิกงานเพิ่ม-ลด');
    requirePlan(code);
    send(res, cancelChangeOrder(code, req.params['id']!, body<{ reason: string }>(req).reason));
});
