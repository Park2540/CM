import { Router } from 'express';
import type { ApiSchemas } from '../api/api.js';
import { join } from 'node:path';
import { config } from '../config.js';
import { ConversionError, convertKindOf, runIfcTakeoff } from '../convert/skp-converter.js';
import { buildEstimateFromTakeoff } from '../domain/estimate-from-ifc.js';
import { createEstimate, createEstimateFromModel, deleteEstimate, estimateRates, findStoredEstimate, getEstimate, listEstimates, markMaterialsApplied, saveEstimate } from '../domain/estimates.js';
import { estimateFileName, estimateWorkbook } from '../domain/estimate-xlsx.js';
import { copyStatement, resetStatementTemplate, saveStatementTemplate } from '../domain/overhead-statement.js';
import { companyProfile, saveBoq } from '../domain/materials.js';
import { findModel } from '../domain/project-models.js';
import { currentProject, findProject, getTimeline } from '../domain/projects.js';
import { recordAudit } from '../domain/audit-logs.js';
import { body, can, fail } from '../http/respond.js';

/** ถอดปริมาณและ BOQ (/estimates, /estimate-rates) */
export const estimatesRouter = Router();

const requireManage = () => {
    if (!can('estimate.manage')) fail(403, 'ไม่มีสิทธิ์จัดทำ BOQ');
};

/** ผลจาก domain → JSON หรือ Problem */
function send<T>(res: import('express').Response, result: { ok: T } | { status: number; title: string; detail?: string; errors?: Record<string, string> }, status = 200) {
    if ('ok' in result) {
        res.status(status).json(result.ok);
        return;
    }
    fail(result.status as 403, result.title, result.detail, result.errors);
}

estimatesRouter.get('/estimates', (_req, res) => {
    res.json(listEstimates());
});

estimatesRouter.post('/estimates', (req, res) => {
    requireManage();
    const input = body<ApiSchemas['EstimateCreateInput']>(req);
    const project = input.projectCode ? findProject(input.projectCode) : undefined;
    if (input.projectCode && !project) fail(404, 'ไม่พบโครงการ');
    send(res, createEstimate(input, project), 201);
});

/** ถอด BOQ จากโมเดล IFC ของโครงการ (ไฟล์ต้นฉบับ .ifc ของเวอร์ชันแบบ 3 มิติ) */
estimatesRouter.post('/estimates/from-model', async (req, res) => {
    requireManage();
    const input = body<ApiSchemas['EstimateFromModelInput']>(req);
    const project = input.projectCode ? currentProject(input.projectCode) : undefined;
    if (!project) fail(404, 'ไม่พบโครงการ');
    const model = findModel(project!.code, String(input.modelId ?? ''));
    if (!model) fail(404, 'ไม่พบแบบ 3 มิติเวอร์ชันนี้');
    if (!model!.sourceFile || convertKindOf(model!.sourceFile.name) !== 'ifc') fail(409, 'เวอร์ชันนี้ไม่มีไฟล์ IFC', 'ส่งออกจาก Revit เป็น IFC แล้วแนบเป็นไฟล์ต้นฉบับของแบบ 3 มิติ');
    const grade = Number(input.concreteGrade ?? 210);
    if (!(grade >= 100 && grade <= 600)) fail(422, 'ข้อมูลไม่ถูกต้อง', 'กำลังอัดคอนกรีตต้องอยู่ระหว่าง 100-600 ksc', { concreteGrade: 'กำลังอัดคอนกรีตต้องอยู่ระหว่าง 100-600 ksc' });
    let takeoff;
    try {
        takeoff = await runIfcTakeoff(join(config.uploadDir, model!.sourceFile!.id));
    } catch (error) {
        fail(422, 'อ่านไฟล์ IFC ไม่สำเร็จ', error instanceof ConversionError ? error.message : String(error));
    }
    const built = buildEstimateFromTakeoff(takeoff!, estimateRates(), { concreteGrade: grade });
    const estimate = createEstimateFromModel({
        title: String(input.title ?? '').trim().slice(0, 200) || `${project!.name} (ถอดจากโมเดล v${model!.version})`,
        project: project!,
        categories: built.categories,
        source: {
            kind: 'ifc',
            projectCode: project!.code,
            modelId: model!.id,
            modelTitle: model!.title,
            fileName: model!.sourceFile!.name,
            application: takeoff!.application,
            schema: takeoff!.schema,
            analyzedAt: new Date().toISOString(),
            elements: takeoff!.elements,
            seconds: takeoff!.seconds,
            warnings: built.warnings,
            materials: built.materials,
            components: built.components
        }
    });
    res.status(201).json(estimate);
});

