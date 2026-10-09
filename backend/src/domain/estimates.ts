/**
 * ถอดปริมาณและจัดทำ BOQ (ใบประมาณราคา)
 * โครงสร้างเหมือนไฟล์ Excel: หมวดงาน (แต่ละ sheet) → กลุ่มงาน (1. ฐานราก-ต่อม่อ) → รายการ (หน่วย ปริมาณ ราคาวัสดุ/ค่าแรงต่อหน่วย)
 * ปริมาณถอดได้จากบรรทัดคำนวณ (ปริมาตร พื้นที่ ความยาว จำนวน น้ำหนักเหล็ก) + เผื่อเสีย
 * สรุปราคา = วัสดุ + ค่าแรง ของหมวดที่รวมในสรุป + ค่าดำเนินการ (%) + กำไร (%) → รวมก่อนภาษี + ภาษีมูลค่าเพิ่ม (%) = รวมทั้งสิ้น
 */
import { persistArray } from '../db/state.js';
import type { ApiSchemas } from '../api/api.js';
import { recordAudit } from './audit-logs.js';
import { CURRENT_USER } from './users.js';
import { copyStatement, defaultStatement, normalizeStatement } from './overhead-statement.js';

type Estimate = ApiSchemas['Estimate'];
/** BOQ ที่บันทึกก่อนมีกำไร/ภาษี ไม่มีสองช่องนี้ (ถือเป็น 0) และก่อนมีเอกสารชี้แจงค่าดำเนินการ (ใช้แม่แบบบริษัท) */
type StoredEstimate = Omit<Estimate, 'totals' | 'profitPercent' | 'vatPercent' | 'statement'> & {
    status: 'draft' | 'final';
    overheadPercent: number;
    profitPercent?: number;
    vatPercent?: number;
    notes: string[];
    statement?: ApiSchemas['OverheadStatement'];
};
type Category = ApiSchemas['EstimateCategory'];
type Item = ApiSchemas['EstimateItem'];
type Line = ApiSchemas['TakeoffLine'];
type Problem = { status: 403 | 404 | 409 | 422; title: string; detail?: string; errors?: Record<string, string> };
type Result<T> = { ok: T } | Problem;

const round2 = (value: number) => Math.round(value * 100) / 100;
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
const author = (): ApiSchemas['UserRef'] => ({ id: CURRENT_USER.id, name: CURRENT_USER.name, roleLabel: CURRENT_USER.roleLabel });
const money = (value: number) => `฿${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------- ถอดปริมาณ ----------

/** น้ำหนักเหล็กเส้นต่อเมตร (กก./ม.) ตาม มอก. — ขนาดอื่นใช้ 0.00617 × d² */
export const REBAR_KG_PER_M: Record<number, number> = { 6: 0.222, 9: 0.499, 10: 0.617, 12: 0.888, 16: 1.578, 20: 2.466, 25: 3.853, 28: 4.834, 32: 6.313 };
export const rebarKgPerMeter = (diameter: number) => REBAR_KG_PER_M[diameter] ?? Math.round(0.00617 * diameter * diameter * 1000) / 1000;

export function lineResult(line: Pick<Line, 'method' | 'width' | 'length' | 'height' | 'count' | 'diameter' | 'kgPerMeter' | 'deduct'>): number {
    const w = num(line.width);
    const l = num(line.length);
    const h = num(line.height);
    const n = num(line.count);
    const value =
        line.method === 'volume' ? w * l * h * n
        : line.method === 'area' ? w * l * n
        : line.method === 'length' ? l * n
        : line.method === 'count' ? n
        : line.method === 'rebar' ? l * n * rebarKgPerMeter(num(line.diameter))
        : line.method === 'steel' ? l * n * num(line.kgPerMeter)
        : line.method === 'model' ? n
        : 0;
    return round2(line.deduct ? -value : value);
}

/** ปริมาณจากการถอด = ผลรวมบรรทัด × (1 + เผื่อเสีย%) ไม่ติดลบ */
export const takeoffQuantity = (lines: Line[], waste = 0) => round2(Math.max(0, lines.reduce((sum, line) => sum + lineResult(line), 0)) * (1 + waste / 100));

// ---------- ยอดรวม ----------

export function totalsOf(estimate: StoredEstimate): ApiSchemas['EstimateTotals'] {
    const categories = estimate.categories.map((category) => {
        let material = 0;
        let labor = 0;
        for (const group of category.groups) {
            for (const item of group.items) {
                if (item.kind !== 'item') continue;
                material += round2(item.quantity * item.materialPrice);
                labor += round2(item.quantity * item.laborPrice);
            }
        }
        return { id: category.id, material: round2(material), labor: round2(labor), total: round2(material + labor) };
    });
    const included = categories.filter((total) => !estimate.categories.find((category) => category.id === total.id)?.excluded);
    const material = round2(included.reduce((sum, item) => sum + item.material, 0));
    const labor = round2(included.reduce((sum, item) => sum + item.labor, 0));
    const subtotal = round2(material + labor);
    // ค่าดำเนินการและกำไรคิดจากค่าวัสดุ + ค่าแรง, ภาษีมูลค่าเพิ่มคิดจากราคารวมก่อนภาษี
    const overhead = round2((subtotal * estimate.overheadPercent) / 100);
    const profit = round2((subtotal * (estimate.profitPercent ?? 0)) / 100);
    const beforeVat = round2(subtotal + overhead + profit);
    const vat = round2((beforeVat * (estimate.vatPercent ?? 0)) / 100);
    const grandTotal = round2(beforeVat + vat);
    return { categories, material, labor, subtotal, overhead, profit, beforeVat, vat, grandTotal, pricePerSqm: estimate.area ? round2(grandTotal / estimate.area) : null };
}

const present = (estimate: StoredEstimate): Estimate => ({ ...estimate, profitPercent: estimate.profitPercent ?? 0, vatPercent: estimate.vatPercent ?? 0, statement: estimate.statement ?? copyStatement(), totals: totalsOf(estimate) });

// ---------- ข้อมูลตัวอย่าง (จากไฟล์ BOQ บ้านพักอาศัย ค.ส.ล. 1 ชั้น) ----------

let seq = 0;
const nextId = (prefix: string) => `${prefix}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const item = (description: string, unit: string, quantity: number, materialPrice: number, laborPrice: number, indent = false): Item => ({ id: nextId('i'), kind: 'item', description, unit, quantity, materialPrice, laborPrice, ...(indent ? { indent } : {}) });
const sub = (description: string, unit: string, quantity: number, materialPrice: number, laborPrice: number) => item(description, unit, quantity, materialPrice, laborPrice, true);
const heading = (description: string): Item => ({ id: nextId('i'), kind: 'heading', description, quantity: 0, materialPrice: 0, laborPrice: 0 });
const group = (title: string, items: Item[]) => ({ id: nextId('g'), title, items });
const category = (name: string, groups: ApiSchemas['EstimateGroup'][]): Category => ({ id: nextId('c'), name, groups });

