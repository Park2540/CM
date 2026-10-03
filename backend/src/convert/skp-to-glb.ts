/**
 * แปลงไฟล์ SketchUp (.skp) เป็น glTF binary (.glb) ผ่าน SketchUp C API (SketchUpAPI.dll ของ SketchUp ที่ติดตั้งบนเครื่อง)
 * - อ่านทุก face รวมใน group / component ซ้อนกัน (component ที่ใช้ซ้ำ tessellate ครั้งเดียว)
 * - แยกส่วนตาม Tag 2 ระดับ ให้ตัวดูเปิด/ปิดได้: หมวด = tag ชั้นนอกสุด (เช่น "รวมโครงสร้าง") → tag ในสุด (เช่น "S-RC-RB6")
 *   โครงสร้าง node: model → หมวด → tag (มี mesh) ชื่อจริงอยู่ใน extras.name (three.js ปรับชื่อ node) และ extras.visible = ค่าเปิด/ปิดใน SketchUp
 * - วัตถุที่ซ่อน (Hide) ข้ามไป; tag ที่ปิดอยู่ยังเก็บไว้แต่เริ่มต้นเป็นซ่อน (ยกเว้น tag ชั้นกลางที่ปิด ข้ามทั้งชุด เพราะเปิดจากตัวดูไม่ได้)
 * - สีตามวัสดุของ face → ของ group/component ที่ครอบ (ยังไม่ใส่ภาพ texture ใช้สีเฉลี่ยของวัสดุแทน)
 * - หน่วยนิ้ว → เมตร และแกน Z-up (SketchUp) → Y-up (glTF)
 * ทำงานแบบ synchronous ใช้เวลาหลายวินาทีถึงหลายนาที — เรียกจาก worker thread เท่านั้น (skp-worker.ts)
 */
import koffi from 'koffi';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlbNode, GlbPart, newPart, pushNormal, writeGlb } from './glb-writer.js';

export interface ConvertResult {
    triangles: number;
    materials: number;
    tags: number;
    bytes: number;
}

/** รหัส SUResult ที่ต้องแจ้งผู้ใช้ */
export const SU_ERROR_MODEL_VERSION = 13;

type Ref = number | bigint;
type Mat4 = Float64Array;

/** ชื่อแสดงของ geometry ที่ไม่ได้ติด tag */
const UNTAGGED = 'ไม่มี Tag';