/** รายการวัสดุจาก BOQ ที่ถอดจากโมเดล → BOQ วัสดุของโครงการ (ใช้เทียบการใช้วัสดุจริงในแท็บจัดซื้อ) */
estimatesRouter.post('/estimates/:id/apply-materials', (req, res) => {
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์แก้ไข BOQ วัสดุของโครงการ');
    const estimate = findStoredEstimate(req.params['id']!);
    if (!estimate) fail(404, 'ไม่พบ BOQ');
    if (!estimate!.source?.materials.length || !estimate!.projectCode) fail(409, 'BOQ นี้ไม่มีรายการวัสดุจากโมเดล หรือไม่ได้ผูกโครงการ');
    const code = estimate!.projectCode!;
    const result = saveBoq(code, { items: estimate!.source!.materials.map((material) => ({ ...(material.materialCode ? { materialCode: material.materialCode } : {}), name: material.name, unit: material.unit, quantity: material.quantity, note: material.basis.slice(0, 300) })) }, getTimeline(code)?.phases.map((phase) => phase.code) ?? []);
    if (!('ok' in result)) fail(result.status, result.title, result.detail, result.errors);
    markMaterialsApplied(estimate!.id);
    recordAudit({ module: 'procurement', action: 'ส่งรายการวัสดุจาก BOQ เข้าโครงการ', target: code, detail: `${estimate!.id} · ${estimate!.source!.materials.length} รายการ` });
    res.json((result as { ok: ApiSchemas['ProjectBoq'] }).ok);
});

estimatesRouter.get('/estimates/:id', (req, res) => {
    const estimate = getEstimate(req.params['id']!);
    if (!estimate) fail(404, 'ไม่พบ BOQ');
    res.json(estimate);
});

estimatesRouter.get('/estimates/:id/export', async (req, res) => {
    const estimate = getEstimate(req.params['id']!);
    if (!estimate) fail(404, 'ไม่พบ BOQ');
    const file = await estimateWorkbook(estimate!, { company: companyProfile.name });
    recordAudit({ module: 'project', action: 'ส่งออก BOQ เป็น Excel', target: estimate!.id, detail: estimate!.title });
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .setHeader('Content-Disposition', `attachment; filename="BOQ-${estimate!.id}.xlsx"; filename*=UTF-8''${encodeURIComponent(estimateFileName(estimate!))}`)
        .send(file);
});

estimatesRouter.put('/estimates/:id', (req, res) => {
    requireManage();
    send(res, saveEstimate(req.params['id']!, body<ApiSchemas['EstimateInput']>(req), (code) => !!findProject(code)));
});

estimatesRouter.delete('/estimates/:id', (req, res) => {
    requireManage();
    const result = deleteEstimate(req.params['id']!);
    if (!('ok' in result)) fail(result.status, result.title);
    res.status(204).end();
});

estimatesRouter.get('/estimate-rates', (_req, res) => {
    res.json(estimateRates());
});

// ---------- แม่แบบเอกสารชี้แจงค่าดำเนินการ (แนบท้าย BOQ) ----------

estimatesRouter.get('/settings/overhead-statement', (_req, res) => {
    res.json(copyStatement());
});

estimatesRouter.put('/settings/overhead-statement', (req, res) => {
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์แก้ไขแม่แบบเอกสารชี้แจงค่าดำเนินการ');
    const result = saveStatementTemplate(req.body);
    if ('error' in result) fail(422, 'ข้อมูลไม่ถูกต้อง', result.error, { title: result.error });
    recordAudit({ module: 'project', action: 'แก้ไขแม่แบบเอกสารชี้แจงค่าดำเนินการ', target: 'แม่แบบบริษัท', detail: `${(result as { ok: { sections: unknown[] } }).ok.sections.length} หัวข้อ` });
    res.json((result as { ok: unknown }).ok);
});

estimatesRouter.delete('/settings/overhead-statement', (_req, res) => {
    if (!can('project.manage')) fail(403, 'ไม่มีสิทธิ์แก้ไขแม่แบบเอกสารชี้แจงค่าดำเนินการ');
    const statement = resetStatementTemplate();
    recordAudit({ module: 'project', action: 'คืนค่าแม่แบบเอกสารชี้แจงค่าดำเนินการ', target: 'แม่แบบบริษัท' });
    res.json(statement);
});