function sampleEstimate(): StoredEstimate {
    const now = new Date().toISOString();
    return {
        id: 'EST-6910-0001',
        title: 'บ้านพักอาศัย ค.ส.ล. 1 ชั้น (ตัวอย่าง)',
        location: 'ต.เจดีย์คำ อ.เชียงคำ จ.พะเยา',
        ownerName: 'ลูกค้าตัวอย่าง',
        estimator: 'ฝ่ายประมาณราคา',
        area: 180,
        overheadPercent: 5,
        profitPercent: 0,
        vatPercent: 0,
        statement: defaultStatement(),
        status: 'draft',
        notes: ['ไม่รวมปั๊มน้ำ ถังเก็บน้ำ มิเตอร์น้ำ'],
        categories: [
            category('งานเตรียมการ', [
                group('งานเตรียมการ', [item('งานปรับบริเวณ', 'เหมา', 1, 0, 5000), item('วางผัง + ระดับอาคาร', 'เหมา', 1, 0, 5000), item('ค่าเครื่องจักร (MOBILE CRANE, BACKHOE)', 'เหมา', 1, 0, 5000)])
            ]),
            category('งานโครงสร้างคอนกรีตเสริมเหล็ก', [
                group('ฐานราก-ต่อม่อ', [
                    item('งานขุดดิน', 'ลบ.ม.', 73.9, 0, 100),
                    item('งานถมดินคืน', 'ลบ.ม.', 75.8, 0, 100),
                    item('งานถมดินใหม่', 'ลบ.ม.', 1.9, 400, 100),
                    item('งานทรายหยาบบดอัดแน่น', 'ลบ.ม.', 8.7, 600, 100),
                    item('งานคอนกรีตหยาบ', 'ลบ.ม.', 2.8, 1850, 600),
                    item("งานคอนกรีตโครงสร้าง (fc' = 210 KSC. Cylinder)", 'ลบ.ม.', 21.7, 1950, 600),
                    item('งานไม้แบบ', 'ตร.ม.', 82.8, 100, 120),
                    item('งานไม้เคร่ายึดแบบ', 'ตร.ม.', 24.9, 100, 120),
                    item('งานตะปู', 'กก.', 5, 50, 0),
                    heading('งานเหล็กเสริมคอนกรีต'),
                    sub('RB 6 mm. SR 24', 'กก.', 66, 30, 7),
                    sub('DB 12 mm. SD 40', 'กก.', 2770, 30, 7),
                    item('งานลวดผูกเหล็ก', 'กก.', 86, 50, 0)
                ]),
                group('ชั้นที่ 1', [
                    item('งานถมดินใหม่', 'ลบ.ม.', 47, 150, 100),
                    item('งานคอนกรีตหยาบ', 'ลบ.ม.', 3.6, 1850, 600),
                    item("งานคอนกรีตโครงสร้าง (fc' = 210 KSC. Cylinder)", 'ลบ.ม.', 34, 1950, 600),
                    item('งานไม้แบบ', 'ตร.ม.', 246, 100, 120),
                    item('งานไม้เคร่ายึดแบบ', 'ตร.ม.', 74, 100, 120),
                    item('งานตะปู', 'กก.', 50, 50, 0),
                    heading('งานเหล็กเสริมคอนกรีต'),
                    sub('RB 6 mm. SR 24', 'กก.', 448, 30, 7),
                    sub('RB 9 mm. SR 24', 'กก.', 524, 30, 7),
                    sub('DB 12 mm. SD 40', 'กก.', 2833, 30, 7),
                    item('งานลวดผูกเหล็ก', 'กก.', 115, 50, 0),
                    item('งานพื้นสำเร็จรูป PS หนา 5 ซม. รับน้ำหนักบรรทุกปลอดภัยได้ไม่น้อยกว่า 300 กก./ตร.ม.', 'ตร.ม.', 131, 350, 0),
                    item('งาน Wire Mesh 4 mm. @0.20 m.', 'ตร.ม.', 131, 50, 30)
                ])
            ]),
            category('งานโครงหลังคา + วัสดุมุงหลังคา', [
                group('งานเหล็กรูปพรรณ', [
                    item('แปเหล็กกล่อง []-25x25x2.3 mm. (1.45 kg./m.)', 'กก.', 1233, 35, 15),
                    item('จันทันเหล็ก C-100x50x20x2.3 mm. (4.06 kg./m.)', 'กก.', 1052, 35, 15),
                    item('อะเสเหล็ก 2C-100x50x20x2.3 mm. (8.12 kg./m.)', 'กก.', 650, 35, 15),
                    item('อกไก่เหล็ก 2C-100x50x20x2.3 mm. (8.12 kg./m.)', 'กก.', 301, 35, 15),
                    item('ตะเฆ่รางเหล็ก 2C-100x50x20x2.3 mm. (8.12 kg./m.)', 'กก.', 187, 35, 15),
                    item('ดั้งเหล็ก 2C-100x50x20x2.3 mm. (8.12 kg./m.)', 'กก.', 195, 35, 15),
                    item('เสาเหล็กกล่อง []-200x100x2.3 mm. (14.50 kg./m.)', 'กก.', 218, 35, 15),
                    item('Plate 200x200x8 mm.', 'แผ่น', 36, 220, 50),
                    item('งานทาสีกันสนิม', 'ตร.ม.', 473, 58, 35)
                ]),
                group('งานวัสดุมุงหลังคา', [
                    item('METAL SHEET', 'ตร.ม.', 53, 280, 60),
                    item('FLASHING', 'เมตร', 22, 150, 50),
                    item('หลังคากระเบื้อง C-PAC MONIER', 'ตร.ม.', 302, 200, 100),
                    item('ครอบสันโค้ง', 'เมตร', 37, 100, 0),
                    item('ครอบข้าง', 'เมตร', 44, 100, 0),
                    item('ครอบโค้งปิดจั่ว', 'ชุด', 4, 100, 0),
                    item('ครอบสันหางมน', 'ชุด', 6, 100, 0),
                    item('แผ่นสะท้อนความร้อน', 'ตร.ม.', 302, 80, 20),
                    item('ไม้เชิงชาย 2in1', 'เมตร', 86, 200, 50),
                    item('รางระบายน้ำฝน พร้อมท่อ', 'เมตร', 56, 1200, 300)
                ])
            ]),
            category('งานโครงสร้างบันไดเหล็ก', [
                group('งานเหล็กรูปพรรณ', [
                    item('เหล็กกล่อง []-200x50x6.0 mm. (20.20 kg./m.)', 'กก.', 223, 35, 15),
                    item('เหล็กฉาก L-100x100x7.0 mm. (10.70 kg./m.)', 'กก.', 54, 35, 15),
                    item('เหล็กฉาก L-70x70x6.0 mm. (6.38 kg./m.)', 'กก.', 243, 35.2, 15),
                    item('Plate 200x200x15 mm.', 'แผ่น', 4, 350, 100),
                    item('Plate 300x200x15 mm.', 'แผ่น', 2, 450, 100),
                    item('J-Bolt M20', 'ชุด', 20, 230, 50),
                    item('งานทาสีกันสนิม', 'ตร.ม.', 25, 58, 35),
                    item('งานทาสีน้ำมัน', 'ตร.ม.', 25, 58, 35)
                ]),
                group('งานอื่น ๆ', [item('ลูกนอนบันได ไม้ยางพาราสังเคราะห์', 'ตร.ม.', 9, 2500, 600), item('ราวบันไดเหล็ก', 'เมตร', 10, 2000, 500)])
            ]),
            category('งานสถาปัตยกรรม', [
                group('งานตกแต่งพื้น', [
                    item('F1 พื้น ค.ส.ล. ขัดเรียบ', 'ตร.ม.', 42, 0, 80),
                    item('F2 พื้น ค.ส.ล. ปูกระเบื้อง SPC', 'ตร.ม.', 138, 750, 200),
                    item('F3 พื้น ค.ส.ล. ปูกระเบื้องเซรามิก ผิวกันลื่น ขนาด 20x20 cm.', 'ตร.ม.', 42, 300, 180),
                    item('พื้น ค.ส.ล. ทำทรายล้าง', 'ตร.ม.', 32, 450, 100),
                    item('กาวยาแนว (1 กก./ถุง)', 'ถุง', 19, 100, 0),
                    item('ปูนกาว', 'ตร.ม.', 188, 80, 0)
                ]),
                group('งานตกแต่งผนัง', [
                    item('ผนังก่ออิฐแทนบิด', 'ตร.ม.', 364, 200, 150),
                    item('ผนังบล็อคช่องลม', 'ตร.ม.', 3, 500, 300),
                    item('เสาเอ็นและทับหลัง', 'เมตร', 230, 50, 50),
                    item('งานจับเซี้ยม', 'เมตร', 233, 50, 50),
                    item('ผนังฉาบปูนเรียบ', 'ตร.ม.', 624, 80, 100),
                    item('ผนังกรุกระเบื้องเซรามิก', 'ตร.ม.', 146, 300, 180),
                    item('ผนังเซาะร่อง', 'เมตร', 54, 50, 50),
                    item('บัวปูนปั้นผนัง', 'เมตร', 170, 100, 50),
                    item('ช่องลมระบายอากาศใต้หลังคา', 'ชุด', 4, 1200, 800)
                ]),
                group('งานตกแต่งฝ้าเพดาน', [item('C1 ฝ้าเพดาน GYPSUM BOARD หนา 9 mm. ชนิดธรรมดา ฉาบรอยต่อเรียบ', 'ตร.ม.', 138, 150, 100), item('C2 ฝ้าเพดาน GYPSUM BOARD หนา 9 mm. ชนิดกันชื้น ฉาบรอยต่อเรียบ', 'ตร.ม.', 105, 170, 100)]),
                group('งานประตู', [
                    item('D1 ประตูบานเปิดคู่ ไม้เนื้อแข็ง + ช่องแสงติดตาย + ช่องประตูสำหรับแมว + Digital Lock', 'ชุด', 1, 25000, 3500),
                    item('D2 ประตูบานเปิดเดี่ยว UPVC พร้อมวงกบ มือจับและอุปกรณ์ครบชุด', 'ชุด', 7, 5000, 1000),
                    item('D3 ประตูบานเปิดเดี่ยว UPVC พร้อมวงกบ มือจับและอุปกรณ์ครบชุด', 'ชุด', 3, 4500, 1000),
                    item('D4 ประตูบานเลื่อน UPVC พร้อมรางแขวน มือจับและอุปกรณ์ครบชุด', 'ชุด', 2, 5500, 1000),
                    item('D5 ประตูอลูมิเนียม บานเลื่อนสลับ + ช่องแสงติดตาย พร้อมมือจับและอุปกรณ์ครบชุด', 'ชุด', 2, 32000, 0)
                ]),
                group('งานหน้าต่าง', [
                    item('W1 หน้าต่างอลูมิเนียม บานเลื่อนสลับ พร้อมมือจับอุปกรณ์ครบชุด', 'ชุด', 5, 10000, 0),
                    item('W2 หน้าต่างอลูมิเนียม บานเลื่อนสลับ พร้อมมือจับอุปกรณ์ครบชุด', 'ชุด', 2, 5500, 0),
                    item('W3 หน้าต่างอลูมิเนียม บานกระทุ้ง พร้อมมือจับและอุปกรณ์ครบชุด', 'ชุด', 2, 3000, 0),
                    item('W4 หน้าต่างอลูมิเนียม บานเกล็ดซ้อน พร้อมอุปกรณ์ครบชุด', 'ชุด', 2, 2500, 0),
                    item('W5 หน้าต่างอลูมิเนียม บานกระทุ้ง + ช่องแสงติดตาย พร้อมมือจับและอุปกรณ์ครบชุด', 'ชุด', 5, 5000, 0)
                ]),
                group('งานห้องน้ำและสุขภัณฑ์', [
                    item('ชักโครก พร้อมอุปกรณ์ครบชุด', 'ชุด', 2, 3500, 500),
                    item('อ่างล้างหน้า + เคาน์เตอร์ปูน พร้อมอุปกรณ์ครบชุด', 'ชุด', 2, 7800, 5000),
                    item('ฝักบัวสายอ่อน พร้อมวาล์วเปิด-ปิด พร้อมอุปกรณ์ครบชุด', 'ชุด', 2, 550, 300),
                    item('สายชำระ พร้อม Stop Valve อุปกรณ์ครบชุด', 'ชุด', 2, 350, 300),
                    item('กระจกเงาแบบติดผนัง', 'ชุด', 2, 1500, 500),
                    item('ที่วางสบู่', 'ชุด', 2, 300, 200),
                    item('ราวแขวนผ้า', 'ชุด', 4, 400, 200),
                    item('กระจกกั้นอาบน้ำ Temper', 'ชุด', 3, 5000, 1000)
                ]),
                group('งานทาสี', [item('งานทาสีน้ำอะคริลิกภายใน รองพื้น 1 รอบ สีจริง 2 รอบ', 'ตร.ม.', 432, 90, 50), item('งานทาสีน้ำอะคริลิกภายนอก รองพื้น 1 รอบ สีจริง 2 รอบ', 'ตร.ม.', 235, 100, 50)])
            ]),
            category('งานระบบไฟฟ้า', [
                group('งานระบบไฟฟ้า', [
                    item('ตู้คอนซูมเมอร์ 1 เฟส 2 สาย 50A 14 ช่อง พร้อมอุปกรณ์', 'ชุด', 1, 10000, 1500),
                    heading('สวิทช์ไฟฟ้า พร้อมหน้ากากและอุปกรณ์'),
                    sub('แบบ 1 ช่อง (ทางเดียว)', 'ชุด', 19, 150, 150),
                    sub('แบบ 3 ช่อง (ทางเดียว)', 'ชุด', 0, 350, 200),
                    sub('แบบ 1 ช่อง (สองทาง)', 'ชุด', 0, 200, 200),
                    sub('แบบ 3 ช่อง (สองทาง)', 'ชุด', 0, 400, 200),
                    heading('ปลั๊กไฟฟ้าชนิดมีกราวด์ พร้อมหน้ากากและอุปกรณ์'),
                    sub('แบบ 2 เต้าเสียบ', 'ชุด', 13, 300, 200),
                    sub('แบบ 2 เต้าเสียบ (กันน้ำ)', 'ชุด', 0, 500, 200),
                    item('เครื่องทำน้ำอุ่น (ปล่อยสาย)', 'ชุด', 5, 0, 0),
                    item('แอร์ (ปล่อยสาย)', 'ชุด', 5, 0, 0),
                    item('โคมไฟ DOWNLIGHT ฝังฝ้าเพดาน ขนาด 12 (แบบที่ 1)', 'ชุด', 38, 250, 200),
                    item('โคมไฟ DOWNLIGHT ฝังฝ้าเพดาน ขนาด 12 (แบบที่ 2)', 'ชุด', 3, 300, 200),
                    item('โคมไฟกิ่งภายนอก พร้อมหลอดอินแคนเดสเซนต์', 'ชุด', 6, 550, 300),
                    item('ไฟ LED แบบเส้น (พร้อมราง)', 'เมตร', 12, 300, 150),
                    item('โคมไฟระย้าหวายสานไม้ไผ่', 'ชุด', 4, 1500, 500),
                    item('สายเมนเข้าอาคาร พร้อมอุปกรณ์ 1C-NYY 25', 'เมตร', 40, 750, 250),
                    item('เดินสายไฟ THW 2.5 sq.mm. (สวิทช์และดวงโคม)', 'จุด', 72, 250, 200),
                    item('เดินสายไฟ THW 1x4.0 sq.mm. (ปลั๊ก)', 'จุด', 13, 450, 150),
                    item('เดินสายไฟ THW 1x4.0 sq.mm. (เครื่องทำน้ำอุ่น)', 'จุด', 10, 450, 150)
                ])
            ]),
            category('งานระบบประปา-สุขาภิบาล', [
                group('งานระบบประปา-สุขาภิบาล', [
                    item('ท่อน้ำดี PVC ขนาด 1/2" ชั้น 13.5', 'เมตร', 36, 40, 0),
                    item('ท่อน้ำดี PVC ขนาด 3/4" ชั้น 13.5', 'เมตร', 83, 50, 0),
                    item('ท่อน้ำทิ้ง PVC ขนาด 2" ชั้น 8.5', 'เมตร', 74, 80, 0),
                    item('ท่อน้ำโสโครก PVC ขนาด 4" ชั้น 8.5', 'เมตร', 52, 180, 0),
                    item('ท่อระบายอากาศ PVC ขนาด 1" ชั้น 8.5', 'เมตร', 4, 40, 0),
                    item('ข้อต่อ อุปกรณ์ท่อ', 'เหมา', 1, 10515, 0),
                    item('ค่าแรงติดตั้งท่อและอุปกรณ์ท่อ', 'เหมา', 1, 0, 25236),
                    item('FD ฝาสแตนเลส ขนาด 2 นิ้ว', 'ชุด', 7, 350, 100),
                    item('ถังบำบัดน้ำเสีย ขนาด 1,200 ลิตร', 'ชุด', 1, 8000, 5000),
                    item('บ่อพักน้ำ ค.ส.ล. พร้อมฝา', 'ชุด', 6, 300, 200),
                    item('ท่อระบายน้ำซีเมนต์ใยหินฝังใต้ดิน Dia. 15 cm.', 'เมตร', 23, 100, 100),
                    item('บ่อดักไขมันสำเร็จรูป', 'ชุด', 1, 3000, 1000),
                    item('บ่อซึม ค.ส.ล. ขนาด Dia. 1.00 m. พร้อมฝา (3 ท่อน/ชุด)', 'ชุด', 1, 1000, 2000)
                ])
            ])
        ],
        createdBy: { id: 'system', name: 'ข้อมูลตัวอย่าง', roleLabel: 'ระบบ' },
        createdAt: now,
        updatedAt: now
    };
}

