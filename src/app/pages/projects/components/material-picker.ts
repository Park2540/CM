import { Material } from '@/app/pages/service/procurement.service';

/** ข้อความในช่องเลือกวัสดุ (datalist): "ชื่อ (หน่วย)" */
export const materialLabel = (item: { name: string; unit: string }) => `${item.name} (${item.unit})`;

/** คีย์จับคู่วัสดุเหมือนหลังบ้าน: รหัสในรายการวัสดุ หรือ ชื่อ|หน่วย (ไม่สนตัวพิมพ์/ช่องว่าง) */
export function materialKey(item: { materialCode?: string; name: string; unit: string }): string {
    if (item.materialCode) return item.materialCode;
    const norm = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
    return `${norm(item.name)}|${norm(item.unit)}`;
}

/** หาวัสดุจากข้อความที่เลือก/พิมพ์: ตรงกับ "ชื่อ (หน่วย)" หรือชื่ออย่างเดียว (ถ้าชื่อนั้นมีหน่วยเดียว) */
export function findMaterialByText(materials: Material[], text: string): Material | undefined {
    const value = text.trim();
    if (!value) return undefined;
    const byLabel = materials.find((item) => materialLabel(item) === value);
    if (byLabel) return byLabel;
    const byName = materials.filter((item) => item.name === value);
    return byName.length === 1 ? byName[0] : undefined;
}
