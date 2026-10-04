/** แบบบ้าน 3 มิติของโครงการ (SketchUp / Revit ส่งออกเป็นรูปแบบที่เบราว์เซอร์แสดงได้ พร้อมไฟล์ต้นฉบับ) เก็บทุกเวอร์ชัน */
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { persistMap, saveState } from '../db/state.js';
import type { ApiSchemas } from '../api/api.js';
import { config } from '../config.js';
import { ConversionError, convertKindOf, convertModel, sketchupApiDir } from '../convert/skp-converter.js';
import { SU_ERROR_MODEL_VERSION } from '../convert/skp-to-glb.js';
import { uploads } from './projects.js';

type ProjectModel = ApiSchemas['ProjectModel'];
/** เวอร์ชันที่ลบแล้วยังเก็บไว้ (ไม่แสดง) เพื่อไม่ให้เลขเวอร์ชันซ้ำและย้อนดูได้ */
type StoredModel = ProjectModel & { deletedAt?: string; deletedBy?: ApiSchemas['UserRef'] };

/** รหัสโครงการ → เวอร์ชันทั้งหมด (เก่าไปใหม่) */
const models = new Map<string, StoredModel[]>();

/** ล่าสุดก่อน (เวอร์ชันแรกของรายการ = แบบที่ใช้อยู่) */
export function listModels(code: string): ProjectModel[] {
    return (models.get(code) ?? [])
        .filter((model) => !model.deletedAt)
        .map(({ deletedAt: _at, deletedBy: _by, ...model }) => model)
        .reverse();
}

export function findModel(code: string, id: string): ProjectModel | undefined {
    return listModels(code).find((model) => model.id === id);
}

/** เลขเวอร์ชันถัดไป (นับรวมเวอร์ชันที่ลบแล้ว เลขจึงไม่ซ้ำ) */
export function nextVersion(code: string): number {
    return (models.get(code) ?? []).length + 1;
}

export function addModel(code: string, model: ProjectModel) {
    if (!models.has(code)) models.set(code, []);
    models.get(code)!.push(model);
}

export function removeModel(code: string, id: string, by: ApiSchemas['UserRef']): ProjectModel | undefined {
    const model = stored(code, id);
    if (model) Object.assign(model, { deletedAt: new Date().toISOString(), deletedBy: by });
    return model;
}

const stored = (code: string, id: string) => (models.get(code) ?? []).find((item) => item.id === id && !item.deletedAt);

// ---------- แปลงไฟล์ต้นฉบับ (.skp / .ifc) เป็น .glb ----------

/** เวอร์ชันที่มีไฟล์ต้นฉบับ .skp / .ifc แต่ไม่มีไฟล์แสดงผลที่ผู้ใช้อัปโหลด แปลงเป็น 3 มิติได้ */
export const canConvert = (model: ProjectModel) => !!model.sourceFile && !!convertKindOf(model.sourceFile.name) && (!model.file || model.conversion?.status === 'done');

/** เข้าคิวแปลง (สถานะ queued → converting → done / failed) แล้วบันทึกผลลงฐานข้อมูล */
export function queueConversion(code: string, id: string) {
    const model = stored(code, id);
    if (!model?.sourceFile) return;
    const kind = convertKindOf(model.sourceFile.name);
    if (!kind) return;
    if (kind === 'skp' && !sketchupApiDir()) {
        model.conversion = { status: 'unavailable', message: 'เซิร์ฟเวอร์ไม่มี SketchUp สำหรับแปลงไฟล์ .skp — ส่งออกเป็น .glb จาก SketchUp แล้วอัปโหลดเวอร์ชันใหม่' };
        return;
    }
    // แปลงได้ซ้ำเฉพาะเวอร์ชันที่ไฟล์แสดงผลมาจากการแปลงครั้งก่อน (canConvert) จึงลบไฟล์เดิมได้เมื่อแปลงใหม่สำเร็จ
    const previous = model.conversion?.status === 'done' ? [model.file, model.elements] : [];
    model.conversion = { status: 'queued' };
    const source = model.sourceFile;
    const fileId = `file-${randomUUID()}`;
    const output = join(config.uploadDir, fileId);
    // ข้อมูลชิ้นงาน (เฉพาะ IFC) เป็นอีกไฟล์ โหลดเมื่อผู้ใช้คลิกชิ้นงาน
    const elementsId = `file-${randomUUID()}`;
    const elementsOutput = join(config.uploadDir, elementsId);
    void (async () => {
        const current = () => stored(code, id);
        try {
            const started = current();
            if (!started) return; // ลบไปก่อนถึงคิว
            started.conversion = { status: 'converting' };
            const result = await convertModel(kind, join(config.uploadDir, source.id), output, kind === 'ifc' ? elementsOutput : undefined);
            const done = current();
            if (!done) return;
            const file: ApiSchemas['UploadedFile'] = {
                id: fileId,
                url: `/api/files/${fileId}`,
                name: source.name.replace(/\.(skp|ifc)$/i, '.glb'),
                sizeKb: Math.ceil(statSync(output).size / 1024),
                contentType: 'model/gltf-binary'
            };
            uploads.set(fileId, file);
            let elements: ApiSchemas['UploadedFile'] | undefined;
            if (kind === 'ifc' && existsSync(elementsOutput)) {
                elements = { id: elementsId, url: `/api/files/${elementsId}`, name: source.name.replace(/\.ifc$/i, '.elements.json'), sizeKb: Math.ceil(statSync(elementsOutput).size / 1024), contentType: 'application/json' };
                uploads.set(elementsId, elements);
            }
            Object.assign(done, { file, format: 'glb', upAxis: 'y', conversion: { status: 'done', triangles: result.triangles, finishedAt: new Date().toISOString() } });
            if (elements) done.elements = elements;
            else delete done.elements;
            // แปลงซ้ำ: ลบไฟล์ที่แปลงไว้ครั้งก่อน
            for (const old of previous) {
                if (!old) continue;
                uploads.delete(old.id);
                for (const path of [join(config.uploadDir, old.id), join(config.uploadDir, `${old.id}.gz`)]) rmSync(path, { force: true });
            }
        } catch (error) {
            const failed = current();
            if (failed) failed.conversion = { status: 'failed', message: conversionMessage(error), finishedAt: new Date().toISOString() };
        } finally {
            await saveState().catch((error) => console.error('บันทึกผลการแปลงแบบ 3 มิติไม่สำเร็จ', error));
        }
    })();
}

function conversionMessage(error: unknown): string {
    if (error instanceof ConversionError && error.code === SU_ERROR_MODEL_VERSION) return 'ไฟล์บันทึกจาก SketchUp รุ่นที่ใหม่กว่าตัวแปลงบนเซิร์ฟเวอร์ — Save As เป็นรุ่นเก่าลง หรือส่งออกเป็น .glb แล้วอัปโหลดเวอร์ชันใหม่';
    return `แปลงไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`;
}

/** หลังเริ่มเซิร์ฟเวอร์: แปลงต่อจากที่ค้าง และแปลงเวอร์ชันเดิมที่มีเฉพาะไฟล์ต้นฉบับ (อัปโหลดก่อนมีตัวแปลง) */
export function resumeConversions() {
    for (const [code, list] of models)
        for (const model of list) {
            if (model.deletedAt || !canConvert(model) || model.file) continue;
            const status = model.conversion?.status;
            if (!status || status === 'queued' || status === 'converting' || (status === 'unavailable' && sketchupApiDir())) queueConversion(code, model.id);
        }
}

persistMap('project_models', models);
