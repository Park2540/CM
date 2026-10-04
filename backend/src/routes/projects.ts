import { Router } from 'express';
import type { ApiSchemas } from '../api/api.js';
import { recordAudit } from '../domain/audit-logs.js';
import { CONSTRUCTION_OPTIONS, normalizeOptions } from '../domain/construction-options.js';
import { HOUSE_PLANS } from '../domain/house-plans.js';
import { cancelChangeOrder, confirmByCustomer, createChangeOrder, listChangeOrders } from '../domain/change-orders.js';
import { apiDocuments, apiInstallments, apiPhotos } from '../domain/project-records.js';
import { projectTeam } from '../domain/project-team.js';
import { addPayment, cancelPayment, installmentKey } from '../domain/payments.js';
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
    setSiteLocation,
    normalizePaymentPercents,
    saveSetup,
    todayIso,
    uploads
} from '../domain/projects.js';
import { CURRENT_USER } from '../domain/users.js';
import { matchesQuery, paginate } from '../domain/utils.js';
import { body, can, fail, failIfInvalid, query, send } from '../http/respond.js';
import { SOURCE_MODEL_EXTENSIONS, VIEWABLE_MODEL_EXTENSIONS, extensionOf, isImage } from './files.js';
import { getHouse, saveHouse } from '../domain/project-house.js';
import { addModel, canConvert, findModel, listModels, nextVersion, queueConversion, removeModel } from '../domain/project-models.js';

/** นามสกุลเอกสารที่รับ (ชนิด MIME ของ DWG/Office ไม่แน่นอนในแต่ละเบราว์เซอร์ จึงดูจากนามสกุล) */
const DOCUMENT_EXTENSIONS: Record<string, ApiSchemas['ProjectDocument']['fileType']> = { pdf: 'pdf', xlsx: 'xlsx', xls: 'xlsx', docx: 'docx', doc: 'docx', dwg: 'dwg' };
const DOCUMENT_CATEGORIES: ApiSchemas['DocumentCategory'][] = ['contract', 'drawing', 'permit', 'inspection', 'billing', 'handover'];

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

/** ตรวจพิกัดหน้างาน (ไม่ส่ง = ไม่ปักหมุด) — คืนพิกัดที่ถูกต้อง หรือเติมข้อผิดพลาดที่ `${prefix}lat` / `${prefix}lng` */
function readCoordinates(point: Partial<ApiSchemas['SiteLocationInput']> | null | undefined, errors: Record<string, string>, prefix = ''): ApiSchemas['SiteLocationInput'] | null {
    if (point === undefined || point === null) return null;
    const lat = point.lat === null || point.lat === undefined || String(point.lat).trim() === '' ? NaN : Number(point.lat);
    const lng = point.lng === null || point.lng === undefined || String(point.lng).trim() === '' ? NaN : Number(point.lng);
    if (!(lat >= -90 && lat <= 90)) errors[`${prefix}lat`] = 'ละติจูดต้องอยู่ระหว่าง -90 ถึง 90';
    if (!(lng >= -180 && lng <= 180)) errors[`${prefix}lng`] = 'ลองจิจูดต้องอยู่ระหว่าง -180 ถึง 180';
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}

