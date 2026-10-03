import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import type { ApiSchemas } from '../api/api.js';
import { config } from '../config.js';
import { samplePdf } from '../domain/project-records.js';
import { uploads } from '../domain/projects.js';
import { fail } from '../http/respond.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** แบบ 3 มิติไฟล์ใหญ่กว่าเอกสารทั่วไป */
const MAX_MODEL_BYTES = 200 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const isImage = (file: ApiSchemas['UploadedFile']) => IMAGE_TYPES.includes(file.contentType);
const DOCUMENT_EXTENSIONS = ['pdf', 'xlsx', 'xls', 'docx', 'doc', 'dwg'];
/** แบบ 3 มิติที่เบราว์เซอร์แสดงผลได้ */
export const VIEWABLE_MODEL_EXTENSIONS = ['glb', 'gltf', 'dae', 'fbx', 'obj'] as const;
/** ไฟล์ต้นฉบับ SketchUp / Revit / IFC (เก็บไว้ดาวน์โหลด หลังบ้านแปลง .skp และ .ifc เป็น 3 มิติ — .rvt ยังแปลงไม่ได้) */
export const SOURCE_MODEL_EXTENSIONS = ['skp', 'rvt', 'ifc'] as const;
const MODEL_EXTENSIONS: readonly string[] = [...VIEWABLE_MODEL_EXTENSIONS, ...SOURCE_MODEL_EXTENSIONS];
const MODEL_CONTENT_TYPE: Record<string, string> = { glb: 'model/gltf-binary', gltf: 'model/gltf+json', dae: 'model/vnd.collada+xml', obj: 'model/obj' };
export const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

/** ไฟล์เก็บใน DATA_DIR/uploads ชื่อไฟล์เป็นรหัสสุ่ม (เดาไม่ได้) */
const upload = multer({
    storage: multer.diskStorage({
        destination: config.uploadDir,
        filename: (_req, _file, done) => done(null, `file-${randomUUID()}`)
    }),
    // จำกัดตามไฟล์ที่ใหญ่ที่สุด (แบบ 3 มิติ) แล้วตรวจขนาดตามชนิดไฟล์อีกครั้งหลังรับไฟล์
    limits: { fileSize: MAX_MODEL_BYTES, files: 1 }
});

/** POST /uploads (ต้องล็อกอิน) */
export const uploadRouter = Router();

uploadRouter.post('/uploads', (req, res, next) => {
    upload.single('file')(req, res, async (error: unknown) => {
        try {
            if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') fail(413, 'ไฟล์ใหญ่เกิน 200 MB');
            if (error) throw error;
            const file = req.file;
            if (!file) fail(422, 'ไม่พบไฟล์');
            // multer อ่านชื่อไฟล์เป็น latin1 แปลงกลับเป็น UTF-8 ให้ชื่อไฟล์ภาษาไทยถูกต้อง
            const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
            const extension = extensionOf(name);
            const isModel = MODEL_EXTENSIONS.includes(extension);
            if (!IMAGE_TYPES.includes(file.mimetype) && !DOCUMENT_EXTENSIONS.includes(extension) && !isModel) {
                await unlink(file.path);
                fail(422, 'รองรับรูป JPG, PNG, WebP เอกสาร PDF, Excel, Word, DWG และแบบ 3 มิติ GLB, glTF, DAE, FBX, OBJ, SKP, RVT, IFC');
            }
            if (!isModel && file.size > MAX_UPLOAD_BYTES) {
                await unlink(file.path);
                fail(413, 'ไฟล์ใหญ่เกิน 10 MB');
            }
            const contentType = isModel ? (MODEL_CONTENT_TYPE[extension] ?? 'application/octet-stream') : file.mimetype;
            const uploaded: ApiSchemas['UploadedFile'] = { id: file.filename, url: `/api/files/${file.filename}`, name, sizeKb: Math.ceil(file.size / 1024), contentType };
            uploads.set(uploaded.id, uploaded);
            res.status(201).json(uploaded);
        } catch (caught) {
            next(caught);
        }
    });
});

/**
 * GET /files/:id — เปิดได้โดยไม่ต้องแนบ token เพราะใช้ใน <img> และลิงก์ดาวน์โหลด
 * (รหัสไฟล์เป็น UUID สุ่ม หลังบ้านจริงควรเปลี่ยนเป็น signed URL ที่หมดอายุได้)
 */
export const fileRouter = Router();

fileRouter.get('/files/sample.pdf', (_req, res) => {
    res.type('application/pdf').setHeader('Content-Disposition', 'inline; filename="sample.pdf"');
    res.send(samplePdf());
});

fileRouter.get('/files/:id', (req, res) => {
    const meta = uploads.get(req.params['id']!);
    const path = join(config.uploadDir, req.params['id']!);
    if (!meta || !/^file-[0-9a-f-]+$/.test(req.params['id']!) || !existsSync(path)) fail(404, 'ไม่พบไฟล์');
    res.type(meta.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${isImage(meta) || meta.contentType === 'application/pdf' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(meta.name)}`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    // ไฟล์ที่มีฉบับบีบอัด (เช่น .glb ที่แปลงจาก .skp) ส่งแบบ gzip ให้เบราว์เซอร์คลายเอง
    const gzipped = `${path}.gz`;
    const useGzip = existsSync(gzipped) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    res.setHeader('Vary', 'Accept-Encoding');
    if (useGzip) res.setHeader('Content-Encoding', 'gzip');
    // DATA_DIR ค่าเริ่มต้นคือ .data (ขึ้นต้นด้วยจุด) ต้องอนุญาตให้ส่งไฟล์จากโฟลเดอร์นี้
    res.sendFile(useGzip ? gzipped : path, { dotfiles: 'allow', headers: useGzip ? { 'Content-Type': meta.contentType } : undefined });
});
