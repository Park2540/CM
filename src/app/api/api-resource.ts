import { computed } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';

/**
 * rxResource ที่ value() ไม่ throw เมื่อโหลดไม่สำเร็จ
 *
 * value() ของ Angular throw ResourceValueError เมื่อ resource อยู่ในสถานะ error ทำให้ทั้งหน้า render ไม่ได้
 * (เช่น หลังบ้านตอบ 403 เพราะผู้ใช้ไม่มีสิทธิ์) — ตัวนี้คืน defaultValue แทน แล้วให้หน้าจอแสดงข้อผิดพลาดจาก error() เอง
 * ใช้แทน rxResource ทุกที่ที่ดึงข้อมูลจาก API
 */
export const apiResource: typeof rxResource = ((options: Parameters<typeof rxResource>[0]) => {
    const resource = rxResource(options);
    const value = resource.value;
    const fallback = (options as { defaultValue?: unknown }).defaultValue;
    // ใช้ status() ไม่ใช่ hasValue() เพราะ hasValue() เรียก value() ตัวนี้ซ้ำ
    const safeValue = computed(() => (resource.status() === 'error' ? fallback : value()));
    Object.defineProperty(resource, 'value', { value: Object.assign(safeValue, { set: value.set?.bind(value), update: value.update?.bind(value), asReadonly: () => safeValue }) });
    return resource;
}) as typeof rxResource;
