/**
 * แปลงผลถอดปริมาณจากโมเดล IFC → หมวด/รายการ BOQ + รายการวัสดุ (ต้นแบบ)
 * ชนิดงานตัดสินจาก ประเภท IFC + ชื่อชนิด (Revit family:type) + วัสดุ เพราะ Revit มักใช้ประเภทไม่ตรงงานจริง
 * เช่น เสาเข็ม/ฐานรากเป็น Floor, เหล็ก C เป็น Beam, แผ่นพื้นสำเร็จเป็น Generic Model
 */
import type { ApiSchemas } from '../api/api.js';
import type { IfcTakeoffResult, QtoRow, RebarRow } from '../convert/ifc-takeoff.js';
import { rebarKgPerMeter } from '../convert/ifc-takeoff.js';
import { materials } from './materials.js';

type Category = ApiSchemas['EstimateCategory'];
type Item = ApiSchemas['EstimateItem'];
type Line = ApiSchemas['TakeoffLine'];
type Material = ApiSchemas['EstimateMaterial'];
type Rate = ApiSchemas['EstimateRate'];

/** สมมติฐานการคำนวณ (แสดงในที่มาของตัวเลข) */
export const ASSUMPTIONS = {
    steelDensity: 7850,
    concreteWaste: 5,
    rebarWaste: 7,
    tieWirePercent: 3,
    formworkReuse: 3,
    plywoodArea: 2.88,
    roofWaste: 10,
    steelWaste: 5
};

type Work = 'pile' | 'footing' | 'concrete' | 'plank' | 'precast' | 'steel' | 'roof' | 'fascia' | 'gutter' | 'other';

const KIND_LABEL: Record<string, string> = { beam: 'คาน', column: 'เสา', slab: 'พื้น', stair: 'บันได', wall: 'ผนัง', footing: 'ฐานราก', pile: 'เสาเข็ม', roof: 'หลังคา', covering: 'วัสดุปิดผิว', member: 'โครงเคร่า', plate: 'แผ่น', railing: 'ราวกันตก', door: 'ประตู', window: 'หน้าต่าง', other: 'ชิ้นงานอื่น' };

/** ชนิดงานจาก ประเภท + ชื่อชนิด + วัสดุ */
export function workOf(row: QtoRow): Work {
    const type = row.type.toLowerCase();
    const material = row.material.toLowerCase();
    const both = `${type} ${material}`;
    if (/gutter|รางน้ำ/.test(both)) return 'gutter';
    if (row.kind === 'covering' && /fascia|เชิงชาย/.test(both)) return 'fascia';
    if (row.kind === 'pile' || (/pile|เสาเข็ม/.test(type) && !/cap/.test(type))) return 'pile';
    if (row.kind === 'footing' || /pile.?cap|footing|ฐานราก|foundation/.test(type)) return 'footing';
    if (/แผ่นพื้นสำเร็จ|hollow.?core|plank/.test(type) && row.kind !== 'slab') return 'plank';
    if (row.kind === 'roof' || /\broof\b/.test(both)) return 'roof';
    if (/steel|เหล็ก|สีกันสนิม|tubs|hollow section|\b2?c \d|h-?beam|i-?beam|\bwf\b/.test(both)) return 'steel';
    if (/สำเร็จรูป|precast/.test(type)) return 'precast';
    if (['beam', 'column', 'slab', 'stair', 'wall'].includes(row.kind) && (/concrete|คอนกรีต|ksc/.test(material) || !material.trim() || material === '<unnamed>')) return 'concrete';
    return 'other';
}

/** ผิวที่ต้องตั้งไม้แบบ */
function formworkOf(row: QtoRow, work: Work): number {
    if (work === 'footing') return row.side;
    if (row.kind === 'beam' || row.kind === 'stair') return row.side + row.bottom;
    if (row.kind === 'column' || row.kind === 'wall') return row.side;
    // พื้นบนแผ่นพื้นสำเร็จ (PS) หรือพื้นวางบนดิน: ไม่ต้องตั้งแบบท้องพื้น
    if (row.kind === 'slab') return row.side + (/\bps\d*\b|on.?grade|บนดิน/i.test(row.type) ? 0 : row.bottom);
    return 0;
}

