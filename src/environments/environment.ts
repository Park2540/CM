/**
 * ตั้งค่าการเชื่อมต่อ API
 *
 * - useMock: true  → ใช้ API จำลอง (MSW ใน src/mocks) ตามสัญญา api/openapi.yaml
 * - useMock: false → เรียกหลังบ้านจริงที่ apiBaseUrl
 *
 * เมื่อหลังบ้านพร้อม แก้แค่ไฟล์นี้ โค้ดหน้าจอและ service ไม่ต้องเปลี่ยน
 * (ตอนนี้เปิด mock ไว้ทั้ง dev และ production เพื่อใช้เดโมได้ระหว่างยังไม่มีหลังบ้าน)
 */
export const environment = {
    apiBaseUrl: '/api',
    useMock: true
};
