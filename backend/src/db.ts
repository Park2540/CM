import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { config } from './config.js';

let localServer: { stop(): Promise<boolean> } | undefined;

/**
 * เชื่อมต่อ MongoDB
 * - ตั้ง MONGODB_URI: ใช้ MongoDB ที่ระบุ (ติดตั้งเอง หรือ MongoDB Atlas)
 * - ไม่ได้ตั้ง (ตอนพัฒนา): เปิด MongoDB ที่ดาวน์โหลดมาให้ เก็บข้อมูลถาวรที่ DATA_DIR/db (ปิดเปิดเซิร์ฟเวอร์แล้วข้อมูลยังอยู่)
 */
export async function connectDatabase(): Promise<{ uri: string; local: boolean }> {
    let uri = config.mongodbUri;
    if (!uri) {
        if (config.isProduction) throw new Error('ต้องตั้งค่า MONGODB_URI ใน production');
        const dbPath = join(config.dataDir, 'db');
        mkdirSync(dbPath, { recursive: true });
        const { MongoMemoryServer } = await import('mongodb-memory-server');
        const server = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger', port: 27027 } });
        localServer = server;
        uri = server.getUri('cm-planning');
    }
    await mongoose.connect(uri);
    return { uri: uri.replace(/\/\/[^@]*@/, '//***@'), local: !!localServer };
}

export async function disconnectDatabase() {
    await mongoose.disconnect();
    // doCleanup: false = ไม่ลบไฟล์ฐานข้อมูล
    await (localServer as { stop(options?: { doCleanup?: boolean }): Promise<boolean> } | undefined)?.stop({ doCleanup: false });
}