const gradeOf = (material: string, fallback: number) => Number(material.match(/(\d{3})\s*ksc/i)?.[1] ?? fallback);
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
/** ชื่อชนิดสั้น: ตัดชื่อ family ของ Revit ("3117_Concrete-Rectangular Beam:B12 0.20x0.40 m" → "B12 0.20x0.40 m") */
const shortType = (type: string) => (type.includes(':') ? type.split(':').pop()!.trim() : type).trim() || 'ไม่ระบุชนิด';
const rebarName = (diameter: number) => (diameter <= 9 ? `RB ${diameter} mm. SR 24` : `DB ${diameter} mm. SD 40`);

let seq = 0;
const id = (prefix: string) => `${prefix}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const modelLine = (label: string, quantity: number): Line => ({ id: id('t'), method: 'model', label, count: round(quantity, 3), result: round(quantity, 3) });

/** ราคาต่อหน่วยจากคลังราคา: ตรงชื่อก่อน แล้วค่อยตามคำค้น */
function priceLookup(rates: Rate[]) {
    return (description: string, unit: string, pattern?: RegExp) => {
        const exact = rates.find((rate) => rate.description === description && rate.unit === unit);
        const found = exact ?? (pattern ? rates.find((rate) => pattern.test(rate.description) && rate.unit === unit) : undefined);
        return found ? { materialPrice: found.materialPrice, laborPrice: found.laborPrice } : { materialPrice: 0, laborPrice: 0 };
    };
}

export interface BuiltEstimate {
    categories: Category[];
    materials: Material[];
    components: ApiSchemas['EstimateSource']['components'];
    warnings: string[];
    unpriced: number;
}

export function buildEstimateFromTakeoff(result: IfcTakeoffResult, rates: Rate[], options: { concreteGrade?: number } = {}): BuiltEstimate {
    const fallbackGrade = options.concreteGrade ?? 210;
    const price = priceLookup(rates);
    const warnings = [...result.warnings];
    const order = new Map(result.storeys.map((storey, index) => [storey.name, index]));
    const storeysOf = (rows: Array<{ storey: string }>) => [...new Set(rows.map((row) => row.storey))].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
    const rows = result.rows.map((row) => ({ ...row, work: workOf(row) }));
    let unpriced = 0;
    const item = (description: string, unit: string, takeoff: Line[], pattern?: RegExp, extra: Partial<Item> = {}): Item => {
        const prices = price(description, unit, pattern);
        if (!prices.materialPrice && !prices.laborPrice) unpriced++;
        const quantity = round(takeoff.reduce((sum, line) => sum + (line.result ?? 0), 0));
        return { id: id('i'), kind: 'item', description, unit, quantity, ...prices, takeoff, ...extra };
    };
    const ungraded = rows.filter((row) => (row.work === 'concrete' || row.work === 'footing') && !/\d{3}\s*ksc/i.test(row.material));
    if (ungraded.length) warnings.push(`คอนกรีต ${ungraded.reduce((sum, row) => sum + row.count, 0)} ชิ้นไม่ระบุกำลังอัดในวัสดุ ใช้ ${fallbackGrade} ksc`);

    // ---------- งานโครงสร้าง (แยกตามชั้น) ----------
    const structureRows = rows.filter((row) => ['pile', 'footing', 'concrete', 'plank'].includes(row.work));
    const groups = storeysOf([...structureRows, ...result.rebars]).map((storey): ApiSchemas['EstimateGroup'] => {
        const here = structureRows.filter((row) => row.storey === storey);
        const items: Item[] = [];
        // เสาเข็ม: นับต้นตามชนิด
        const piles = new Map<string, QtoRow[]>();
        for (const row of here.filter((r) => r.work === 'pile')) piles.set(shortType(row.type), [...(piles.get(shortType(row.type)) ?? []), row]);
        for (const [type, list] of piles) items.push(item(`งานเสาเข็ม ${type}`, 'ต้น', list.map((row) => modelLine(`${row.count} ต้น · ยาวรวม ${round(row.length)} ม.`, row.count)), /เสาเข็ม/));
        // คอนกรีตตามกำลังอัด
        const concrete = here.filter((row) => row.work === 'concrete' || row.work === 'footing');
        for (const grade of [...new Set(concrete.map((row) => gradeOf(row.material, fallbackGrade)))].sort()) {
            const list = concrete.filter((row) => gradeOf(row.material, fallbackGrade) === grade);
            items.push(item(`งานคอนกรีตโครงสร้าง (fc' = ${grade} KSC. Cylinder)`, 'ลบ.ม.', list.map((row) => modelLine(`${row.work === 'footing' ? 'ฐานราก' : KIND_LABEL[row.kind]} ${shortType(row.type)} · ${row.count} ชิ้น`, row.volume)), /^งานคอนกรีตโครงสร้าง/));
        }
        const formwork = concrete.filter((row) => formworkOf(row, row.work) > 0);
        if (formwork.length) items.push(item('งานไม้แบบ', 'ตร.ม.', formwork.map((row) => modelLine(`${row.work === 'footing' ? 'ฐานราก' : KIND_LABEL[row.kind]} ${shortType(row.type)} · ผิวที่ต้องตั้งแบบ`, formworkOf(row, row.work))), /^งานไม้แบบ$/));
        const planks = here.filter((row) => row.work === 'plank');
        if (planks.length) items.push(item('งานพื้นสำเร็จรูป PS (ตามโมเดล)', 'ตร.ม.', planks.map((row) => modelLine(`${shortType(row.type)} · ${row.count} แผ่น`, row.bottom)), /พื้นสำเร็จรูป/));
        // เหล็กเสริมที่เขียนในโมเดล
        const bars = result.rebars.filter((row) => row.storey === storey);
        if (bars.length) {
            items.push({ id: id('i'), kind: 'heading', description: 'งานเหล็กเสริมคอนกรีต (เหล็กที่เขียนในโมเดล)', quantity: 0, materialPrice: 0, laborPrice: 0 });
            for (const bar of bars) items.push(item(rebarName(bar.diameter), 'กก.', [modelLine(`Ø${bar.diameter} · ${bar.count} เส้น · ยาวรวม ${round(bar.length)} ม. × ${rebarKgPerMeter(bar.diameter)} กก./ม.`, bar.weight)], /SD 40|SR 24/, { indent: true }));
            const weight = bars.reduce((sum, bar) => sum + bar.weight, 0);
            items.push(item('งานลวดผูกเหล็ก', 'กก.', [modelLine(`${ASSUMPTIONS.tieWirePercent}% ของเหล็กเสริม ${round(weight)} กก.`, (weight * ASSUMPTIONS.tieWirePercent) / 100)], /ลวดผูก/));
        }
        return { id: id('g'), title: storey, items };
    });
    // เหล็กเสริมในโมเดลน้อยเมื่อเทียบกับคอนกรีต → เตือนว่าอาจเขียนไม่ครบ
    const concreteVolume = rows.filter((row) => row.work === 'concrete' || row.work === 'footing').reduce((sum, row) => sum + row.volume, 0);
    const rebarWeight = result.rebars.reduce((sum, row) => sum + row.weight, 0);
    if (concreteVolume > 0 && rebarWeight / concreteVolume < 40) warnings.push(`เหล็กเสริมในโมเดล ${round(rebarWeight)} กก. (${round(rebarWeight / concreteVolume, 1)} กก./ลบ.ม.) น้อยกว่าปกติมาก (บ้านทั่วไปราว 80-120 กก./ลบ.ม.) — โมเดลน่าจะเขียนเหล็กเสริมไม่ครบ ตรวจและเพิ่มในใบ BOQ`);

    // ---------- หลังคาและเหล็กรูปพรรณ ----------
    const steel = rows.filter((row) => row.work === 'steel');
    const steelTypes = new Map<string, QtoRow[]>();
    for (const row of steel) steelTypes.set(shortType(row.type), [...(steelTypes.get(shortType(row.type)) ?? []), row]);
    const steelItems: Item[] = [...steelTypes].map(([type, list]) => item(`เหล็กรูปพรรณ ${type}`, 'กก.', list.map((row) => modelLine(`${row.storey} · ${row.count} ชิ้น · ยาวรวม ${round(row.length)} ม. (ปริมาตร ${round(row.volume, 4)} ลบ.ม. × ${ASSUMPTIONS.steelDensity})`, row.volume * ASSUMPTIONS.steelDensity)), /เหล็ก.*(C-|กล่อง)/));
    if (steel.length) steelItems.push(item('งานทาสีกันสนิม', 'ตร.ม.', steel.map((row) => modelLine(`${shortType(row.type)} · ผิวทั้งหมด`, row.side + row.top + row.bottom)), /ทาสีกันสนิม/));
    const roofItems: Item[] = [
        ...rows.filter((row) => row.work === 'roof').map((row) => item(`หลังคา ${shortType(row.type)} (ตามโมเดล)`, 'ตร.ม.', [modelLine(`${row.count} ชิ้น · พื้นที่ผิวบน`, row.top)], /^หลังคา/)),
        ...rows.filter((row) => row.work === 'fascia').map((row) => item(`ไม้เชิงชาย ${shortType(row.type)}`, 'เมตร', [modelLine(`${row.count} ชิ้น`, row.length)], /ไม้เชิงชาย/)),
        ...rows.filter((row) => row.work === 'gutter').map((row) => item('รางระบายน้ำฝน (ตามโมเดล)', 'เมตร', [modelLine(`${shortType(row.type)} · ${row.count} ชิ้น`, row.length)], /รางระบายน้ำฝน/))
    ];

    // ---------- อื่น ๆ ----------
    const otherRows = rows.filter((row) => row.work === 'precast' || row.work === 'other');
    const otherItems: Item[] = otherRows.map((row) =>
        row.work === 'precast' && row.length > 0
            ? item(`${shortType(row.type)} (${row.storey})`, 'เมตร', [modelLine(`${row.count} ชิ้น`, row.length)])
            : item(`${KIND_LABEL[row.kind] ?? row.kind} ${shortType(row.type)} (${row.storey})`, 'ชิ้น', [modelLine(`${row.material || 'ไม่ระบุวัสดุ'}`, row.count)])
    );

    const categories: Category[] = [{ id: id('c'), name: 'งานโครงสร้างคอนกรีตเสริมเหล็ก', groups }];
    if (steelItems.length || roofItems.length) {
        categories.push({
            id: id('c'),
            name: 'งานโครงหลังคา + วัสดุมุงหลังคา',
            groups: [...(steelItems.length ? [{ id: id('g'), title: 'งานเหล็กรูปพรรณ', items: steelItems }] : []), ...(roofItems.length ? [{ id: id('g'), title: 'งานวัสดุมุงหลังคา', items: roofItems }] : [])]
        });
    }
    if (otherItems.length) categories.push({ id: id('c'), name: 'ชิ้นงานอื่นในโมเดล (ตรวจและกำหนดรายการ)', excluded: true, groups: [{ id: id('g'), title: 'ชิ้นงานที่ระบบยังไม่ได้จัดเป็นรายการ BOQ', items: otherItems }] });
    if (unpriced) warnings.push(`${unpriced} รายการยังไม่มีราคาในคลังราคา ใส่ราคาเองในใบ BOQ`);

    return { categories, materials: materialList(rows, result.rebars, fallbackGrade), components: components(rows, result.rebars), warnings, unpriced };
}