projectRouter.post('/projects', (req, res) => {
    if (!can('project.create')) fail(403, 'ไม่มีสิทธิ์เปิดโครงการ');
    const input = body<ApiSchemas['ProjectInput']>(req);
    const errors: Record<string, string> = {};
    const required: Array<[keyof ApiSchemas['ProjectInput'], string]> = [
        ['customerName', 'กรุณาระบุชื่อลูกค้า'],
        ['name', 'กรุณาระบุชื่อโครงการ'],
        ['responsibleName', 'กรุณาเลือกผู้รับผิดชอบโครงการ']
    ];
    for (const [field, message] of required) if (!String(input[field] ?? '').trim()) errors[field] = message;
    if (!PHONE.test((input.phone ?? '').replace(/[\s-]/g, ''))) errors['phone'] = 'เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0';
    if (input.customerEmail?.trim() && !/^[^\s@]+@[^\s@]+$/.test(input.customerEmail.trim())) errors['customerEmail'] = 'รูปแบบอีเมลไม่ถูกต้อง';
    if (!PROJECT_REGIONS.some((region) => region.code === input.regionCode)) errors['regionCode'] = 'กรุณาเลือกจังหวัด';
    if (input.housePlanCode && !HOUSE_PLANS.some((plan) => plan.code === input.housePlanCode)) errors['housePlanCode'] = 'ไม่พบแบบบ้านนี้ในคลัง';
    if ((input.housePlanName ?? '').trim().length > 200) errors['housePlanName'] = 'ยาวเกิน 200 ตัวอักษร';
    const brief = input.designBrief ?? {};
    const integers: Array<[keyof ApiSchemas['DesignBrief'], number, number]> = [['floors', 1, 8], ['bedrooms', 0, 20], ['bathrooms', 0, 20], ['parking', 0, 20]];
    for (const [field, min, max] of integers) {
        const value = brief[field];
        if (value !== undefined && value !== null && !(Number.isInteger(value) && (value as number) >= min && (value as number) <= max)) errors[`designBrief.${field}`] = `ต้องเป็นจำนวนเต็ม ${min}–${max}`;
    }
    for (const field of ['usableArea', 'landArea', 'budget'] as const) {
        const value = brief[field];
        if (value !== undefined && value !== null && !(typeof value === 'number' && value >= 0)) errors[`designBrief.${field}`] = 'ต้องเป็นตัวเลขไม่ติดลบ';
    }
    if ((brief.style ?? '').length > 100) errors['designBrief.style'] = 'ยาวเกิน 100 ตัวอักษร';
    if ((brief.rooms ?? []).length > 20 || (brief.rooms ?? []).some((room) => typeof room !== 'string' || room.length > 50)) errors['designBrief.rooms'] = 'ห้องพิเศษไม่เกิน 20 รายการ รายการละไม่เกิน 50 ตัวอักษร';
    const point = readCoordinates(input.siteCoordinates, errors, 'siteCoordinates.');
    failIfInvalid(errors);
    const project = createProject(input as ApiSchemas['ProjectInput']);
    res.status(201).json(point ? setSiteLocation(project.code, point) : project);
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
    const point = readCoordinates(input.siteCoordinates, errors, 'siteCoordinates.');
    failIfInvalid(errors);
    const project = recordContract(code, input);
    res.json(point ? setSiteLocation(code, point) : project);
});

projectRouter.put('/projects/:code/site-location', (req, res) => {
    const code = req.params['code']!;
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์แก้ไขที่ตั้งหน้างาน');
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    const errors: Record<string, string> = {};
    const point = readCoordinates(body<ApiSchemas['SiteLocationInput']>(req) ?? {}, errors);
    failIfInvalid(errors);
    res.json(setSiteLocation(code, point!));
});

