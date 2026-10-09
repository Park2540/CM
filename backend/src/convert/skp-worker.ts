/** worker thread: แปลงแบบ 3 มิติ 1 ไฟล์ (.skp หรือ .ifc) เป็น .glb แล้วส่งผลกลับ (แยกจาก thread หลักเพื่อไม่ให้ API ค้างระหว่างแปลง) */
import { readFileSync, writeFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { gzipSync } from 'node:zlib';
import { convertIfcToGlb } from './ifc-to-glb.js';
import { takeoffIfc } from './ifc-takeoff.js';
import { convertSkpToGlb } from './skp-to-glb.js';

const { kind, apiDir, input, output, elementsOutput } = workerData as { kind: 'skp' | 'ifc' | 'takeoff'; apiDir: string; input: string; output: string; elementsOutput?: string };
try {
    // ถอดปริมาณจาก IFC: ส่งผลกลับอย่างเดียว ไม่เขียนไฟล์
    if (kind === 'takeoff') {
        parentPort!.postMessage({ ok: true, result: await takeoffIfc(input) });
        process.exit(0);
    }
    const result = kind === 'ifc' ? await convertIfcToGlb(input, output, elementsOutput) : convertSkpToGlb(apiDir, input, output);
    // ไฟล์บีบอัดคู่กัน: /files/:id ส่งตัวนี้ให้เบราว์เซอร์ที่รับ gzip (ลดขนาดดาวน์โหลดราว 3-4 เท่า)
    writeFileSync(`${output}.gz`, gzipSync(readFileSync(output), { level: 6 }));
    if (elementsOutput) writeFileSync(`${elementsOutput}.gz`, gzipSync(readFileSync(elementsOutput), { level: 6 }));
    parentPort!.postMessage({ ok: true, result });
} catch (error) {
    parentPort!.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error), code: (error as { code?: number }).code });
}