// ---------- รายการวัสดุ ----------

const catalog = (pattern: RegExp) => materials.find((material) => material.active && pattern.test(material.name));

function materialList(rows: Array<QtoRow & { work: Work }>, rebars: RebarRow[], fallbackGrade: number): Material[] {
    const list: Material[] = [];
    const add = (name: string, unit: string, quantity: number, basis: string, code?: string) => quantity > 0 && list.push({ ...(code ? { materialCode: code } : {}), name, unit, quantity, basis });
    // คอนกรีตผสมเสร็จ: ปัดขึ้นทีละ 0.5 คิว
    const concrete = rows.filter((row) => row.work === 'concrete' || row.work === 'footing');
    for (const grade of [...new Set(concrete.map((row) => gradeOf(row.material, fallbackGrade)))].sort()) {
        const volume = concrete.filter((row) => gradeOf(row.material, fallbackGrade) === grade).reduce((sum, row) => sum + row.volume, 0);
        const match = catalog(new RegExp(`คอนกรีตผสมเสร็จ ${grade}`));
        add(match?.name ?? `คอนกรีตผสมเสร็จ ${grade} ksc`, match?.unit ?? 'คิว', Math.ceil(volume * (1 + ASSUMPTIONS.concreteWaste / 100) * 2) / 2, `${round(volume)} ลบ.ม. + เผื่อ ${ASSUMPTIONS.concreteWaste}%`, match?.code);
    }
    // เหล็กเส้น: แปลงเป็นเส้นยาว 10 ม. เมื่อรายการวัสดุนับเป็นเส้น
    const byDiameter = new Map<number, number>();
    for (const bar of rebars) byDiameter.set(bar.diameter, (byDiameter.get(bar.diameter) ?? 0) + bar.weight);
    let rebarTotal = 0;
    for (const [diameter, weight] of [...byDiameter].sort((a, b) => a[0] - b[0])) {
        rebarTotal += weight;
        const withWaste = weight * (1 + ASSUMPTIONS.rebarWaste / 100);
        const match = catalog(new RegExp(`(RB|DB)${diameter}\\b`));
        if (match?.unit === 'เส้น') add(match.name, 'เส้น', Math.ceil(withWaste / (rebarKgPerMeter(diameter) * 10)), `${round(weight)} กก. + เผื่อต่อทาบ/เสีย ${ASSUMPTIONS.rebarWaste}% ÷ ${round(rebarKgPerMeter(diameter) * 10, 2)} กก./เส้น 10 ม.`, match.code);
        else add(`เหล็กเส้น ${rebarName(diameter)}`, 'กก.', Math.ceil(withWaste), `${round(weight)} กก. + เผื่อ ${ASSUMPTIONS.rebarWaste}%`);
    }
    const wire = catalog(/ลวดผูกเหล็ก/);
    add(wire?.name ?? 'ลวดผูกเหล็ก', wire?.unit ?? 'กก.', Math.ceil((rebarTotal * ASSUMPTIONS.tieWirePercent) / 100), `${ASSUMPTIONS.tieWirePercent}% ของเหล็กเสริม`, wire?.code);
    const formwork = concrete.reduce((sum, row) => sum + formworkOf(row, row.work), 0);
    const plywood = catalog(/ไม้แบบ/);
    add(plywood?.name ?? 'ไม้แบบ (ไม้อัด 120×240 ซม.)', plywood?.unit ?? 'แผ่น', Math.ceil(formwork / ASSUMPTIONS.plywoodArea / ASSUMPTIONS.formworkReuse), `ผิวแบบ ${round(formwork)} ตร.ม. ÷ ${ASSUMPTIONS.plywoodArea} ตร.ม./แผ่น ÷ ใช้ซ้ำ ${ASSUMPTIONS.formworkReuse} ครั้ง`, plywood?.code);
    for (const row of rows.filter((r) => r.work === 'pile')) add(`เสาเข็ม ${shortType(row.type)}`, 'ต้น', row.count, `ตามโมเดล ${row.storey}`);
    const planks = rows.filter((row) => row.work === 'plank');
    if (planks.length) add('แผ่นพื้นสำเร็จรูป PS', 'ตร.ม.', Math.ceil(planks.reduce((sum, row) => sum + row.bottom, 0)), `ตามโมเดล ${planks.reduce((sum, row) => sum + row.count, 0)} แผ่น`);
    const steelTypes = new Map<string, number>();
    for (const row of rows.filter((r) => r.work === 'steel')) steelTypes.set(shortType(row.type), (steelTypes.get(shortType(row.type)) ?? 0) + row.volume * ASSUMPTIONS.steelDensity);
    for (const [type, weight] of steelTypes) add(`เหล็กรูปพรรณ ${type}`, 'กก.', Math.ceil(weight * (1 + ASSUMPTIONS.steelWaste / 100)), `${round(weight)} กก. + เผื่อ ${ASSUMPTIONS.steelWaste}%`);
    const roof = rows.filter((row) => row.work === 'roof').reduce((sum, row) => sum + row.top, 0);
    add('วัสดุมุงหลังคา (ตามโมเดล)', 'ตร.ม.', Math.ceil(roof * (1 + ASSUMPTIONS.roofWaste / 100)), `${round(roof)} ตร.ม. + เผื่อซ้อนทับ/เสีย ${ASSUMPTIONS.roofWaste}%`);
    return list;
}

function components(rows: Array<QtoRow & { work: Work }>, rebars: RebarRow[]): ApiSchemas['EstimateSource']['components'] {
    return [
        ...rows.map((row) => ({
            storey: row.storey,
            kind: row.work,
            label: `${KIND_LABEL[row.kind] ?? row.kind} ${shortType(row.type)}`,
            ...(row.material ? { material: row.material } : {}),
            count: row.count,
            volume: round(row.volume, 3),
            area: round(row.work === 'plank' ? row.bottom : row.work === 'roof' ? row.top : formworkOf(row, row.work), 2),
            length: round(row.length, 2),
            weight: round(row.work === 'steel' ? row.volume * ASSUMPTIONS.steelDensity : 0, 1)
        })),
        ...rebars.map((bar) => ({ storey: bar.storey, kind: 'rebar', label: `เหล็กเสริม Ø${bar.diameter}`, count: bar.count, volume: 0, area: 0, length: bar.length, weight: bar.weight }))
    ];
}
