import { createApp } from './app.js';
import { config } from './config.js';
import { connectDatabase, disconnectDatabase } from './db.js';
import { loadState, saveState } from './db/state.js';
// โหลดโมดูลตรรกะทางธุรกิจทั้งหมดก่อน loadState เพื่อให้ลงทะเบียนข้อมูลที่ต้องเก็บครบ
import './routes/index.js';

const { uri, local } = await connectDatabase();
const { seeded } = await loadState();
if (seeded.length) console.log(`ใส่ข้อมูลตั้งต้น: ${seeded.join(', ')}`);

// ข้อมูลที่สร้างตอนอ่าน (เช่น ไทม์ไลน์ของโครงการที่เพิ่งเปิดดู) เขียนลงฐานข้อมูลเป็นระยะ
const flush = setInterval(() => saveState().catch((error) => console.error('บันทึกฐานข้อมูลไม่สำเร็จ', error)), 30_000);

const server = createApp().listen(config.port, () => {
    console.log(`API พร้อมใช้งานที่ http://localhost:${config.port}/api`);
    console.log(`ฐานข้อมูล: ${local ? `MongoDB ในเครื่อง (ข้อมูลอยู่ที่ ${config.dataDir})` : uri}`);
});

async function shutdown() {
    clearInterval(flush);
    server.close();
    await saveState();
    await disconnectDatabase();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
