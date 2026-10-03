/**
 * แปลงไฟล์ IFC (ส่งออกจาก Revit / SketchUp / โปรแกรม BIM อื่น) เป็น .glb ด้วย web-ifc
 * - แยก geometry เป็นกลุ่มตาม งาน × หมวด × ชั้น × ระบบ (1 node ต่อกลุ่ม) ให้ตัวดูเปิด/ปิดแยกตามมุมใดก็ได้
 *   ค่าของแต่ละกลุ่มอยู่ใน extras ของ node (discipline, category, storey, system, elements)
 *   รายชื่อชั้นเรียงตามระดับอยู่ใน extras ของ node ราก (source = 'ifc')
 * - เหล็กเสริม (IfcReinforcingBar ที่เป็น IfcSweptDiskSolid) web-ifc สร้างรูปทรงไม่ได้ จึงสร้างท่อตามแนวเหล็กเอง
 * ใช้เวลาหลายวินาทีถึงหลายนาที — เรียกจาก worker thread เท่านั้น (skp-worker.ts)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { GlbNode, GlbPart, newPart, pushNormal, writeGlb } from './glb-writer.js';

type WebIfcModule = typeof import('web-ifc');
const WebIFC = createRequire(import.meta.url)('web-ifc') as WebIfcModule;

export interface IfcConvertResult {
    triangles: number;
    elements: number;
    groups: number;
    rebars: number;
    bytes: number;
}

type Discipline = 'สถาปัตย์' | 'โครงสร้าง' | 'เหล็กเสริม' | 'ประปา/สุขาภิบาล' | 'ปรับอากาศ' | 'ไฟฟ้า' | 'งานระบบอื่น ๆ' | 'อื่น ๆ';

/** ประเภท IFC → งาน และชื่อหมวดภาษาไทย (ไม่มีในรายการ = สถาปัตย์ ชื่อตามประเภท) */
const CLASSES: Record<string, [Discipline, string]> = {
    IFCWALL: ['สถาปัตย์', 'ผนัง'],
    IFCWALLSTANDARDCASE: ['สถาปัตย์', 'ผนัง'],
    IFCCURTAINWALL: ['สถาปัตย์', 'ผนังกระจก'],
    IFCMEMBER: ['สถาปัตย์', 'โครงเคร่า (Member)'],
    IFCPLATE: ['สถาปัตย์', 'แผ่นปิด (Plate)'],
    IFCDOOR: ['สถาปัตย์', 'ประตู'],
    IFCWINDOW: ['สถาปัตย์', 'หน้าต่าง'],
    IFCROOF: ['สถาปัตย์', 'หลังคา'],
    IFCCOVERING: ['สถาปัตย์', 'ฝ้า/วัสดุปิดผิว'],
    IFCRAILING: ['สถาปัตย์', 'ราวกันตก'],
    IFCSTAIR: ['สถาปัตย์', 'บันได'],
    IFCSTAIRFLIGHT: ['สถาปัตย์', 'บันได'],
    IFCRAMP: ['สถาปัตย์', 'ทางลาด'],
    IFCRAMPFLIGHT: ['สถาปัตย์', 'ทางลาด'],
    IFCFURNISHINGELEMENT: ['สถาปัตย์', 'เฟอร์นิเจอร์'],
    IFCFURNITURE: ['สถาปัตย์', 'เฟอร์นิเจอร์'],
    IFCSYSTEMFURNITUREELEMENT: ['สถาปัตย์', 'เฟอร์นิเจอร์'],
    IFCSLAB: ['โครงสร้าง', 'พื้น'],
    IFCBEAM: ['โครงสร้าง', 'คาน'],
    IFCCOLUMN: ['โครงสร้าง', 'เสา'],
    IFCFOOTING: ['โครงสร้าง', 'ฐานราก'],
    IFCPILE: ['โครงสร้าง', 'เสาเข็ม'],
    IFCREINFORCINGBAR: ['เหล็กเสริม', 'เหล็กเสริม'],
    IFCREINFORCINGMESH: ['เหล็กเสริม', 'ตะแกรงเหล็ก'],
    IFCTENDON: ['เหล็กเสริม', 'ลวดอัดแรง'],
    IFCPIPESEGMENT: ['ประปา/สุขาภิบาล', 'ท่อ'],
    IFCPIPEFITTING: ['ประปา/สุขาภิบาล', 'ข้อต่อท่อ'],
    IFCSANITARYTERMINAL: ['ประปา/สุขาภิบาล', 'สุขภัณฑ์'],
    IFCWASTETERMINAL: ['ประปา/สุขาภิบาล', 'ท่อระบาย/รูระบาย'],
    IFCVALVE: ['ประปา/สุขาภิบาล', 'วาล์ว'],
    IFCPUMP: ['ประปา/สุขาภิบาล', 'ปั๊มน้ำ'],
    IFCTANK: ['ประปา/สุขาภิบาล', 'ถังเก็บน้ำ'],
    IFCFIRESUPPRESSIONTERMINAL: ['ประปา/สุขาภิบาล', 'หัวกระจายน้ำดับเพลิง'],
    IFCDUCTSEGMENT: ['ปรับอากาศ', 'ท่อลม'],
    IFCDUCTFITTING: ['ปรับอากาศ', 'ข้อต่อท่อลม'],
    IFCAIRTERMINAL: ['ปรับอากาศ', 'หัวจ่ายลม'],
    IFCDAMPER: ['ปรับอากาศ', 'แดมเปอร์'],
    IFCFAN: ['ปรับอากาศ', 'พัดลม'],
    IFCUNITARYEQUIPMENT: ['ปรับอากาศ', 'เครื่องปรับอากาศ'],
    IFCCABLECARRIERSEGMENT: ['ไฟฟ้า', 'รางเดินสาย'],
    IFCCABLECARRIERFITTING: ['ไฟฟ้า', 'ข้อต่อรางสาย'],
    IFCCABLESEGMENT: ['ไฟฟ้า', 'สายไฟ'],
    IFCCABLEFITTING: ['ไฟฟ้า', 'ข้อต่อสายไฟ'],
    IFCLIGHTFIXTURE: ['ไฟฟ้า', 'โคมไฟ'],
    IFCLAMP: ['ไฟฟ้า', 'หลอดไฟ'],
    IFCOUTLET: ['ไฟฟ้า', 'เต้ารับ'],
    IFCSWITCHINGDEVICE: ['ไฟฟ้า', 'สวิตช์'],
    IFCJUNCTIONBOX: ['ไฟฟ้า', 'กล่องต่อสาย'],
    IFCELECTRICDISTRIBUTIONBOARD: ['ไฟฟ้า', 'ตู้ไฟ'],
    IFCELECTRICAPPLIANCE: ['ไฟฟ้า', 'เครื่องใช้ไฟฟ้า'],
    IFCPROTECTIVEDEVICE: ['ไฟฟ้า', 'อุปกรณ์ป้องกัน'],
    IFCBUILDINGELEMENTPROXY: ['อื่น ๆ', 'ชิ้นงานอื่น ๆ'],
    IFCSITE: ['อื่น ๆ', 'ที่ดิน/ภูมิทัศน์'],
    IFCGEOGRAPHICELEMENT: ['อื่น ๆ', 'ที่ดิน/ภูมิทัศน์']
};

