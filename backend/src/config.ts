import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
    process.loadEnvFile();
} catch {
    // ไม่มีไฟล์ .env ใช้ค่าจาก environment หรือค่าเริ่มต้น
}

const isProduction = process.env['NODE_ENV'] === 'production';
/** โฟลเดอร์ backend/ (ใช้หาที่เก็บข้อมูลตอนพัฒนา) */
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(process.env['DATA_DIR'] ?? join(backendRoot, '.data'));
mkdirSync(join(dataDir, 'uploads'), { recursive: true });

const authSecret = process.env['AUTH_SECRET'] ?? '';
if (isProduction && authSecret.length < 32) throw new Error('ต้องตั้งค่า AUTH_SECRET (อย่างน้อย 32 ตัวอักษร) ใน production');

export const config = {
    port: Number(process.env['PORT']) || 3000,
    /** ว่าง = ใช้ MongoDB ที่ดาวน์โหลดมาให้อัตโนมัติ เก็บข้อมูลใน DATA_DIR/db (เฉพาะตอนพัฒนา) */
    mongodbUri: process.env['MONGODB_URI'] ?? '',
    isProduction,
    /** ที่เก็บฐานข้อมูลตอนพัฒนาและไฟล์ที่อัปโหลด */
    dataDir,
    uploadDir: join(dataDir, 'uploads'),
    /** กุญแจลงลายเซ็น access token */
    authSecret: authSecret || 'dev-only-secret-change-me-in-production'
};