/** หมวดงานมาตรฐานสำหรับ BOQ ใหม่ (ยังไม่มีรายการ) */
function standardCategories(): Category[] {
    const blank = (name: string, groups: string[]) => category(name, groups.map((title) => group(title, [])));
    return [
        blank('งานเตรียมการ', ['งานเตรียมการ']),
        blank('งานโครงสร้างคอนกรีตเสริมเหล็ก', ['ฐานราก-ต่อม่อ', 'ชั้นที่ 1']),
        blank('งานโครงหลังคา + วัสดุมุงหลังคา', ['งานเหล็กรูปพรรณ', 'งานวัสดุมุงหลังคา']),
        blank('งานสถาปัตยกรรม', ['งานตกแต่งพื้น', 'งานตกแต่งผนัง', 'งานตกแต่งฝ้าเพดาน', 'งานประตู', 'งานหน้าต่าง', 'งานห้องน้ำและสุขภัณฑ์', 'งานทาสี']),
        blank('งานระบบไฟฟ้า', ['งานระบบไฟฟ้า']),
        blank('งานระบบประปา-สุขาภิบาล', ['งานระบบประปา-สุขาภิบาล'])
    ];
}

export const estimates: StoredEstimate[] = [sampleEstimate()];

// ---------- อ่าน ----------