/** ประเภทงานระบบทั่วไป (IFC2x3) แยกงานจากชื่อระบบ */
const GENERIC_FLOW: Record<string, string> = {
    IFCFLOWSEGMENT: 'ท่อ/ราง',
    IFCFLOWFITTING: 'ข้อต่อ',
    IFCFLOWTERMINAL: 'อุปกรณ์ปลายทาง',
    IFCFLOWCONTROLLER: 'อุปกรณ์ควบคุม',
    IFCFLOWMOVINGDEVICE: 'ปั๊ม/พัดลม',
    IFCFLOWSTORAGEDEVICE: 'ถังเก็บ',
    IFCFLOWTREATMENTDEVICE: 'อุปกรณ์บำบัด',
    IFCENERGYCONVERSIONDEVICE: 'เครื่องจักรงานระบบ',
    IFCDISTRIBUTIONELEMENT: 'อุปกรณ์งานระบบ',
    IFCDISTRIBUTIONCONTROLELEMENT: 'อุปกรณ์ควบคุม'
};

/** ไม่แสดง (ช่องเปิด พื้นที่ห้อง เส้นอ้างอิง) */
const SKIP = new Set(['IFCOPENINGELEMENT', 'IFCSPACE', 'IFCANNOTATION', 'IFCGRID', 'IFCVIRTUALELEMENT']);

