/**
 * ถอดปริมาณจากโมเดล IFC (Revit → IFC) — ต้นแบบ
 * - ใช้ปริมาณในไฟล์ก่อน (IfcElementQuantity: Qto_*BaseQuantities เมื่อ Revit เปิด "Export base quantities")
 * - ไม่มีก็คำนวณจากรูปทรง: ปริมาตร (mesh ปิด), ผิวด้านข้าง/ล่าง/บน แยกตามทิศของผิว (แกนตั้ง = Y หลัง web-ifc แปลง)
 * - เหล็กเสริม: ความยาวตามแนวเหล็ก (IfcSweptDiskSolid) × น้ำหนักต่อเมตรตามขนาด
 * ใช้เวลาตามขนาดไฟล์ — เรียกจาก worker thread เท่านั้น
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

type WebIfcModule = typeof import('web-ifc');
const WebIFC = createRequire(import.meta.url)('web-ifc') as WebIfcModule;

export type QtoKind = 'beam' | 'column' | 'slab' | 'footing' | 'pile' | 'wall' | 'stair' | 'roof' | 'covering' | 'door' | 'window' | 'railing' | 'member' | 'plate' | 'other';

export interface QtoRow {
    kind: QtoKind;
    ifcClass: string;
    storey: string;
    material: string;
    type: string;
    count: number;
    /** ลบ.ม. */
    volume: number;
    /** ตร.ม. ผิวด้านข้าง / ล่าง / บน */
    side: number;
    bottom: number;
    top: number;
    /** ม. ความยาวรวม (คาน = ด้านยาวแนวราบ, เสา = ความสูง) */
    length: number;
    /** ปริมาณมาจากไฟล์ (Qto) แทนการคำนวณจากรูปทรง */
    fromQuantities: number;
}

export interface RebarRow {
    storey: string;
    diameter: number;
    count: number;
    /** ม. */
    length: number;
    /** กก. */
    weight: number;
}

export interface IfcTakeoffResult {
    schema: string;
    application: string;
    storeys: Array<{ name: string; elevation: number }>;
    rows: QtoRow[];
    rebars: RebarRow[];
    elements: number;
    seconds: number;
    warnings: string[];
}

const KINDS: Record<string, QtoKind> = {
    IFCBEAM: 'beam',
    IFCCOLUMN: 'column',
    IFCSLAB: 'slab',
    IFCFOOTING: 'footing',
    IFCPILE: 'pile',
    IFCWALL: 'wall',
    IFCWALLSTANDARDCASE: 'wall',
    IFCSTAIR: 'stair',
    IFCSTAIRFLIGHT: 'stair',
    IFCROOF: 'roof',
    IFCCOVERING: 'covering',
    IFCDOOR: 'door',
    IFCWINDOW: 'window',
    IFCRAILING: 'railing',
    IFCMEMBER: 'member',
    IFCPLATE: 'plate',
    IFCBUILDINGELEMENTPROXY: 'other'
};

/** น้ำหนักเหล็กเส้นต่อเมตร (กก./ม.) */
export const rebarKgPerMeter = (diameter: number) => ({ 6: 0.222, 9: 0.499, 10: 0.617, 12: 0.888, 16: 1.578, 20: 2.466, 25: 3.853, 28: 4.834, 32: 6.313 })[diameter] ?? Math.round(0.00617 * diameter * diameter * 1000) / 1000;