projectRouter.delete('/projects/:code/site-location', (req, res) => {
    const code = req.params['code']!;
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์แก้ไขที่ตั้งหน้างาน');
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    res.json(setSiteLocation(code, null));
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
    const input = body<ApiSchemas['ProjectSetupInput']>(req);
    const { options, overrides } = readSetupInput(input);
    const { percents, errors } = normalizePaymentPercents(code, input.paymentPercents);
    failIfInvalid(errors, 'สัดส่วนงวดเงินไม่ถูกต้อง');
    res.json(saveSetup(code, options, overrides, percents, CURRENT_USER.name));
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

// ---------- แบบบ้าน 3 มิติ (แนบได้ตั้งแต่เปิดโครงการ) ----------

const MODEL_SOURCE_APPS: ApiSchemas['ModelSourceApp'][] = ['sketchup', 'revit', 'other'];
const SOURCE_APP_LABEL: Record<ApiSchemas['ModelSourceApp'], string> = { sketchup: 'SketchUp', revit: 'Revit', other: 'โปรแกรมอื่น' };

projectRouter.get('/projects/:code/models', (req, res) => {
    const code = req.params['code']!;
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    res.json(listModels(code));
});

projectRouter.post('/projects/:code/models', (req, res) => {
    const code = req.params['code']!;
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์อัปโหลดแบบ 3 มิติ');
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    const input = body<ApiSchemas['ProjectModelInput']>(req);
    const file = input.fileId ? uploads.get(input.fileId) : undefined;
    const sourceFile = input.sourceFileId ? uploads.get(input.sourceFileId) : undefined;
    const format = file ? (extensionOf(file.name) as ApiSchemas['ModelFormat']) : undefined;
    const title = input.title?.trim();
    const note = input.note?.trim();
    const errors: Record<string, string> = {};
    // ต้องมีอย่างน้อย 1 ไฟล์: ไฟล์ที่แสดงผลได้ หรือไฟล์ต้นฉบับ .skp / .rvt (เก็บไว้ดาวน์โหลด ยังแสดงเป็น 3 มิติไม่ได้)
    if (!input.fileId && !input.sourceFileId) errors['fileId'] = 'กรุณาแนบไฟล์แบบ 3 มิติอย่างน้อย 1 ไฟล์';
    else if (input.fileId && !file) errors['fileId'] = 'ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดใหม่';
    else if (file && !VIEWABLE_MODEL_EXTENSIONS.includes(format!)) errors['fileId'] = 'ไฟล์สำหรับแสดงผลต้องเป็น .glb .gltf .dae .fbx หรือ .obj (ไฟล์ .skp / .rvt / .ifc ให้แนบเป็นไฟล์ต้นฉบับ)';
    if (input.sourceFileId && !sourceFile) errors['sourceFileId'] = 'ไม่พบไฟล์ต้นฉบับที่อัปโหลด กรุณาอัปโหลดใหม่';
    else if (sourceFile && !(SOURCE_MODEL_EXTENSIONS as readonly string[]).includes(extensionOf(sourceFile.name))) errors['sourceFileId'] = 'ไฟล์ต้นฉบับต้องเป็น .skp (SketchUp) .rvt (Revit) หรือ .ifc';
    if (!MODEL_SOURCE_APPS.includes(input.sourceApp!)) errors['sourceApp'] = 'กรุณาเลือกโปรแกรมที่ใช้ออกแบบ';
    if (input.upAxis && input.upAxis !== 'y' && input.upAxis !== 'z') errors['upAxis'] = 'แกนตั้งต้องเป็น y หรือ z';
    if ((title?.length ?? 0) > 120) errors['title'] = 'ชื่อเวอร์ชันยาวเกิน 120 ตัวอักษร';
    if ((note?.length ?? 0) > 500) errors['note'] = 'หมายเหตุยาวเกิน 500 ตัวอักษร';
    failIfInvalid(errors);

    const version = nextVersion(code);
    const model: ApiSchemas['ProjectModel'] = {
        id: `model-${code}-${Date.now()}`,
        version,
        title: title || `แบบ 3D ฉบับที่ ${version}`,
        sourceApp: input.sourceApp!,
        ...(file ? { file, format: format! } : {}),
        ...(sourceFile ? { sourceFile } : {}),
        // glTF / DAE / FBX ระบุแกนตั้งไว้ในไฟล์ (loader จัดการให้) ใช้ upAxis เฉพาะ OBJ
        upAxis: format === 'obj' ? (input.upAxis ?? 'y') : 'y',
        ...(note ? { note } : {}),
        uploadedBy: currentAuthor(),
        uploadedAt: new Date().toISOString()
    };
    addModel(code, model);
    // แนบเฉพาะ .skp: แปลงเป็น .glb ที่หลังบ้าน (เบราว์เซอร์เปิด .skp ไม่ได้)
    if (!file && canConvert(model)) queueConversion(code, model.id);
    recordAudit({ module: 'project', action: 'อัปโหลดแบบ 3 มิติ', target: code, detail: `ฉบับที่ ${version} · ${SOURCE_APP_LABEL[model.sourceApp]} · ${[file?.name, sourceFile && `ต้นฉบับ ${sourceFile.name}`].filter(Boolean).join(' + ')}` });
    res.status(201).json(findModel(code, model.id));
});

// ---------- ข้อมูลแบบบ้าน (ผู้ตั้งค่ากรอกเอง) ----------

const RENDER_VIEWS: ApiSchemas['RenderView'][] = ['front', 'back', 'left', 'right'];
const RENDER_LABEL: Record<ApiSchemas['RenderView'], string> = { front: 'ด้านหน้า', back: 'ด้านหลัง', left: 'ด้านซ้าย', right: 'ด้านขวา' };

projectRouter.get('/projects/:code/house', (req, res) => {
    const code = req.params['code']!;
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    res.json(getHouse(code));
});

projectRouter.put('/projects/:code/house', (req, res) => {
    const code = req.params['code']!;
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์ตั้งค่าแบบบ้าน');
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    const input = body<ApiSchemas['ProjectHouseInput']>(req);
    const errors: Record<string, string> = {};
    const name = input.name?.trim() ?? '';
    const description = input.description?.trim();
    if (!name) errors['name'] = 'กรุณาระบุชื่อแบบบ้าน';
    else if (name.length > 200) errors['name'] = 'ชื่อแบบบ้านยาวเกิน 200 ตัวอักษร';
    if ((description?.length ?? 0) > 2000) errors['description'] = 'คำอธิบายยาวเกิน 2,000 ตัวอักษร';

    // ตัวเลข: ไม่กรอก = ไม่ระบุ
    const numbers: Partial<Record<'usableArea' | 'width' | 'depth' | 'floors' | 'bedrooms' | 'bathrooms' | 'kitchens' | 'parking', number>> = {};
    const limits = { usableArea: [0, 100_000, false], width: [0, 1000, false], depth: [0, 1000, false], floors: [1, 10, true], bedrooms: [0, 50, true], bathrooms: [0, 50, true], kitchens: [0, 20, true], parking: [0, 50, true] } as const;
    for (const [key, [min, max, integer]] of Object.entries(limits) as Array<[keyof typeof limits, readonly [number, number, boolean]]>) {
        const value = input[key];
        if (value === undefined || value === null) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) errors[key] = `ต้องเป็น${integer ? 'จำนวนเต็ม' : 'ตัวเลข'} ${min}–${max.toLocaleString('th-TH')}`;
        else numbers[key] = value;
    }

    const image = (fileId: string | undefined, key: string) => {
        const file = fileId ? uploads.get(fileId) : undefined;
        if (!file) errors[key] = 'ไม่พบไฟล์รูป กรุณาอัปโหลดใหม่';
        else if (!isImage(file)) errors[key] = 'ต้องเป็นไฟล์รูป JPG, PNG หรือ WebP';
        return file;
    };
    const plans = input.floorPlans ?? [];
    if (plans.length > 10) errors['floorPlans'] = 'แปลนได้ไม่เกิน 10 ชั้น';
    const floorPlans = plans.slice(0, 10).map((plan, index) => {
        const label = plan.label?.trim() ?? '';
        if (!label) errors[`floorPlans.${index}.label`] = 'กรุณาตั้งชื่อชั้น';
        else if (label.length > 60) errors[`floorPlans.${index}.label`] = 'ชื่อชั้นยาวเกิน 60 ตัวอักษร';
        return { label, image: image(plan.fileId, `floorPlans.${index}`)! };
    });
    const renders: ApiSchemas['ProjectHouse']['renders'] = {};
    for (const view of RENDER_VIEWS) {
        const fileId = input.renders?.[view];
        if (fileId) renders[view] = image(fileId, `renders.${view}`)!;
    }
    failIfInvalid(errors);

    const isNew = !getHouse(code).configured;
    const house = saveHouse(code, { name, ...(description ? { description } : {}), ...numbers, floorPlans, renders, updatedBy: currentAuthor(), updatedAt: new Date().toISOString() });
    const views = RENDER_VIEWS.filter((view) => renders[view]).map((view) => RENDER_LABEL[view]);
    recordAudit({ module: 'project', action: isNew ? 'ตั้งค่าแบบบ้าน' : 'แก้ไขข้อมูลแบบบ้าน', target: code, detail: `${name} · แปลน ${floorPlans.length} ชั้น · ทัศนียภาพ ${views.length ? views.join(' ') : 'ไม่มี'}` });
    res.json(house);
});

projectRouter.post('/projects/:code/models/:id/convert', (req, res) => {
    const code = req.params['code']!;
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์แปลงแบบ 3 มิติ');
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    const model = findModel(code, req.params['id']!);
    if (!model) fail(404, 'ไม่พบแบบ 3 มิติเวอร์ชันนี้');
    if (!canConvert(model)) fail(409, 'เวอร์ชันนี้แปลงไม่ได้', 'แปลงได้เฉพาะเวอร์ชันที่แนบไฟล์ต้นฉบับ .skp หรือ .ifc');
    if (model.conversion?.status === 'queued' || model.conversion?.status === 'converting') fail(409, 'กำลังแปลงไฟล์อยู่');
    queueConversion(code, model.id);
    recordAudit({ module: 'project', action: 'สั่งแปลงแบบ 3 มิติ', target: code, detail: `ฉบับที่ ${model.version} · ${model.sourceFile!.name}` });
    res.status(202).json(findModel(code, model.id));
});

projectRouter.delete('/projects/:code/models/:id', (req, res) => {
    const code = req.params['code']!;
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์ลบแบบ 3 มิติ');
    if (!findProject(code)) fail(404, 'ไม่พบโครงการ');
    const removed = removeModel(code, req.params['id']!, currentAuthor());
    if (!removed) fail(404, 'ไม่พบแบบ 3 มิติเวอร์ชันนี้');
    recordAudit({ module: 'project', action: 'ลบแบบ 3 มิติ', target: code, detail: `ฉบับที่ ${removed.version} · ${removed.title} · ${(removed.file ?? removed.sourceFile)?.name ?? ""}` });
    res.status(204).end();
});

const PAYMENT_METHODS: ApiSchemas['PaymentMethod'][] = ['transfer', 'cheque', 'cash'];
const MAX_EVIDENCE = 10;
const money = (value: number) => `฿${value.toLocaleString('th-TH')}`;

/** งวดตามเลขงวดใน path (404 ถ้าไม่มี) */
function requireInstallment(code: string, no: string): ApiSchemas['Installment'] {
    const installment = apiInstallments(code)!.find((item) => String(item.no) === no);
    if (!installment) fail(404, 'ไม่พบงวดนี้');
    return installment;
}

projectRouter.post('/projects/:code/installments/:no/payment', (req, res) => {
    const code = req.params['code']!;
    if (!can('payment.record')) fail(403, 'ไม่มีสิทธิ์บันทึกรับชำระเงิน');
    requirePlan(code);
    const installment = requireInstallment(code, req.params['no']!);
    if (installment.payment) fail(409, 'งวดนี้บันทึกรับชำระแล้ว', 'ถ้าบันทึกผิด ให้ยกเลิกการรับชำระเดิมก่อน');
    if (installment.amount <= 0) fail(409, 'งวดงานลดไม่ต้องรับชำระ', 'ยอดงานลดหักจากงวดอื่นของสัญญา');

    const input = body<ApiSchemas['InstallmentPaymentInput']>(req);
    const project = findContracted(code)!;
    const withholdingTax = input.withholdingTax ?? 0;
    const note = input.note?.trim();
    const reference = input.reference?.trim();
    const evidenceIds = [...new Set(input.evidenceIds ?? [])];
    const errors: Record<string, string> = {};
    if (!DATE.test(input.paidDate ?? '')) errors['paidDate'] = 'กรุณาระบุวันที่ได้รับเงิน';
    else if (input.paidDate! > todayIso()) errors['paidDate'] = 'วันที่ได้รับเงินต้องไม่เกินวันนี้';
    else if (input.paidDate! < project.contractSignedAt) errors['paidDate'] = 'วันที่ได้รับเงินต้องไม่ก่อนวันเซ็นสัญญา';
    if (!PAYMENT_METHODS.includes(input.method!)) errors['method'] = 'กรุณาเลือกวิธีชำระ';
    if (!(typeof input.amount === 'number' && input.amount > 0)) errors['amount'] = 'ยอดที่ได้รับต้องมากกว่า 0';
    if (!(typeof withholdingTax === 'number' && withholdingTax >= 0)) errors['withholdingTax'] = 'ภาษีหัก ณ ที่จ่ายต้องไม่ติดลบ';
    if (!errors['amount'] && !errors['withholdingTax']) {
        const total = Math.round((input.amount! + withholdingTax) * 100) / 100;
        if (total > installment.amount) errors['amount'] = `ยอดรับรวมภาษีหัก ณ ที่จ่าย (${money(total)}) เกินยอดงวด ${money(installment.amount)}`;
        else if (total < installment.amount && !note) errors['note'] = `ยอดรับน้อยกว่ายอดงวด ${money(installment.amount - total)} กรุณาระบุเหตุผล`;
    }
    if ((reference?.length ?? 0) > 100) errors['reference'] = 'เลขที่อ้างอิงยาวเกิน 100 ตัวอักษร';
    if ((note?.length ?? 0) > 500) errors['note'] = 'หมายเหตุยาวเกิน 500 ตัวอักษร';
    if (!evidenceIds.length) errors['evidenceIds'] = 'กรุณาแนบหลักฐานการชำระอย่างน้อย 1 ไฟล์ เช่น สลิปโอนเงิน สำเนาเช็ค';
    else if (evidenceIds.length > MAX_EVIDENCE) errors['evidenceIds'] = `แนบหลักฐานได้ไม่เกิน ${MAX_EVIDENCE} ไฟล์`;
    else if (evidenceIds.some((id) => !uploads.has(id))) errors['evidenceIds'] = 'ไม่พบไฟล์หลักฐานที่อัปโหลด กรุณาอัปโหลดใหม่';
    failIfInvalid(errors);

    addPayment(code, {
        id: `pay-${code}-${installment.no}-${Date.now()}`,
        key: installmentKey(installment),
        installmentNo: installment.no,
        paidDate: input.paidDate!,
        amount: input.amount!,
        withholdingTax,
        method: input.method!,
        ...(reference ? { reference } : {}),
        ...(note ? { note } : {}),
        evidence: evidenceIds.map((id) => uploads.get(id)!),
        recordedBy: currentAuthor(),
        recordedAt: new Date().toISOString()
    });
    recordAudit({
        module: 'finance',
        action: 'บันทึกรับชำระงวดงาน',
        target: `${code} งวดที่ ${installment.no}`,
        detail: `${money(input.amount!)}${withholdingTax ? ` · หัก ณ ที่จ่าย ${money(withholdingTax)}` : ''} · ได้รับ ${input.paidDate}${reference ? ` · อ้างอิง ${reference}` : ''} · หลักฐาน ${evidenceIds.length} ไฟล์`
    });
    res.status(201).json(requireInstallment(code, String(installment.no)));
});

projectRouter.post('/projects/:code/installments/:no/payment/cancel', (req, res) => {
    const code = req.params['code']!;
    if (!can('payment.record')) fail(403, 'ไม่มีสิทธิ์ยกเลิกการรับชำระเงิน');
    requirePlan(code);
    const installment = requireInstallment(code, req.params['no']!);
    if (!installment.payment) fail(409, 'งวดนี้ยังไม่ได้บันทึกรับชำระ');
    const reason = body<{ reason: string }>(req).reason?.trim();
    if (!reason) failIfInvalid({ reason: 'กรุณาระบุเหตุผลที่ยกเลิก' });
    if (reason!.length > 500) failIfInvalid({ reason: 'เหตุผลยาวเกิน 500 ตัวอักษร' });

    cancelPayment(code, installmentKey(installment), currentAuthor(), reason!);
    recordAudit({ module: 'finance', action: 'ยกเลิกการรับชำระงวดงาน', target: `${code} งวดที่ ${installment.no}`, detail: `${money(installment.payment!.amount)} ได้รับ ${installment.payment!.paidDate} · เหตุผล: ${reason}` });
    res.json(requireInstallment(code, String(installment.no)));
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
    // วันที่จริงจากบันทึกหน้างาน/ผลตรวจ: งานที่ยังไม่เคยอัปเดตไม่มีวันที่
    const dates = new Map<string, { first: string; last: string }>();
    for (const update of getUpdates(code)) {
        for (const change of update.taskChanges) {
            const current = dates.get(change.taskCode);
            dates.set(change.taskCode, {
                first: current && current.first < update.reportDate ? current.first : update.reportDate,
                last: current && current.last > update.reportDate ? current.last : update.reportDate
            });
        }
    }
    const timeline = getTimeline(code)!;
    res.json({
        ...timeline,
        phases: timeline.phases.map((phase) => ({
            ...phase,
            tasks: phase.tasks.map((task) => {
                const known = dates.get(task.code);
                return known ? { ...task, startedOn: known.first, lastUpdatedOn: known.last } : task;
            })
        }))
    });
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