const disciplineFromSystem = (system: string): Discipline =>
    /air|duct|hvac|exhaust|supply|return|ventilat|อากาศ|ลม/i.test(system)
        ? 'ปรับอากาศ'
        : /water|sanitary|waste|vent|plumb|drain|sewer|storm|fire|sprinkler|น้ำ|ประปา|สุขา/i.test(system)
          ? 'ประปา/สุขาภิบาล'
          : /power|light|elect|data|comm|ไฟ/i.test(system)
            ? 'ไฟฟ้า'
            : 'งานระบบอื่น ๆ';

const NO_STOREY = 'ไม่ระบุชั้น';
const NO_SYSTEM = 'ไม่อยู่ในระบบ';
const REBAR_COLOR: [number, number, number] = [176, 98, 66];
const REBAR_SIDES = 6;

type Mat = number[];
/** คูณเมทริกซ์ 4×4 column-major */
const mul = (a: Mat, b: Mat): Mat => {
    const r = new Array<number>(16).fill(0);
    for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) r[c * 4 + row]! += a[k * 4 + row]! * b[c * 4 + k]!;
    return r;
};
const apply = (m: Mat, x: number, y: number, z: number): [number, number, number] => [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
];
const det3 = (m: Mat) => m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** แกน Z-up ของ IFC → Y-up (เหมือนที่ web-ifc ใช้) */
const NORMALIZE_IFC: Mat = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];

