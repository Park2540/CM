/**
 * ตั้งค่าการเชื่อมต่อ API
 *
 * - apiBaseUrl: ที่อยู่ของหลังบ้าน (backend/) — ตอนพัฒนา ng serve ส่งต่อ /api ไปที่ http://localhost:3000 (proxy.conf.json)
 * - showDemoLogins: แสดงรายชื่อบัญชีทดลอง (รหัสผ่าน demo1234) ที่หน้าเข้าสู่ระบบ — ปิดเมื่อใช้งานจริง
 */
export const environment = {
    apiBaseUrl: '/api',
    showDemoLogins: true
};
