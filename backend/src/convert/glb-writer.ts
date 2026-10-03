/** เขียน glTF 2.0 binary (.glb) จากต้นไม้ node ที่มี geometry แยกตามวัสดุ — ใช้ร่วมกันระหว่างตัวแปลง .skp และ .ifc */

type Typed = Float32Array | Uint32Array | Int8Array;
type TypedConstructor = Float32ArrayConstructor | Uint32ArrayConstructor | Int8ArrayConstructor;

/** typed array ที่ขยายได้ */
export class Grow {
    private data: Typed;
    length = 0;

    constructor(private readonly Type: TypedConstructor) {
        this.data = new Type(1024);
    }

    push3(a: number, b: number, c: number) {
        this.reserve(3);
        this.data[this.length++] = a;
        this.data[this.length++] = b;
        this.data[this.length++] = c;
    }

    push4(a: number, b: number, c: number, d: number) {
        this.reserve(4);
        this.data[this.length++] = a;
        this.data[this.length++] = b;
        this.data[this.length++] = c;
        this.data[this.length++] = d;
    }

    private reserve(count: number) {
        if (this.length + count <= this.data.length) return;
        const next = new this.Type(Math.max(this.data.length * 2, this.length + count));
        next.set(this.data);
        this.data = next;
    }

    view(): Typed {
        return this.data.subarray(0, this.length);
    }
}

/** geometry 1 วัสดุ: ตำแหน่ง (เมตร, Y-up) normal แบบ int8 (x, y, z, 0) และ index */
export interface GlbPart {
    /** วัสดุที่ key เดียวกันใช้ material เดียวกันในไฟล์ */
    materialKey: string;
    /** สี sRGB 0-255 */
    color: [number, number, number];
    alpha: number;
    positions: Grow;
    normals: Grow;
    indices: Grow;
    vertexCount: number;
}

export interface GlbNode {
    name: string;
    extras?: Record<string, unknown>;
    parts?: GlbPart[];
    children?: GlbNode[];
}

export const newPart = (materialKey: string, color: [number, number, number], alpha = 1): GlbPart => ({
    materialKey,
    color,
    alpha,
    positions: new Grow(Float32Array),
    normals: new Grow(Int8Array),
    indices: new Grow(Uint32Array),
    vertexCount: 0
});

/** ใส่ normal (ยังไม่ normalize) ให้เป็น int8 ตาม KHR_mesh_quantization */
export function pushNormal(part: GlbPart, x: number, y: number, z: number) {
    const length = (Math.hypot(x, y, z) || 1) / 127;
    part.normals.push4(Math.round(x / length), Math.round(y / length), Math.round(z / length), 0);
}

const srgbToLinear = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** เขียนไฟล์: 1 mesh ต่อ node ที่มี parts (แยก primitive ตามวัสดุ) normal เป็น int8 (KHR_mesh_quantization) */
export function writeGlb(root: GlbNode, generator: string): Buffer {
    type Json = Record<string, unknown>;
    const json = {
        asset: { version: '2.0', generator },
        extensionsUsed: ['KHR_mesh_quantization'],
        extensionsRequired: ['KHR_mesh_quantization'],
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [] as Json[],
        meshes: [] as Json[],
        materials: [] as Json[],
        accessors: [] as Json[],
        bufferViews: [] as Json[],
        buffers: [] as Json[]
    };
    const chunks: Buffer[] = [];
    let offset = 0;
    const addView = (typed: Typed, target: number, byteStride?: number) => {
        const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
        json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target, ...(byteStride ? { byteStride } : {}) });
        chunks.push(bytes);
        offset += bytes.length;
        const pad = (4 - (offset % 4)) % 4;
        if (pad) {
            chunks.push(Buffer.alloc(pad));
            offset += pad;
        }
        return json.bufferViews.length - 1;
    };
    const materialIndex = new Map<string, number>();
    const materialOf = (part: GlbPart) => {
        let index = materialIndex.get(part.materialKey);
        if (index === undefined) {
            const [r, g, b] = part.color;
            index =
                json.materials.push({
                    pbrMetallicRoughness: { baseColorFactor: [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), part.alpha], metallicFactor: 0, roughnessFactor: 0.9 },
                    doubleSided: true,
                    ...(part.alpha < 1 ? { alphaMode: 'BLEND' } : {})
                }) - 1;
            materialIndex.set(part.materialKey, index);
        }
        return index;
    };
    const meshOf = (parts: GlbPart[]) => {
        const primitives = parts
            .filter((part) => part.vertexCount)
            .map((part) => {
                const positions = part.positions.view();
                const min = [Infinity, Infinity, Infinity];
                const max = [-Infinity, -Infinity, -Infinity];
                for (let i = 0; i < positions.length; i += 3)
                    for (let k = 0; k < 3; k++) {
                        const value = positions[i + k]!;
                        if (value < min[k]!) min[k] = value;
                        if (value > max[k]!) max[k] = value;
                    }
                const vertexCount = positions.length / 3;
                const position = json.accessors.push({ bufferView: addView(positions, 34962), componentType: 5126, count: vertexCount, type: 'VEC3', min, max }) - 1;
                // int8 normalized เว้นไบต์ที่ 4 ไว้ให้แต่ละจุดชิดขอบ 4 ไบต์ตามข้อกำหนด glTF
                const normal = json.accessors.push({ bufferView: addView(part.normals.view(), 34962, 4), componentType: 5120, normalized: true, count: vertexCount, type: 'VEC3' }) - 1;
                const index = json.accessors.push({ bufferView: addView(part.indices.view(), 34963), componentType: 5125, count: part.indices.length, type: 'SCALAR' }) - 1;
                return { attributes: { POSITION: position, NORMAL: normal }, indices: index, material: materialOf(part) };
            });
        return primitives.length ? json.meshes.push({ primitives }) - 1 : undefined;
    };
    const addNode = (node: GlbNode): number => {
        const index = json.nodes.push({ name: node.name }) - 1;
        const entry = json.nodes[index]!;
        if (node.extras) entry['extras'] = node.extras;
        const mesh = node.parts ? meshOf(node.parts) : undefined;
        if (mesh !== undefined) entry['mesh'] = mesh;
        if (node.children?.length) entry['children'] = node.children.map(addNode);
        return index;
    };
    addNode(root);
    json.buffers.push({ byteLength: offset });

    let jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
    const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
    if (jsonPad) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
    const bin = Buffer.concat(chunks);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0); // 'glTF'
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + bin.length, 8);
    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonBytes.length, 0);
    jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(bin.length, 0);
    binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN'
    return Buffer.concat([header, jsonHeader, jsonBytes, binHeader, bin]);
}