const itemCount = (estimate: StoredEstimate) => estimate.categories.reduce((sum, category) => sum + category.groups.reduce((n, group) => n + group.items.filter((entry) => entry.kind === 'item').length, 0), 0);

export function listEstimates(): ApiSchemas['EstimateSummary'][] {
    return [...estimates]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((estimate) => {
            const totals = totalsOf(estimate);
            return {
                id: estimate.id,
                title: estimate.title,
                ...(estimate.projectCode ? { projectCode: estimate.projectCode } : {}),
                ...(estimate.location ? { location: estimate.location } : {}),
                ...(estimate.ownerName ? { ownerName: estimate.ownerName } : {}),
                status: estimate.status,
                ...(estimate.area ? { area: estimate.area } : {}),
                grandTotal: totals.grandTotal,
                pricePerSqm: totals.pricePerSqm ?? null,
                itemCount: itemCount(estimate),
                ...(estimate.source ? { fromModel: true } : {}),
                updatedAt: estimate.updatedAt
            };
        });
}

export function getEstimate(id: string): Estimate | undefined {
    const estimate = estimates.find((item) => item.id === id);
    return estimate ? present(estimate) : undefined;
}

/** คลังราคาต่อหน่วยจาก BOQ ทุกฉบับ (รายการเดียวกัน = ชื่อ + หน่วย ใช้ราคาจากฉบับที่แก้ล่าสุด) */
export function estimateRates(): ApiSchemas['EstimateRate'][] {
    const rates = new Map<string, ApiSchemas['EstimateRate']>();
    for (const estimate of [...estimates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
        for (const cat of estimate.categories) {
            for (const grp of cat.groups) {
                for (const entry of grp.items) {
                    if (entry.kind !== 'item' || !entry.description || (!entry.materialPrice && !entry.laborPrice)) continue;
                    const key = `${entry.description}|${entry.unit ?? ''}`;
                    if (!rates.has(key)) rates.set(key, { category: cat.name, group: grp.title, description: entry.description, unit: entry.unit ?? '', materialPrice: entry.materialPrice, laborPrice: entry.laborPrice });
                }
            }
        }
    }
    return [...rates.values()];
}

// ---------- เขียน ----------

function nextEstimateId(): string {
    const now = new Date();
    const head = `EST-${String(now.getFullYear() + 543).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}-`;
    const highest = Math.max(0, ...estimates.map((item) => Number(item.id.slice(-4)) || 0));
    return `${head}${String(highest + 1).padStart(4, '0')}`;
}

/** สำเนาลึกพร้อมรหัสใหม่ทุกระดับ */
function cloneCategories(categories: Category[]): Category[] {
    return categories.map((cat) => ({
        ...cat,
        id: nextId('c'),
        groups: cat.groups.map((grp) => ({ ...grp, id: nextId('g'), items: grp.items.map((entry) => ({ ...entry, id: nextId('i'), ...(entry.takeoff ? { takeoff: entry.takeoff.map((line) => ({ ...line, id: nextId('t') })) } : {}) })) }))
    }));
}

export function createEstimate(input: Partial<ApiSchemas['EstimateCreateInput']>, project?: { code: string; name: string; location: string | null; customerName: string }): Result<Estimate> {
    const title = text(input.title, 200);
    if (!title) return { status: 422, title: 'ข้อมูลไม่ถูกต้อง', detail: 'กรุณาระบุชื่องาน', errors: { title: 'กรุณาระบุชื่องาน' } };
    const source = input.copyFrom ? estimates.find((item) => item.id === input.copyFrom) : undefined;
    if (input.copyFrom && !source) return { status: 404, title: 'ไม่พบ BOQ ต้นฉบับ' };
    const now = new Date().toISOString();
    const estimate: StoredEstimate = {
        id: nextEstimateId(),
        title,
        ...(project ? { projectCode: project.code } : {}),
        ...(project?.location ? { location: project.location } : source?.location ? { location: source.location } : {}),
        ...(project ? { ownerName: project.customerName } : source?.ownerName ? { ownerName: source.ownerName } : {}),
        estimator: CURRENT_USER.name,
        estimateDate: now.slice(0, 10),
        ...(source?.area ? { area: source.area } : {}),
        overheadPercent: source?.overheadPercent ?? 5,
        profitPercent: source?.profitPercent ?? 0,
        vatPercent: source?.vatPercent ?? 7,
        statement: copyStatement(source?.statement),
        status: 'draft',
        notes: source ? [...source.notes] : [],
        categories: source ? cloneCategories(source.categories) : input.template === 'blank' ? [] : standardCategories(),
        createdBy: author(),
        createdAt: now,
        updatedBy: author(),
        updatedAt: now
    };
    estimates.push(estimate);
    recordAudit({ module: 'project', action: source ? 'คัดลอก BOQ' : 'สร้าง BOQ', target: estimate.id, detail: `${title}${source ? ` จาก ${source.id}` : ''}${project ? ` · ${project.code}` : ''}` });
    return { ok: present(estimate) };
}

/** ตรวจและจัดรูปข้อมูลที่ส่งมาทั้งฉบับ: ตัดข้อความยาวเกิน ตัวเลขติดลบ → 0 ปริมาณจากการถอดคำนวณใหม่ */
function normalizeCategories(input: unknown, errors: Record<string, string>): Category[] {
    const list = Array.isArray(input) ? input.slice(0, 30) : [];
    return list.map((rawCategory: Partial<Category>, c) => {
        const name = text(rawCategory.name, 200);
        if (!name) errors[`categories.${c}.name`] = 'กรุณาระบุชื่อหมวดงาน';
        const groups = (Array.isArray(rawCategory.groups) ? rawCategory.groups.slice(0, 50) : []).map((rawGroup: Partial<ApiSchemas['EstimateGroup']>) => ({
            id: text(rawGroup.id, 40) || nextId('g'),
            title: text(rawGroup.title, 200),
            items: (Array.isArray(rawGroup.items) ? rawGroup.items.slice(0, 300) : []).map((rawItem: Partial<Item>): Item => {
                const kind = rawItem.kind === 'heading' ? 'heading' : 'item';
                const takeoff = (Array.isArray(rawItem.takeoff) ? rawItem.takeoff.slice(0, 200) : []).map((rawLine: Partial<Line>): Line => {
                    const method = (['volume', 'area', 'length', 'count', 'rebar', 'steel', 'model'] as const).includes(rawLine.method as Line['method']) ? (rawLine.method as Line['method']) : 'count';
                    const line: Line = { id: text(rawLine.id, 40) || nextId('t'), method, count: num(rawLine.count) };
                    if (text(rawLine.label, 200)) line.label = text(rawLine.label, 200);
                    for (const field of ['width', 'length', 'height', 'diameter', 'kgPerMeter'] as const) if (rawLine[field] !== undefined) line[field] = num(rawLine[field]);
                    if (rawLine.deduct) line.deduct = true;
                    line.result = lineResult(line);
                    return line;
                });
                const waste = Math.min(100, num(rawItem.waste));
                const entry: Item = {
                    id: text(rawItem.id, 40) || nextId('i'),
                    kind,
                    description: text(rawItem.description, 300),
                    quantity: kind === 'heading' ? 0 : takeoff.length ? takeoffQuantity(takeoff, waste) : round2(num(rawItem.quantity)),
                    materialPrice: kind === 'heading' ? 0 : round2(num(rawItem.materialPrice)),
                    laborPrice: kind === 'heading' ? 0 : round2(num(rawItem.laborPrice))
                };
                if (kind === 'item' && text(rawItem.unit, 30)) entry.unit = text(rawItem.unit, 30);
                if (waste) entry.waste = waste;
                if (rawItem.indent) entry.indent = true;
                if (takeoff.length) entry.takeoff = takeoff;
                if (text(rawItem.note, 300)) entry.note = text(rawItem.note, 300);
                return entry;
            })
        }));
        return { id: text(rawCategory.id, 40) || nextId('c'), name, ...(rawCategory.excluded ? { excluded: true } : {}), groups };
    });
}

export function saveEstimate(id: string, input: Partial<ApiSchemas['EstimateInput']>, projectExists: (code: string) => boolean): Result<Estimate> {
    const estimate = estimates.find((item) => item.id === id);
    if (!estimate) return { status: 404, title: 'ไม่พบ BOQ' };
    const errors: Record<string, string> = {};
    const title = text(input.title, 200);
    if (!title) errors['title'] = 'กรุณาระบุชื่องาน';
    const projectCode = text(input.projectCode, 20);
    if (projectCode && !projectExists(projectCode)) errors['projectCode'] = 'ไม่พบโครงการ';
    if (input.estimateDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.estimateDate)) errors['estimateDate'] = 'วันที่ไม่ถูกต้อง';
    const overheadPercent = Math.min(100, num(input.overheadPercent ?? estimate.overheadPercent));
    const profitPercent = Math.min(100, num(input.profitPercent ?? estimate.profitPercent ?? 0));
    const vatPercent = Math.min(100, num(input.vatPercent ?? estimate.vatPercent ?? 0));
    const categories = normalizeCategories(input.categories, errors);
    // ไม่ส่ง statement = คงเอกสารชี้แจงเดิม
    const statement = input.statement === undefined ? undefined : normalizeStatement(input.statement);
    if (statement && 'error' in statement) errors['statement'] = statement.error;
    if (Object.keys(errors).length) return { status: 422, title: 'ข้อมูลไม่ถูกต้อง', detail: Object.values(errors)[0], errors };

    const before = totalsOf(estimate).grandTotal;
    for (const key of ['projectCode', 'location', 'ownerName', 'estimator', 'estimateDate', 'area'] as const) delete estimate[key];
    Object.assign(estimate, {
        title,
        ...(projectCode ? { projectCode } : {}),
        ...(text(input.location, 300) ? { location: text(input.location, 300) } : {}),
        ...(text(input.ownerName, 200) ? { ownerName: text(input.ownerName, 200) } : {}),
        ...(text(input.estimator, 200) ? { estimator: text(input.estimator, 200) } : {}),
        ...(input.estimateDate ? { estimateDate: input.estimateDate } : {}),
        ...(num(input.area) ? { area: num(input.area) } : {}),
        overheadPercent,
        profitPercent,
        vatPercent,
        ...(statement ? { statement } : {}),
        status: input.status === 'final' ? 'final' : 'draft',
        notes: (Array.isArray(input.notes) ? input.notes : []).map((note) => text(note, 300)).filter(Boolean).slice(0, 20),
        categories,
        updatedBy: author(),
        updatedAt: new Date().toISOString()
    });
    const after = totalsOf(estimate).grandTotal;
    if (after !== before || input.status !== undefined) recordAudit({ module: 'project', action: 'บันทึก BOQ', target: estimate.id, detail: `${title} · ${money(after)}${after !== before ? ` (เดิม ${money(before)})` : ''}` });
    return { ok: present(estimate) };
}