export async function convertIfcToGlb(input: string, output: string): Promise<IfcConvertResult> {
    const api = new WebIFC.IfcAPI();
    await api.Init();
    api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF);
    const model = api.OpenModel(new Uint8Array(readFileSync(input)), { COORDINATE_TO_ORIGIN: true });
    try {
        const ids = (type: number): number[] => {
            const vector = api.GetLineIDsWithType(model, type, true);
            return Array.from({ length: vector.size() }, (_, i) => vector.get(i));
        };
        const typeName = (id: number) => String(api.GetNameFromTypeCode(api.GetLineType(model, id))).toUpperCase();
        const text = (attribute: { value?: unknown } | null | undefined) => (attribute?.value === undefined || attribute.value === null ? '' : String(attribute.value));
        const line = (id: number) => api.GetLine(model, id);

        // ---------- หน่วยความยาวของโปรเจกต์ → เมตร ----------
        const PREFIX: Record<string, number> = { MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 };
        let lengthScale = 1;
        const project = ids(WebIFC.IFCPROJECT)[0];
        const units = project !== undefined ? line(line(project).UnitsInContext?.value)?.Units ?? [] : [];
        for (const ref of units) {
            const unit = line(ref.value);
            if (text(unit.UnitType) !== 'LENGTHUNIT') continue;
            if (unit.Prefix !== undefined || unit.Name?.value === 'METRE') lengthScale = PREFIX[text(unit.Prefix)] ?? 1;
            else if (/FOOT/i.test(text(unit.Name))) lengthScale = 0.3048;
            else if (/INCH/i.test(text(unit.Name))) lengthScale = 0.0254;
        }

        // ---------- ลำดับชั้นพื้นที่ → ชั้นของชิ้นงาน ----------
        const parent = new Map<number, number>();
        for (const id of ids(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
            const rel = line(id);
            for (const element of rel.RelatedElements ?? []) parent.set(element.value, rel.RelatingStructure.value);
        }
        for (const id of ids(WebIFC.IFCRELAGGREGATES)) {
            const rel = line(id);
            for (const child of rel.RelatedObjects ?? []) if (!parent.has(child.value)) parent.set(child.value, rel.RelatingObject.value);
        }
        const storeyInfo = new Map<number, { name: string; elevation: number }>();
        for (const id of ids(WebIFC.IFCBUILDINGSTOREY)) {
            const storey = line(id);
            storeyInfo.set(id, { name: text(storey.Name) || text(storey.LongName) || `ชั้น #${id}`, elevation: Number(storey.Elevation?.value ?? 0) * lengthScale });
        }
        const storeyCache = new Map<number, string>();
        const storeyOf = (id: number): string => {
            const cached = storeyCache.get(id);
            if (cached !== undefined) return cached;
            let current: number | undefined = id;
            let result = NO_STOREY;
            for (let depth = 0; current !== undefined && depth < 20; depth++) {
                const info = storeyInfo.get(current);
                if (info) {
                    result = info.name;
                    break;
                }
                current = parent.get(current);
            }
            storeyCache.set(id, result);
            return result;
        };

        // ---------- ระบบ (IfcSystem / IfcDistributionSystem / IfcBuildingSystem) ----------
        const systemDirect = new Map<number, string>();
        for (const id of ids(WebIFC.IFCRELASSIGNSTOGROUP)) {
            const rel = line(id);
            if (!/SYSTEM/.test(typeName(rel.RelatingGroup.value))) continue;
            // Revit ตั้งชื่อระบบเป็นเลขรายวงจร เช่น "Mechanical Supply Air 18" → รวมเป็นประเภทระบบ "Mechanical Supply Air"
            const name = text(line(rel.RelatingGroup.value).Name).replace(/\s+\d+$/, '') || 'ระบบไม่มีชื่อ';
            for (const object of rel.RelatedObjects ?? []) if (!systemDirect.has(object.value)) systemDirect.set(object.value, name);
        }
        const systemOf = (id: number): string => {
            let current: number | undefined = id;
            for (let depth = 0; current !== undefined && depth < 10; depth++) {
                const system = systemDirect.get(current);
                if (system) return system;
                const next = parent.get(current);
                // หยุดเมื่อขึ้นไปถึงโครงสร้างพื้นที่ (ชั้น/อาคาร) ไม่ใช่ชิ้นงานแม่
                if (next === undefined || storeyInfo.has(next) || /BUILDING$|SITE$|PROJECT$|SPACE$/.test(typeName(next))) break;
                current = next;
            }
            return NO_SYSTEM;
        };

        // ---------- จัดกลุ่ม ----------
        const lengthToMm = (value: number) => Math.round(value * lengthScale * 1000);
        const classify = (id: number): { discipline: Discipline; category: string; system: string } | null => {
            const cls = typeName(id);
            if (SKIP.has(cls)) return null;
            const system = systemOf(id);
            if (GENERIC_FLOW[cls]) return { discipline: disciplineFromSystem(system), category: GENERIC_FLOW[cls]!, system };
            const [discipline, label] = CLASSES[cls] ?? ['สถาปัตย์', cls.replace(/^IFC/, '').toLowerCase()];
            let category = label;
            // เหล็กเสริมแยกหมวดตามขนาด เช่น "เหล็กเสริม Ø12"
            if (cls === 'IFCREINFORCINGBAR') {
                const diameter = Number(line(id).NominalDiameter?.value);
                if (diameter > 0) category = `เหล็กเสริม Ø${lengthToMm(diameter)}`;
            }
            return { discipline, category, system };
        };

        interface Group {
            discipline: Discipline;
            category: string;
            storey: string;
            system: string;
            elements: Set<number>;
            parts: Map<string, GlbPart>;
        }
        const groups = new Map<string, Group>();
        const groupOf = (id: number, info: { discipline: Discipline; category: string; system: string }): Group => {
            const storey = storeyOf(id);
            const key = `${info.discipline}|${info.category}|${storey}|${info.system}`;
            let group = groups.get(key);
            if (!group) groups.set(key, (group = { ...info, storey, elements: new Set(), parts: new Map() }));
            group.elements.add(id);
            return group;
        };
        const partOf = (group: Group, color: [number, number, number], alpha: number): GlbPart => {
            const key = `${color.join(',')},${alpha.toFixed(2)}`;
            let part = group.parts.get(key);
            if (!part) group.parts.set(key, (part = newPart(key, color, alpha)));
            return part;
        };

        // ---------- geometry จาก web-ifc ----------
        let triangles = 0;
        const produced = new Set<number>();
        const classCache = new Map<number, ReturnType<typeof classify>>();
        api.StreamAllMeshes(
            model,
            (mesh) => {
                const id = mesh.expressID;
                if (!classCache.has(id)) classCache.set(id, classify(id));
                const info = classCache.get(id);
                const placed = mesh.geometries;
                if (!info || !placed.size()) return;
                produced.add(id);
                const group = groupOf(id, info);
                for (let i = 0; i < placed.size(); i++) {
                    const pg = placed.get(i);
                    const geometry = api.GetGeometry(model, pg.geometryExpressID);
                    const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
                    const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
                    const color: [number, number, number] = [Math.round(pg.color.x * 255), Math.round(pg.color.y * 255), Math.round(pg.color.z * 255)];
                    const part = partOf(group, color, pg.color.w);
                    const m = pg.flatTransformation;
                    const base = part.vertexCount;
                    for (let v = 0; v < vertices.length; v += 6) {
                        const [x, y, z] = apply(m, vertices[v]!, vertices[v + 1]!, vertices[v + 2]!);
                        part.positions.push3(x, y, z);
                        const nx = m[0]! * vertices[v + 3]! + m[4]! * vertices[v + 4]! + m[8]! * vertices[v + 5]!;
                        const ny = m[1]! * vertices[v + 3]! + m[5]! * vertices[v + 4]! + m[9]! * vertices[v + 5]!;
                        const nz = m[2]! * vertices[v + 3]! + m[6]! * vertices[v + 4]! + m[10]! * vertices[v + 5]!;
                        pushNormal(part, nx, ny, nz);
                    }
                    const flip = det3(m) < 0;
                    for (let t = 0; t < indices.length; t += 3) {
                        if (flip) part.indices.push3(base + indices[t]!, base + indices[t + 2]!, base + indices[t + 1]!);
                        else part.indices.push3(base + indices[t]!, base + indices[t + 1]!, base + indices[t + 2]!);
                    }
                    part.vertexCount += vertices.length / 6;
                    triangles += indices.length / 3;
                    geometry.delete();
                }
            },
            true
        );

        // ---------- เหล็กเสริมที่ web-ifc สร้างรูปทรงไม่ได้: ท่อตามแนวเหล็ก ----------
        // ตำแหน่งจริง = Coordination × (Z-up → Y-up) × หน่วย × ตำแหน่งชิ้นงาน × MappedItem (สูตรเดียวกับ web-ifc)
        const coordination = api.GetCoordinationMatrix(model);
        const scale: Mat = [lengthScale, 0, 0, 0, 0, lengthScale, 0, 0, 0, 0, lengthScale, 0, 0, 0, 0, 1];
        const toWorld = mul(coordination, mul(NORMALIZE_IFC, scale));
        let rebars = 0;
        for (const id of [...ids(WebIFC.IFCREINFORCINGBAR), ...ids(WebIFC.IFCREINFORCINGMESH)]) {
            if (produced.has(id)) continue;
            const info = classify(id);
            const bar = line(id);
            if (!info || !bar.Representation) continue;
            const placement = bar.ObjectPlacement ? api.GetWorldTransformMatrix(model, bar.ObjectPlacement.value) : IDENTITY;
            const base = mul(toWorld, placement);
            let made = false;
            for (const rep of line(bar.Representation.value).Representations ?? []) {
                for (const itemRef of line(rep.value).Items ?? []) {
                    for (const { solid, matrix } of sweptSolids(itemRef.value, IDENTITY)) {
                        const points = directrixPoints(solid.Directrix?.value);
                        if (points.length < 2) continue;
                        const world = mul(base, matrix);
                        const path = points.map(([x, y, z]) => apply(world, x, y, z));
                        const radius = Number(solid.Radius?.value ?? 0) * lengthScale * Math.cbrt(Math.abs(det3(matrix)) || 1);
                        if (!(radius > 0)) continue;
                        triangles += tube(partOf(groupOf(id, info), REBAR_COLOR, 1), path, radius);
                        made = true;
                    }
                }
            }
            if (made) rebars++;
        }

        /** IfcSweptDiskSolid ทั้งหมดในชิ้นงาน (รวมที่อยู่ใน IfcMappedItem / IfcBooleanResult) พร้อมเมทริกซ์ของ mapped item */
        function sweptSolids(itemId: number, matrix: Mat, depth = 0): Array<{ solid: ReturnType<typeof line>; matrix: Mat }> {
            if (depth > 6) return [];
            const kind = typeName(itemId);
            const item = line(itemId);
            if (kind === 'IFCSWEPTDISKSOLID' || kind === 'IFCSWEPTDISKSOLIDPOLYGONAL') return [{ solid: item, matrix }];
            if (kind === 'IFCMAPPEDITEM') {
                const source = line(item.MappingSource.value);
                const origin = source.MappingOrigin ? axis2Placement(source.MappingOrigin.value) : IDENTITY;
                const target = item.MappingTarget ? transformationOperator(item.MappingTarget.value) : IDENTITY;
                const mapped = mul(matrix, mul(target, origin));
                return (line(source.MappedRepresentation.value).Items ?? []).flatMap((child: { value: number }) => sweptSolids(child.value, mapped, depth + 1));
            }
            if (kind === 'IFCBOOLEANRESULT' || kind === 'IFCBOOLEANCLIPPINGRESULT') return sweptSolids(item.FirstOperand.value, matrix, depth + 1);
            return [];
        }

        /** จุดของแนวเส้น (หน่วยของไฟล์) รองรับ polyline, composite curve, trimmed line/circle, indexed poly curve */
        function directrixPoints(curveId: number | undefined, depth = 0): Array<[number, number, number]> {
            if (curveId === undefined || depth > 6) return [];
            const kind = typeName(curveId);
            const curve = line(curveId);
            const point = (ref: { value: number }): [number, number, number] => {
                const c = line(ref.value).Coordinates.map((v: { value: number }) => Number(v.value));
                return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
            };
            if (kind === 'IFCPOLYLINE') return curve.Points.map(point);
            if (kind === 'IFCCOMPOSITECURVE') {
                const result: Array<[number, number, number]> = [];
                for (const segRef of curve.Segments ?? []) {
                    const seg = line(segRef.value);
                    let points = directrixPoints(seg.ParentCurve?.value, depth + 1);
                    if (seg.SameSense?.value === false) points = points.reverse();
                    for (const p of points) {
                        const last = result[result.length - 1];
                        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 1e-9) result.push(p);
                    }
                }
                return result;
            }
            if (kind === 'IFCTRIMMEDCURVE') return trimmedPoints(curve, depth);
            if (kind === 'IFCINDEXEDPOLYCURVE') {
                const coords: Array<[number, number, number]> = line(curve.Points.value).CoordList.map((row: Array<{ value: number }>) => [Number(row[0]?.value ?? 0), Number(row[1]?.value ?? 0), Number(row[2]?.value ?? 0)]);
                if (!curve.Segments?.length) return coords;
                const result: Array<[number, number, number]> = [];
                for (const segment of curve.Segments) {
                    const indices: number[] = (segment.value ?? segment).map((v: { value: number }) => Number(v.value ?? v) - 1);
                    const points = indices.length === 3 ? arcThrough(coords[indices[0]!]!, coords[indices[1]!]!, coords[indices[2]!]!) : indices.map((i) => coords[i]!);
                    for (const p of points) if (!result.length || result[result.length - 1] !== p) result.push(p);
                }
                return result;
            }
            return [];
        }

        /** ส่วนของเส้นตรง/วงกลมที่ตัดด้วยพารามิเตอร์หรือจุด */
        function trimmedPoints(curve: ReturnType<typeof line>, depth: number): Array<[number, number, number]> {
            const basisKind = typeName(curve.BasisCurve.value);
            const basis = line(curve.BasisCurve.value);
            // ค่าตัดเป็นได้ทั้งพารามิเตอร์ (ตัวเลข) และจุด (ref type 5) — ใช้พารามิเตอร์
            const param = (list: Array<{ value: unknown; type?: number }>) => {
                const found = list.find((t) => t.type !== 5 && typeof t.value === 'number');
                return found ? Number(found.value) : undefined;
            };
            const t1 = param(curve.Trim1 ?? []);
            const t2 = param(curve.Trim2 ?? []);
            if (basisKind === 'IFCLINE') {
                const p = line(basis.Pnt.value).Coordinates.map((v: { value: number }) => Number(v.value));
                const dir = line(basis.Dir.value);
                const d = line(dir.Orientation.value).DirectionRatios.map((v: { value: number }) => Number(v.value));
                const magnitude = Number(dir.Magnitude?.value ?? 1);
                const at = (t: number): [number, number, number] => [p[0] + d[0] * t * magnitude, p[1] + d[1] * t * magnitude, (p[2] ?? 0) + (d[2] ?? 0) * t * magnitude];
                return [at(t1 ?? 0), at(t2 ?? 1)];
            }
            if (basisKind === 'IFCCIRCLE') {
                const m = axis2Placement(basis.Position.value);
                const r = Number(basis.Radius.value);
                let a1 = ((t1 ?? 0) * Math.PI) / 180;
                let a2 = ((t2 ?? 360) * Math.PI) / 180;
                // พารามิเตอร์มุมอาจเป็นเรเดียน (ค่าเล็ก) หรือองศา
                if (Math.abs(t1 ?? 0) <= 2 * Math.PI + 1e-6 && Math.abs(t2 ?? 0) <= 2 * Math.PI + 1e-6) {
                    a1 = t1 ?? 0;
                    a2 = t2 ?? 2 * Math.PI;
                }
                if (curve.SenseAgreement?.value === false) [a1, a2] = [a2, a1];
                if (a2 < a1) a2 += 2 * Math.PI;
                const steps = Math.max(4, Math.ceil(((a2 - a1) / (Math.PI / 2)) * 4));
                return Array.from({ length: steps + 1 }, (_, i) => {
                    const a = a1 + ((a2 - a1) * i) / steps;
                    return apply(m, r * Math.cos(a), r * Math.sin(a), 0);
                });
            }
            return directrixPoints(curve.BasisCurve.value, depth + 1);
        }

        /** IfcAxis2Placement3D/2D → เมทริกซ์ */
        function axis2Placement(id: number): Mat {
            const placement = line(id);
            const location = placement.Location ? line(placement.Location.value).Coordinates.map((v: { value: number }) => Number(v.value)) : [0, 0, 0];
            const vec = (ref: { value: number } | undefined, fallback: number[]) => (ref ? line(ref.value).DirectionRatios.map((v: { value: number }) => Number(v.value)) : fallback);
            const z = normalize(vec(placement.Axis, [0, 0, 1]));
            let x = normalize(vec(placement.RefDirection, [1, 0, 0]));
            x = normalize(sub(x, scaleVec(z, dot(x, z))));
            const y = cross(z, x);
            return [x[0]!, x[1]!, x[2] ?? 0, 0, y[0]!, y[1]!, y[2]!, 0, z[0]!, z[1]!, z[2]!, 0, location[0] ?? 0, location[1] ?? 0, location[2] ?? 0, 1];
        }

        /** IfcCartesianTransformationOperator3D → เมทริกซ์ */
        function transformationOperator(id: number): Mat {
            const op = line(id);
            const origin = line(op.LocalOrigin.value).Coordinates.map((v: { value: number }) => Number(v.value));
            const vec = (ref: { value: number } | undefined, fallback: number[]) => (ref ? normalize(line(ref.value).DirectionRatios.map((v: { value: number }) => Number(v.value))) : fallback);
            const x = vec(op.Axis1, [1, 0, 0]);
            const y = vec(op.Axis2, [0, 1, 0]);
            const z = vec(op.Axis3, [0, 0, 1]);
            const s = Number(op.Scale?.value ?? 1);
            return [x[0]! * s, x[1]! * s, x[2]! * s, 0, y[0]! * s, y[1]! * s, y[2]! * s, 0, z[0]! * s, z[1]! * s, z[2]! * s, 0, origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0, 1];
        }

        // ---------- เขียนไฟล์ ----------
        const storeyOrder = [...storeyInfo.values()].sort((a, b) => a.elevation - b.elevation).map((storey) => storey.name);
        const nodes: GlbNode[] = [...groups.values()]
            .filter((group) => [...group.parts.values()].some((part) => part.vertexCount))
            .map((group) => ({
                name: group.category,
                extras: { name: group.category, kind: 'ifc-group', discipline: group.discipline, category: group.category, storey: group.storey, system: group.system, elements: group.elements.size },
                parts: [...group.parts.values()]
            }));
        if (!nodes.length) throw new Error('ไม่พบรูปทรงในไฟล์ IFC');
        const elements = nodes.reduce((sum, node) => sum + Number(node.extras!['elements']), 0);
        const glb = writeGlb({ name: 'model', extras: { source: 'ifc', storeys: [...new Set([...storeyOrder, NO_STOREY])] }, children: nodes }, 'cm-planning ifc-to-glb');
        writeFileSync(output, glb);
        return { triangles, elements, groups: nodes.length, rebars, bytes: glb.length };
    } finally {
        api.CloseModel(model);
    }
}

