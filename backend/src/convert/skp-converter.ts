/** คิวแปลงแบบ 3 มิติ (.skp ผ่าน SketchUpAPI.dll บนเครื่อง, .ifc ผ่าน web-ifc) ทีละไฟล์ใน worker thread */
import { existsSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { config } from '../config.js';
import type { IfcTakeoffResult } from './ifc-takeoff.js';


export class ConversionError extends Error {
    constructor(
        message: string,
        readonly code?: number
    ) {
        super(message);
    }
}

let detected: string | null | undefined;

/**
 * โฟลเดอร์ที่มี SketchUpAPI.dll — ตั้งเองได้ที่ SKETCHUP_API_DIR (เช่น SketchUp C API SDK)
 * ไม่ตั้ง: หา SketchUp ที่ติดตั้งใน C:\Program Files\SketchUp (เลือกรุ่นใหม่สุด) | null = แปลงไม่ได้
 */
export function sketchupApiDir(): string | null {
    if (detected !== undefined) return detected;
    const candidates: string[] = [];
    if (config.sketchupApiDir) candidates.push(config.sketchupApiDir);
    else if (process.platform === 'win32') {
        const base = join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'SketchUp');
        const versions = existsSync(base) ? readdirSync(base).sort().reverse() : [];
        for (const version of versions) candidates.push(join(base, version), join(base, version, 'SketchUp'));
    }
    detected = candidates.find((dir) => existsSync(join(dir, 'SketchUpAPI.dll'))) ?? null;
    // ให้ Windows หา DLL ที่ SketchUpAPI.dll ใช้ร่วม (worker เปลี่ยนโฟลเดอร์ทำงานเองไม่ได้ จึงตั้งที่ thread หลัก)
    if (detected && process.platform === 'win32') process.env['PATH'] = `${detected}${delimiter}${process.env['PATH'] ?? ''}`;
    return detected;
}

let queue: Promise<unknown> = Promise.resolve();

/** ชนิดไฟล์ต้นฉบับที่แปลงเป็น 3 มิติได้ */
export type ConvertKind = 'skp' | 'ifc';
export const convertKindOf = (fileName: string): ConvertKind | null => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    return extension === 'skp' || extension === 'ifc' ? extension : null;
};

/** สรุปผลการแปลง (เก็บไว้แสดงในหน้าแบบบ้าน) */
export interface ConversionSummary {
    triangles: number;
}

/** แปลงทีละไฟล์ (ไฟล์ใหญ่ใช้หน่วยความจำมาก) — .skp ต้องมี SketchUp บนเครื่อง ส่วน .ifc ใช้ web-ifc ได้ทุกเครื่อง */
export function convertModel(kind: ConvertKind, input: string, output: string, elementsOutput?: string): Promise<ConversionSummary> {
    const job = queue.then(() => runWorker(kind, input, output, elementsOutput));
    queue = job.catch(() => undefined);
    return job;
}

/** ถอดปริมาณจากไฟล์ IFC (คิวเดียวกับการแปลง เพราะใช้หน่วยความจำมากเหมือนกัน) */
export function runIfcTakeoff(input: string): Promise<IfcTakeoffResult> {
    const job = queue.then(() => runWorker('takeoff', input, '') as unknown as Promise<IfcTakeoffResult>);
    queue = job.catch(() => undefined);
    return job;
}

function runWorker(kind: ConvertKind | 'takeoff', input: string, output: string, elementsOutput?: string): Promise<ConversionSummary> {
    const apiDir = kind === 'skp' ? sketchupApiDir() : '';
    if (kind === 'skp' && !apiDir) return Promise.reject(new ConversionError('เซิร์ฟเวอร์ไม่มี SketchUp สำหรับแปลงไฟล์'));
    // ตอนพัฒนารันผ่าน tsx (ไฟล์ .ts) — worker ใช้ execArgv เดียวกับ process หลักจึงโหลด .ts ได้
    const script = new URL(import.meta.url.endsWith('.ts') ? './skp-worker.ts' : './skp-worker.js', import.meta.url);
    return new Promise((resolve, reject) => {
        const worker = new Worker(script, { workerData: { kind, apiDir, input, output, elementsOutput }, resourceLimits: { maxOldGenerationSizeMb: 8192 } });
        let settled = false;
        worker.once('message', (message: { ok: true; result: ConversionSummary } | { ok: false; message: string; code?: number }) => {
            settled = true;
            if (message.ok) resolve(message.result);
            else reject(new ConversionError(message.message, message.code));
        });
        worker.once('error', (error) => {
            settled = true;
            reject(new ConversionError(error.message));
        });
        worker.once('exit', (code) => {
            if (!settled) reject(new ConversionError(`ตัวแปลงหยุดทำงาน (exit ${code}) ไฟล์อาจใหญ่เกินหน่วยความจำ`));
        });
    });
}