/** BOQ ฉบับร่างจากโมเดล IFC (หมวด/รายการและรายการวัสดุสร้างที่ estimate-from-ifc.ts) */
export function createEstimateFromModel(input: { title: string; project: { code: string; name: string; location: string | null; customerName: string; designBrief?: { usableArea?: number } }; categories: Category[]; source: ApiSchemas['EstimateSource'] }): Estimate {
    const now = new Date().toISOString();
    const estimate: StoredEstimate = {
        id: nextEstimateId(),
        title: input.title,
        projectCode: input.project.code,
        ...(input.project.location ? { location: input.project.location } : {}),
        ownerName: input.project.customerName,
        estimator: CURRENT_USER.name,
        estimateDate: now.slice(0, 10),
        ...(input.project.designBrief?.usableArea ? { area: input.project.designBrief.usableArea } : {}),
        overheadPercent: 5,
        profitPercent: 0,
        vatPercent: 7,
        statement: copyStatement(),
        status: 'draft',
        notes: ['ถอดปริมาณอัตโนมัติจากโมเดล IFC — ตรวจรายการและราคาก่อนส่งลูกค้า'],
        categories: input.categories,
        source: input.source,
        createdBy: author(),
        createdAt: now,
        updatedBy: author(),
        updatedAt: now
    };
    estimates.push(estimate);
    recordAudit({ module: 'project', action: 'ถอด BOQ จากโมเดล IFC', target: estimate.id, detail: `${input.project.code} · ${input.source.fileName} · ${input.source.elements} ชิ้นงาน · ${money(totalsOf(estimate).grandTotal)}` });
    return present(estimate);
}

/** รายการวัสดุของ BOQ ที่ถอดจากโมเดล → ส่งเข้า BOQ วัสดุของโครงการ */
export function markMaterialsApplied(id: string): void {
    const estimate = estimates.find((item) => item.id === id);
    if (estimate?.source) estimate.source.appliedAt = new Date().toISOString();
}

export const findStoredEstimate = (id: string) => estimates.find((item) => item.id === id);

export function deleteEstimate(id: string): Result<true> {
    const index = estimates.findIndex((item) => item.id === id);
    if (index < 0) return { status: 404, title: 'ไม่พบ BOQ' };
    const [removed] = estimates.splice(index, 1);
    recordAudit({ module: 'project', action: 'ลบ BOQ', target: removed!.id, detail: removed!.title });
    return { ok: true };
}

persistArray('estimates', estimates, (item) => item.id, (a, b) => b.updatedAt.localeCompare(a.updatedAt));
