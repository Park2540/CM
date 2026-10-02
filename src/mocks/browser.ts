import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/**
 * API จำลองตามสัญญา api/openapi.yaml — ทำงานใน Service Worker ของเบราว์เซอร์
 * ข้อมูลเก็บในหน่วยความจำ (รีเฟรชหน้าแล้วกลับเป็นค่าเริ่มต้น)
 * เพิ่ม endpoint ใหม่: เพิ่ม handler ใน handlers/ แล้วใส่ใน handlers/index.ts
 */
export const worker = setupWorker(...handlers);