export function convertSkpToGlb(apiDir: string, input: string, output: string): ConvertResult {
    // DLL อื่นที่ SketchUpAPI.dll ใช้อยู่ในโฟลเดอร์เดียวกัน — ผู้เรียกต้องเพิ่ม apiDir ใน PATH ก่อน (ดู skp-converter.ts)
    const lib = koffi.load(join(apiDir, 'SketchUpAPI.dll'));
    // ref ของ SketchUp เป็น struct { void* } ขนาด 8 ไบต์ ส่งผ่าน register เหมือน uint64 ทั้งตอนรับและส่งคืน
    const f = (signature: string) => lib.func(signature);
    const api = {
        init: f('void SUInitialize()'),
        term: f('void SUTerminate()'),
        open: f('int SUModelCreateFromFile(_Out_ uint64_t *model, const char *path)'),
        release: f('int SUModelRelease(_Inout_ uint64_t *model)'),
        modelEntities: f('int SUModelGetEntities(uint64_t model, _Out_ uint64_t *entities)'),
        defaultLayer: f('int SUModelGetDefaultLayer(uint64_t model, _Out_ uint64_t *layer)'),
        stringCreate: f('int SUStringCreate(_Out_ uint64_t *s)'),
        stringRelease: f('int SUStringRelease(_Inout_ uint64_t *s)'),
        stringLength: f('int SUStringGetUTF8Length(uint64_t s, _Out_ size_t *n)'),
        stringGet: f('int SUStringGetUTF8(uint64_t s, size_t len, _Out_ uint8_t *buf, _Out_ size_t *n)'),
        layerName: f('int SULayerGetName(uint64_t layer, _Inout_ uint64_t *name)'),
        numFaces: f('int SUEntitiesGetNumFaces(uint64_t e, _Out_ size_t *n)'),
        faces: f('int SUEntitiesGetFaces(uint64_t e, size_t len, _Out_ uint64_t *items, _Out_ size_t *n)'),
        numGroups: f('int SUEntitiesGetNumGroups(uint64_t e, _Out_ size_t *n)'),
        groups: f('int SUEntitiesGetGroups(uint64_t e, size_t len, _Out_ uint64_t *items, _Out_ size_t *n)'),
        numInstances: f('int SUEntitiesGetNumInstances(uint64_t e, _Out_ size_t *n)'),
        instances: f('int SUEntitiesGetInstances(uint64_t e, size_t len, _Out_ uint64_t *items, _Out_ size_t *n)'),
        groupEntities: f('int SUGroupGetEntities(uint64_t g, _Out_ uint64_t *e)'),
        groupTransform: f('int SUGroupGetTransform(uint64_t g, _Out_ double *t)'),
        instanceDefinition: f('int SUComponentInstanceGetDefinition(uint64_t i, _Out_ uint64_t *d)'),
        instanceTransform: f('int SUComponentInstanceGetTransform(uint64_t i, _Out_ double *t)'),
        definitionEntities: f('int SUComponentDefinitionGetEntities(uint64_t d, _Out_ uint64_t *e)'),
        faceElement: f('uint64_t SUFaceToDrawingElement(uint64_t face)'),
        groupElement: f('uint64_t SUGroupToDrawingElement(uint64_t g)'),
        instanceElement: f('uint64_t SUComponentInstanceToDrawingElement(uint64_t i)'),
        hidden: f('int SUDrawingElementGetHidden(uint64_t el, _Out_ bool *hidden)'),
        layer: f('int SUDrawingElementGetLayer(uint64_t el, _Out_ uint64_t *layer)'),
        layerVisible: f('int SULayerGetVisibility(uint64_t layer, _Out_ bool *visible)'),
        elementMaterial: f('int SUDrawingElementGetMaterial(uint64_t el, _Out_ uint64_t *material)'),
        frontMaterial: f('int SUFaceGetFrontMaterial(uint64_t face, _Out_ uint64_t *material)'),
        backMaterial: f('int SUFaceGetBackMaterial(uint64_t face, _Out_ uint64_t *material)'),
        materialColor: f('int SUMaterialGetColor(uint64_t m, _Out_ uint8_t *rgba)'),
        materialUseOpacity: f('int SUMaterialGetUseOpacity(uint64_t m, _Out_ bool *use)'),
        materialOpacity: f('int SUMaterialGetOpacity(uint64_t m, _Out_ double *opacity)'),
        meshCreate: f('int SUMeshHelperCreate(_Out_ uint64_t *mesh, uint64_t face)'),
        meshRelease: f('int SUMeshHelperRelease(_Inout_ uint64_t *mesh)'),
        meshNumVertices: f('int SUMeshHelperGetNumVertices(uint64_t mesh, _Out_ size_t *n)'),
        meshNumTriangles: f('int SUMeshHelperGetNumTriangles(uint64_t mesh, _Out_ size_t *n)'),
        meshVertices: f('int SUMeshHelperGetVertices(uint64_t mesh, size_t len, _Out_ double *points, _Out_ size_t *n)'),
        meshNormals: f('int SUMeshHelperGetNormals(uint64_t mesh, size_t len, _Out_ double *normals, _Out_ size_t *n)'),
        meshIndices: f('int SUMeshHelperGetVertexIndices(uint64_t mesh, size_t len, _Out_ uint64_t *indices, _Out_ size_t *n)')
    };

    api.init();
    const out: [Ref] = [0];
    const count: [Ref] = [0];
    const flag: [boolean] = [false];
    const opened = api.open(out, Buffer.from(input + '\0', 'utf8')) as number;
    if (opened !== 0) {
        api.term();
        throw Object.assign(new Error(`SketchUp เปิดไฟล์ไม่ได้ (SUResult ${opened})`), { code: opened });
    }
    const model = out[0];
    try {
        api.modelEntities(model, out);
        const root = out[0];
        api.defaultLayer(model, out);
        // tag ที่ไม่ได้ระบุ (Untagged / Layer0) ใช้ 0 แทน
        const untagged = Number(out[0]);

        const list = (numFn: koffi.KoffiFunction, getFn: koffi.KoffiFunction, entities: Ref): BigUint64Array => {
            numFn(entities, count);
            const n = Number(count[0]);
            const items = new BigUint64Array(n);
            if (n) getFn(entities, n, items, count);
            return items;
        };
        const isHidden = (element: Ref) => {
            api.hidden(element, flag);
            return flag[0];
        };

        // ---------- tag ----------
        const tagInfo = new Map<number, { name: string; visible: boolean }>([[0, { name: UNTAGGED, visible: true }]]);
        const text = (getter: koffi.KoffiFunction, ref: Ref) => {
            const handle: [Ref] = [0];
            api.stringCreate(handle);
            getter(ref, handle);
            api.stringLength(handle[0], count);
            const buffer = new Uint8Array(Number(count[0]) + 1);
            api.stringGet(handle[0], buffer.length, buffer, count);
            api.stringRelease(handle);
            return Buffer.from(buffer.subarray(0, Number(count[0]))).toString('utf8');
        };
        /** tag ของ element (0 = ไม่ได้ระบุ) */
        const tagOf = (element: Ref): number => {
            if (api.layer(element, out) !== 0) return 0;
            const tag = Number(out[0]);
            if (tag === untagged) return 0;
            if (!tagInfo.has(tag)) {
                api.layerVisible(tag, flag);
                tagInfo.set(tag, { name: text(api.layerName, tag) || UNTAGGED, visible: flag[0] });
            }
            return tag;
        };
        /**
         * ตำแหน่งในลำดับชั้น tag: outer = tag ชั้นนอกสุด (หมวด), inner = tag ในสุด
         * blocked = มี tag ชั้นกลางที่ปิดอยู่ (ไม่ใช่หมวดหรือ tag ในสุด) — ตัวดูเปิดไม่ได้จึงไม่ใส่ในไฟล์ (เหมือน SketchUp ที่ไม่แสดง)
         */
        type TagPath = { outer: number; inner: number; blocked: boolean };
        const enter = (path: TagPath, tag: number): TagPath => {
            if (!tag) return path;
            if (!path.outer) return { outer: tag, inner: tag, blocked: path.blocked };
            const middleHidden = path.inner !== path.outer && !tagInfo.get(path.inner)!.visible;
            return { outer: path.outer, inner: tag, blocked: path.blocked || middleHidden };
        };

        // ---------- วัสดุ ----------
        const materialOf = (fn: koffi.KoffiFunction, ref: Ref): Ref => (fn(ref, out) === 0 && out[0] ? out[0] : 0);
        const materials = new Map<Ref, { color: [number, number, number]; alpha: number }>();
        const rgba = new Uint8Array(4);
        const opacity: [number] = [1];
        const readMaterial = (material: Ref): { color: [number, number, number]; alpha: number } => {
            let info = materials.get(material);
            if (info) return info;
            let color: [number, number, number] = [232, 230, 225];
            let alpha = 1;
            if (material) {
                api.materialColor(material, rgba);
                color = [rgba[0]!, rgba[1]!, rgba[2]!];
                alpha = rgba[3]! / 255;
                api.materialUseOpacity(material, flag);
                if (flag[0]) {
                    api.materialOpacity(material, opacity);
                    alpha = Math.min(alpha, opacity[0]);
                }
            }
            materials.set(material, (info = { color, alpha }));
            return info;
        };

        /** geometry แยกตาม "outer|inner" → วัสดุ */
        const tagParts = new Map<string, { outer: number; inner: number; byMaterial: Map<Ref, GlbPart> }>();
        const partOf = (path: TagPath, material: Ref): GlbPart => {
            const key = `${path.outer}|${path.inner}`;
            let group = tagParts.get(key);
            if (!group) tagParts.set(key, (group = { outer: path.outer, inner: path.inner, byMaterial: new Map() }));
            let part = group.byMaterial.get(material);
            if (!part) {
                const { color, alpha } = readMaterial(material);
                part = newPart(String(material), color, alpha);
                group.byMaterial.set(material, part);
            }
            return part;
        };

        // tessellation ของ face แคชตาม entities ของ component definition (ใช้ซ้ำทุก instance)
        const faceCache = new Map<Ref, LocalFace[]>();
        let points = new Float64Array(3 * 64);
        let normals = new Float64Array(3 * 64);
        let indices = new BigUint64Array(3 * 64);
        const meshRef: [Ref] = [0];
        const tessellate = (entities: Ref): LocalFace[] => {
            const faces: LocalFace[] = [];
            for (const face of list(api.numFaces, api.faces, entities)) {
                const element = api.faceElement(face);
                if (isHidden(element)) continue;
                const tag = tagOf(element);
                const material = materialOf(api.frontMaterial, face) || materialOf(api.backMaterial, face) || null;
                if (api.meshCreate(meshRef, face) !== 0) continue;
                const mesh = meshRef[0];
                api.meshNumVertices(mesh, count);
                const vertexCount = Number(count[0]);
                api.meshNumTriangles(mesh, count);
                const triangleCount = Number(count[0]);
                if (vertexCount && triangleCount) {
                    if (points.length < vertexCount * 3) {
                        points = new Float64Array(vertexCount * 6);
                        normals = new Float64Array(vertexCount * 6);
                    }
                    if (indices.length < triangleCount * 3) indices = new BigUint64Array(triangleCount * 6);
                    api.meshVertices(mesh, vertexCount, points, count);
                    api.meshNormals(mesh, vertexCount, normals, count);
                    api.meshIndices(mesh, triangleCount * 3, indices, count);
                    faces.push({
                        tag,
                        material,
                        positions: points.slice(0, vertexCount * 3),
                        normals: normals.slice(0, vertexCount * 3),
                        indices: Uint32Array.from(indices.subarray(0, triangleCount * 3), Number)
                    });
                }
                api.meshRelease(meshRef);
            }
            return faces;
        };

        const transform = new Float64Array(16);
        let triangles = 0;
        const walk = (entities: Ref, matrix: Mat4, inherited: Ref, path: TagPath, cacheKey?: Ref) => {
            let faces = cacheKey !== undefined ? faceCache.get(cacheKey) : undefined;
            if (!faces) {
                faces = tessellate(entities);
                if (cacheKey !== undefined) faceCache.set(cacheKey, faces);
            }
            // เมทริกซ์กลับด้าน (mirror) ต้องสลับลำดับจุดของสามเหลี่ยม ไม่งั้นหน้าจะหันผิดด้าน
            const flip = det3(matrix) < 0;
            for (const face of faces) {
                const facePath = enter(path, face.tag);
                if (facePath.blocked) continue;
                const part = partOf(facePath, face.material ?? inherited);
                const base = part.vertexCount;
                const p = face.positions;
                const n = face.normals;
                for (let i = 0; i < p.length; i += 3) {
                    const x = p[i]!, y = p[i + 1]!, z = p[i + 2]!;
                    const wx = matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!;
                    const wy = matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!;
                    const wz = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!;
                    part.positions.push3(wx * INCH, wz * INCH, -wy * INCH);
                    const nx = matrix[0]! * n[i]! + matrix[4]! * n[i + 1]! + matrix[8]! * n[i + 2]!;
                    const ny = matrix[1]! * n[i]! + matrix[5]! * n[i + 1]! + matrix[9]! * n[i + 2]!;
                    const nz = matrix[2]! * n[i]! + matrix[6]! * n[i + 1]! + matrix[10]! * n[i + 2]!;
                    pushNormal(part, nx, nz, -ny);
                }
                const idx = face.indices;
                for (let i = 0; i < idx.length; i += 3) {
                    if (flip) part.indices.push3(base + idx[i]!, base + idx[i + 2]!, base + idx[i + 1]!);
                    else part.indices.push3(base + idx[i]!, base + idx[i + 1]!, base + idx[i + 2]!);
                }
                part.vertexCount += p.length / 3;
                triangles += idx.length / 3;
            }
            for (const group of list(api.numGroups, api.groups, entities)) {
                const element = api.groupElement(group);
                if (isHidden(element)) continue;
                const childPath = enter(path, tagOf(element));
                if (childPath.blocked) continue;
                api.groupTransform(group, transform);
                const child = multiply(matrix, transform);
                api.groupEntities(group, out);
                walk(out[0], child, materialOf(api.elementMaterial, element) || inherited, childPath);
            }
            for (const instance of list(api.numInstances, api.instances, entities)) {
                const element = api.instanceElement(instance);
                if (isHidden(element)) continue;
                const childPath = enter(path, tagOf(element));
                if (childPath.blocked) continue;
                api.instanceTransform(instance, transform);
                const child = multiply(matrix, transform);
                api.instanceDefinition(instance, out);
                api.definitionEntities(out[0], out);
                const definitionEntities = out[0];
                walk(definitionEntities, child, materialOf(api.elementMaterial, element) || inherited, childPath, definitionEntities);
            }
        };
        walk(root, IDENTITY, 0, { outer: 0, inner: 0, blocked: false });
        if (!triangles) throw new Error('ไม่พบรูปทรงที่มองเห็นได้ในไฟล์ (วัตถุทั้งหมดถูกซ่อนหรือไฟล์ว่าง)');

        // หมวด (tag ชั้นนอก) → tag ในสุด เรียงตามชื่อ
        const categories = new Map<number, GlbNode & { children: GlbNode[] }>();
        for (const group of tagParts.values()) {
            const parts = [...group.byMaterial.values()].filter((part) => part.vertexCount);
            if (!parts.length) continue;
            const outer = tagInfo.get(group.outer)!;
            let category = categories.get(group.outer);
            if (!category) categories.set(group.outer, (category = { name: outer.name, extras: { name: outer.name, kind: 'category', visible: outer.visible }, children: [] }));
            const inner = tagInfo.get(group.inner)!;
            category.children.push({ name: inner.name, extras: { name: inner.name, kind: 'tag', visible: inner.visible }, parts });
        }
        const sorted = [...categories.values()].sort((a, b) => a.name.localeCompare(b.name, 'th'));
        for (const category of sorted) category.children.sort((a, b) => a.name.localeCompare(b.name, 'th'));
        const glb = writeGlb({ name: 'model', extras: { source: 'sketchup-tags' }, children: sorted }, 'cm-planning skp-to-glb');
        writeFileSync(output, glb);
        return { triangles, materials: materials.size, tags: sorted.reduce((sum, category) => sum + category.children.length, 0), bytes: glb.length };
    } finally {
        api.release([model]);
        api.term();
    }
}

const INCH = 0.0254;

interface LocalFace {
    tag: number;
    material: Ref | null;
    positions: Float64Array;
    normals: Float64Array;
    indices: Uint32Array;
}

const IDENTITY: Mat4 = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** คูณเมทริกซ์ 4×4 แบบ column-major (รูปแบบเดียวกับ SUTransformation) */
function multiply(a: Mat4, b: Mat4): Mat4 {
    const result = new Float64Array(16);
    for (let column = 0; column < 4; column++)
        for (let row = 0; row < 4; row++)
            result[column * 4 + row] = a[row]! * b[column * 4]! + a[4 + row]! * b[column * 4 + 1]! + a[8 + row]! * b[column * 4 + 2]! + a[12 + row]! * b[column * 4 + 3]!;
    return result;
}

const det3 = (m: Mat4) => m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