/** ข้อความ IFC ที่เข้ารหัส \X2\0E2A0E35\X0\ (UTF-16) → ภาษาไทย */
export function decodeIfcText(value: string): string {
    return value
        .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_, hex: string) => String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16))))
        .replace(/\\X\\([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\S\\(.)/g, (_, ch: string) => String.fromCharCode(ch.charCodeAt(0) + 128));
}

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

export async function takeoffIfc(input: string): Promise<IfcTakeoffResult> {
    const started = Date.now();
    const api = new WebIFC.IfcAPI();
    await api.Init();
    api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF);
    const bytes = new Uint8Array(readFileSync(input));
    const header = new TextDecoder().decode(bytes.subarray(0, 4000));
    const model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true });
    const warnings: string[] = [];
    try {
        const ids = (type: number): number[] => {
            const vector = api.GetLineIDsWithType(model, type, true);
            return Array.from({ length: vector.size() }, (_, i) => vector.get(i));
        };
        const cls = (id: number) => String(api.GetNameFromTypeCode(api.GetLineType(model, id))).toUpperCase();
        const line = (id: number) => api.GetLine(model, id);
        const text = (attribute: { value?: unknown } | null | undefined) => (attribute?.value === undefined || attribute.value === null ? '' : decodeIfcText(String(attribute.value)));

        // ---------- หน่วยความยาว ----------
        const PREFIX: Record<string, number> = { MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 };
        let lengthScale = 1;
        const project = ids(WebIFC.IFCPROJECT)[0];
        for (const ref of project !== undefined ? (line(line(project).UnitsInContext?.value)?.Units ?? []) : []) {
            const unit = line(ref.value);
            if (text(unit.UnitType) !== 'LENGTHUNIT') continue;
            if (unit.Prefix !== undefined || unit.Name?.value === 'METRE') lengthScale = PREFIX[text(unit.Prefix)] ?? 1;
            else if (/FOOT/i.test(text(unit.Name))) lengthScale = 0.3048;
            else if (/INCH/i.test(text(unit.Name))) lengthScale = 0.0254;
        }

        // ---------- ชั้น ----------
        const parent = new Map<number, number>();
        for (const id of ids(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
            const rel = line(id);
            for (const element of rel.RelatedElements ?? []) parent.set(element.value, rel.RelatingStructure.value);
        }
        for (const id of ids(WebIFC.IFCRELAGGREGATES)) {
            const rel = line(id);
            for (const child of rel.RelatedObjects ?? []) if (!parent.has(child.value)) parent.set(child.value, rel.RelatingObject.value);
        }
        const storeys = new Map<number, { name: string; elevation: number }>();
        for (const id of ids(WebIFC.IFCBUILDINGSTOREY)) {
            const storey = line(id);
            storeys.set(id, { name: text(storey.Name) || text(storey.LongName) || `ชั้น #${id}`, elevation: round(Number(storey.Elevation?.value ?? 0) * lengthScale, 3) });
        }
        const storeyOf = (id: number): string => {
            let current: number | undefined = id;
            for (let depth = 0; current !== undefined && depth < 20; depth++) {
                const info = storeys.get(current);
                if (info) return info.name;
                current = parent.get(current);
            }
            return 'ไม่ระบุชั้น';
        };

        // ---------- ชนิด (type) และวัสดุ ----------
        const typeOf = new Map<number, number>();
        for (const id of ids(WebIFC.IFCRELDEFINESBYTYPE)) {
            const rel = line(id);
            for (const object of rel.RelatedObjects ?? []) typeOf.set(object.value, rel.RelatingType.value);
        }
        const materialOf = new Map<number, string>();
        const materialName = (id: number, depth = 0): string => {
            if (depth > 4) return '';
            const kind = cls(id);
            const item = line(id);
            if (kind === 'IFCMATERIAL') return text(item.Name);
            if (kind === 'IFCMATERIALLAYERSETUSAGE') return materialName(item.ForLayerSet.value, depth + 1);
            if (kind === 'IFCMATERIALLAYERSET') return (item.MaterialLayers ?? []).map((layer: { value: number }) => materialName(layer.value, depth + 1)).filter(Boolean).join(' + ');
            if (kind === 'IFCMATERIALLAYER') return item.Material ? materialName(item.Material.value, depth + 1) : '';
            if (kind === 'IFCMATERIALLIST') return (item.Materials ?? []).map((m: { value: number }) => materialName(m.value, depth + 1)).filter(Boolean).join(' + ');
            if (kind === 'IFCMATERIALPROFILESETUSAGE' || kind === 'IFCMATERIALCONSTITUENTSET') return text(item.Name);
            return '';
        };
        for (const id of ids(WebIFC.IFCRELASSOCIATESMATERIAL)) {
            const rel = line(id);
            const name = materialName(rel.RelatingMaterial.value);
            for (const object of rel.RelatedObjects ?? []) if (name && !materialOf.has(object.value)) materialOf.set(object.value, name);
        }
        const elementMaterial = (id: number) => materialOf.get(id) ?? (typeOf.has(id) ? materialOf.get(typeOf.get(id)!) : undefined) ?? '';
        const elementType = (id: number) => {
            const typeId = typeOf.get(id);
            return (typeId !== undefined ? text(line(typeId).Name) : '') || text(line(id).ObjectType) || text(line(id).Name);
        };

        // ---------- ปริมาณในไฟล์ (Qto) ----------
        const quantities = new Map<number, { volume?: number; area?: number; length?: number }>();
        for (const id of ids(WebIFC.IFCRELDEFINESBYPROPERTIES)) {
            const rel = line(id);
            const definition = rel.RelatingPropertyDefinition.value;
            if (cls(definition) !== 'IFCELEMENTQUANTITY') continue;
            const q: { volume?: number; area?: number; length?: number } = {};
            for (const ref of line(definition).Quantities ?? []) {
                const quantity = line(ref.value);
                const name = text(quantity.Name);
                if (quantity.VolumeValue && /NetVolume|GrossVolume/.test(name)) q.volume = Math.max(q.volume ?? 0, Number(quantity.VolumeValue.value));
                if (quantity.AreaValue && /NetSideArea|NetArea|GrossArea/.test(name)) q.area = Math.max(q.area ?? 0, Number(quantity.AreaValue.value));
                if (quantity.LengthValue && /^Length$/.test(name)) q.length = Number(quantity.LengthValue.value) * lengthScale;
            }
            for (const object of rel.RelatedObjects ?? []) quantities.set(object.value, q);
        }

        // ---------- รูปทรง → ปริมาตร ผิว ขนาด ----------
        interface Measure {
            volume: number;
            side: number;
            bottom: number;
            top: number;
            min: [number, number, number];
            max: [number, number, number];
        }
        const measures = new Map<number, Measure>();
        api.StreamAllMeshes(
            model,
            (mesh) => {
                const id = mesh.expressID;
                const kindName = cls(id);
                if (!KINDS[kindName]) return;
                const m = measures.get(id) ?? { volume: 0, side: 0, bottom: 0, top: 0, min: [Infinity, Infinity, Infinity] as [number, number, number], max: [-Infinity, -Infinity, -Infinity] as [number, number, number] };
                const placed = mesh.geometries;
                for (let g = 0; g < placed.size(); g++) {
                    const pg = placed.get(g);
                    const geometry = api.GetGeometry(model, pg.geometryExpressID);
                    const v = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
                    const index = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
                    const t = pg.flatTransformation;
                    const p = (i: number): [number, number, number] => {
                        const x = v[i * 6]!;
                        const y = v[i * 6 + 1]!;
                        const z = v[i * 6 + 2]!;
                        return [t[0]! * x + t[4]! * y + t[8]! * z + t[12]!, t[1]! * x + t[5]! * y + t[9]! * z + t[13]!, t[2]! * x + t[6]! * y + t[10]! * z + t[14]!];
                    };
                    for (let k = 0; k < v.length / 6; k++) {
                        const q = p(k);
                        for (let a = 0; a < 3; a++) {
                            if (q[a]! < m.min[a]!) m.min[a] = q[a]!;
                            if (q[a]! > m.max[a]!) m.max[a] = q[a]!;
                        }
                    }
                    for (let k = 0; k < index.length; k += 3) {
                        const a = p(index[k]!);
                        const b = p(index[k + 1]!);
                        const c = p(index[k + 2]!);
                        // ปริมาตรแบบ divergence: ผลรวมปริมาตรเครื่องหมายของ tetrahedron กับจุดกำเนิด
                        m.volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
                        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
                        const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
                        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
                        const area2 = Math.hypot(nx, ny, nz);
                        if (!area2) continue;
                        const area = area2 / 2;
                        const vertical = ny / area2;
                        if (vertical > 0.7) m.top += area;
                        else if (vertical < -0.7) m.bottom += area;
                        else if (Math.abs(vertical) < 0.3) m.side += area;
                    }
                    geometry.delete();
                }
                measures.set(id, m);
            },
            true
        );

        // ---------- รวมเป็นแถว ----------
        const rows = new Map<string, QtoRow>();
        let elements = 0;
        let negative = 0;
        for (const [ifcClass, kind] of Object.entries(KINDS)) {
            const typeCode = (WebIFC as unknown as Record<string, number>)[ifcClass];
            if (typeCode === undefined) continue;
            for (const id of ids(typeCode)) {
                const m = measures.get(id);
                const q = quantities.get(id);
                if (!m && !q) continue;
                elements++;
                const storey = storeyOf(id);
                const material = elementMaterial(id);
                const type = elementType(id);
                const key = `${kind}|${storey}|${material}|${type}`;
                const row = rows.get(key) ?? { kind, ifcClass, storey, material, type, count: 0, volume: 0, side: 0, bottom: 0, top: 0, length: 0, fromQuantities: 0 };
                row.count++;
                let volume = m ? m.volume : 0;
                // ผิวกลับด้าน (ลำดับจุดกลับ) ให้ปริมาตรติดลบ — ใช้ค่าสัมบูรณ์
                if (volume < 0) {
                    negative++;
                    volume = -volume;
                }
                if (q?.volume) {
                    volume = q.volume;
                    row.fromQuantities++;
                }
                row.volume += volume;
                if (m) {
                    row.side += m.side;
                    row.bottom += m.bottom;
                    row.top += m.top;
                    const dx = m.max[0] - m.min[0];
                    const dy = m.max[1] - m.min[1];
                    const dz = m.max[2] - m.min[2];
                    row.length += q?.length ?? (kind === 'column' || kind === 'pile' ? dy : Math.max(dx, dz));
                }
                rows.set(key, row);
            }
        }
        if (negative) warnings.push(`ชิ้นงาน ${negative} ชิ้นมีผิวกลับด้าน ใช้ค่าปริมาตรสัมบูรณ์`);

        // ---------- เหล็กเสริม ----------
        const rebarRows = new Map<string, RebarRow>();
        let rebarWithoutLength = 0;
        for (const id of ids(WebIFC.IFCREINFORCINGBAR)) {
            const bar = line(id);
            const diameter = Math.round(Number(bar.NominalDiameter?.value ?? 0) * lengthScale * 1000);
            if (!(diameter > 0)) continue;
            let length = Number(bar.BarLength?.value ?? 0) * lengthScale;
            let pieces = 1;
            if (!(length > 0)) {
                // ความยาวจากแนวเหล็ก (IfcSweptDiskSolid.Directrix) — 1 ชิ้นงานอาจมีหลายเส้น (set ของเหล็ก)
                const paths = barPaths(id);
                pieces = Math.max(1, paths.length);
                length = paths.reduce((sum, path) => sum + path, 0) * lengthScale;
            }
            if (!(length > 0)) {
                rebarWithoutLength++;
                continue;
            }
            const storey = storeyOf(id);
            const key = `${storey}|${diameter}`;
            const row = rebarRows.get(key) ?? { storey, diameter, count: 0, length: 0, weight: 0 };
            row.count += pieces;
            row.length += length;
            row.weight += length * rebarKgPerMeter(diameter);
            rebarRows.set(key, row);
        }
        if (rebarWithoutLength) warnings.push(`เหล็กเสริม ${rebarWithoutLength} ชิ้นหาความยาวไม่ได้ ไม่ได้นับ`);

        function barPaths(id: number): number[] {
            const bar = line(id);
            if (!bar.Representation) return [];
            const result: number[] = [];
            for (const rep of line(bar.Representation.value).Representations ?? []) for (const itemRef of line(rep.value).Items ?? []) collect(itemRef.value, 1, 0);
            return result;
            function collect(itemId: number, scale: number, depth: number) {
                if (depth > 6) return;
                const kind = cls(itemId);
                const item = line(itemId);
                if (kind === 'IFCSWEPTDISKSOLID' || kind === 'IFCSWEPTDISKSOLIDPOLYGONAL') {
                    const length = curveLength(item.Directrix?.value, 0);
                    if (length > 0) result.push(length * scale);
                } else if (kind === 'IFCMAPPEDITEM') {
                    const target = item.MappingTarget ? line(item.MappingTarget.value) : null;
                    const s = Number(target?.Scale?.value ?? 1);
                    for (const child of line(line(item.MappingSource.value).MappedRepresentation.value).Items ?? []) collect(child.value, scale * s, depth + 1);
                } else if (kind === 'IFCBOOLEANRESULT' || kind === 'IFCBOOLEANCLIPPINGRESULT') collect(item.FirstOperand.value, scale, depth + 1);
            }
        }

        /** ความยาวเส้นแนว (หน่วยไฟล์): polyline, composite, trimmed line/circle, indexed poly curve */
        function curveLength(curveId: number | undefined, depth: number): number {
            if (curveId === undefined || depth > 6) return 0;
            const kind = cls(curveId);
            const curve = line(curveId);
            const coord = (ref: { value: number }) => line(ref.value).Coordinates.map((v: { value: number }) => Number(v.value));
            const polyline = (points: number[][]) => points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point[0]! - points[i]![0]!, point[1]! - points[i]![1]!, (point[2] ?? 0) - (points[i]![2] ?? 0)), 0);
            if (kind === 'IFCPOLYLINE') return polyline(curve.Points.map(coord));
            if (kind === 'IFCCOMPOSITECURVE') return (curve.Segments ?? []).reduce((sum: number, seg: { value: number }) => sum + curveLength(line(seg.value).ParentCurve?.value, depth + 1), 0);
            if (kind === 'IFCINDEXEDPOLYCURVE') {
                const points = line(curve.Points.value).CoordList.map((row: Array<{ value: number }>) => row.map((v) => Number(v.value)));
                return polyline(points);
            }
            if (kind === 'IFCTRIMMEDCURVE') {
                const basisKind = cls(curve.BasisCurve.value);
                const basis = line(curve.BasisCurve.value);
                const param = (list: Array<{ value: unknown; type?: number }>) => {
                    const found = (list ?? []).find((t) => t.type !== 5 && typeof t.value === 'number');
                    return found ? Number(found.value) : undefined;
                };
                const t1 = param(curve.Trim1);
                const t2 = param(curve.Trim2);
                if (basisKind === 'IFCLINE') return Math.abs((t2 ?? 1) - (t1 ?? 0)) * Number(line(basis.Dir.value).Magnitude?.value ?? 1);
                if (basisKind === 'IFCCIRCLE') {
                    let a1 = t1 ?? 0;
                    let a2 = t2 ?? 2 * Math.PI;
                    const radians = Math.abs(a1) <= 2 * Math.PI + 1e-6 && Math.abs(a2) <= 2 * Math.PI + 1e-6;
                    if (!radians) {
                        a1 = (a1 * Math.PI) / 180;
                        a2 = (a2 * Math.PI) / 180;
                    }
                    let sweep = Math.abs(a2 - a1);
                    if (sweep > 2 * Math.PI) sweep = 2 * Math.PI;
                    return sweep * Number(basis.Radius.value);
                }
                return curveLength(curve.BasisCurve.value, depth + 1);
            }
            return 0;
        }

        const schema = header.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/)?.[1] ?? '';
        const application = decodeIfcText(header.match(/FILE_NAME\s*\((?:[^,]*,){5}\s*'([^']*)'/)?.[1] ?? '');
        if (!quantities.size) warnings.push('ไฟล์ไม่มีปริมาณ (BaseQuantities) — คำนวณจากรูปทรงทั้งหมด แนะนำเปิด "Export base quantities" ตอนส่งออกจาก Revit');
        return {
            schema,
            application,
            storeys: [...storeys.values()].sort((a, b) => a.elevation - b.elevation),
            rows: [...rows.values()].map((row) => ({ ...row, volume: round(row.volume), side: round(row.side), bottom: round(row.bottom), top: round(row.top), length: round(row.length) })),
            rebars: [...rebarRows.values()].map((row) => ({ ...row, length: round(row.length, 2), weight: round(row.weight, 2) })).sort((a, b) => a.storey.localeCompare(b.storey) || a.diameter - b.diameter),
            elements,
            seconds: round((Date.now() - started) / 1000, 1),
            warnings
        };
    } finally {
        api.CloseModel(model);
    }
}