// ---------- เรขาคณิต ----------

const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, (a[2] ?? 0) - (b[2] ?? 0)];
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + (a[2] ?? 0) * (b[2] ?? 0);
const cross = (a: number[], b: number[]) => [a[1]! * (b[2] ?? 0) - (a[2] ?? 0) * b[1]!, (a[2] ?? 0) * b[0]! - a[0]! * (b[2] ?? 0), a[0]! * b[1]! - a[1]! * b[0]!];
const scaleVec = (a: number[], s: number) => a.map((v) => v * s);
const normalize = (a: number[]) => {
    const v = [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
    const length = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
    return v.map((x) => x / length);
};

/** จุดบนส่วนโค้งผ่าน 3 จุด (IfcArcIndex) */
function arcThrough(a: [number, number, number], b: [number, number, number], c: [number, number, number]): Array<[number, number, number]> {
    const ab = sub(b, a);
    const ac = sub(c, a);
    const normal = cross(ab, ac);
    const n2 = dot(normal, normal);
    if (n2 < 1e-12) return [a, b, c];
    const center = a.map((v, i) => v + (scaleVec(cross(normal, ab), dot(ac, ac)).map((x, k) => x + scaleVec(cross(ac, normal), dot(ab, ab))[k]!)[i]! / (2 * n2))) as [number, number, number];
    const u = normalize(sub(a, center));
    const w = normalize(normal);
    const v = cross(w, u);
    const radius = Math.hypot(...sub(a, center));
    const angle = (p: number[]) => {
        const d = sub(p, center);
        let t = Math.atan2(dot(d, v), dot(d, u));
        if (t < 0) t += 2 * Math.PI;
        return t;
    };
    const end = angle(c);
    const steps = Math.max(4, Math.ceil((end / (Math.PI / 2)) * 4));
    return Array.from({ length: steps + 1 }, (_, i) => {
        const t = (end * i) / steps;
        return center.map((x, k) => x + radius * (Math.cos(t) * u[k]! + Math.sin(t) * v[k]!)) as [number, number, number];
    });
}

/** ท่อกลมตามแนวจุด (พิกัดโลก เมตร) → เพิ่มลง part คืนจำนวนสามเหลี่ยม */
function tube(part: GlbPart, path: Array<[number, number, number]>, radius: number): number {
    const points = path.filter((p, i) => i === 0 || Math.hypot(p[0] - path[i - 1]![0], p[1] - path[i - 1]![1], p[2] - path[i - 1]![2]) > 1e-6);
    if (points.length < 2) return 0;
    // ทิศของแต่ละจุด (เฉลี่ยมุมหักเพื่อไม่ให้ท่อบีบ)
    const tangents = points.map((_, i) => {
        const prev = normalize(sub(points[i]!, points[Math.max(0, i - 1)]!));
        const next = normalize(sub(points[Math.min(points.length - 1, i + 1)]!, points[i]!));
        if (i === 0) return next;
        if (i === points.length - 1) return prev;
        return normalize([prev[0]! + next[0]!, prev[1]! + next[1]!, prev[2]! + next[2]!]);
    });
    // กรอบอ้างอิงที่ส่งต่อตามแนว (parallel transport) กันท่อบิด
    let normal = normalize(cross(tangents[0]!, Math.abs(tangents[0]![1]!) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const base = part.vertexCount;
    for (let i = 0; i < points.length; i++) {
        const t = tangents[i]!;
        normal = normalize(sub(normal, scaleVec(t, dot(normal, t))));
        const binormal = cross(t, normal);
        for (let s = 0; s < REBAR_SIDES; s++) {
            const a = (2 * Math.PI * s) / REBAR_SIDES;
            const dir = [Math.cos(a) * normal[0]! + Math.sin(a) * binormal[0]!, Math.cos(a) * normal[1]! + Math.sin(a) * binormal[1]!, Math.cos(a) * normal[2]! + Math.sin(a) * binormal[2]!];
            const p = points[i]!;
            part.positions.push3(p[0] + dir[0]! * radius, p[1] + dir[1]! * radius, p[2] + dir[2]! * radius);
            pushNormal(part, dir[0]!, dir[1]!, dir[2]!);
        }
    }
    for (let i = 0; i < points.length - 1; i++)
        for (let s = 0; s < REBAR_SIDES; s++) {
            const a = base + i * REBAR_SIDES + s;
            const b = base + i * REBAR_SIDES + ((s + 1) % REBAR_SIDES);
            const c = a + REBAR_SIDES;
            const d = b + REBAR_SIDES;
            part.indices.push3(a, c, b);
            part.indices.push3(b, c, d);
        }
    part.vertexCount += points.length * REBAR_SIDES;
    return (points.length - 1) * REBAR_SIDES * 2;
}
