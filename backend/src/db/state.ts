import mongoose from 'mongoose';

/**
 * เก็บข้อมูลของตรรกะทางธุรกิจ (domain/) ลง MongoDB
 *
 * แต่ละโมดูลประกาศข้อมูลที่ต้องเก็บด้วย persistArray / persistMap / persistObject
 * - ตอนเริ่มเซิร์ฟเวอร์ (loadState): collection ที่มีข้อมูลแล้วจะแทนที่ค่าตั้งต้นในหน่วยความจำ
 *   collection ที่ยังว่างจะถูกใส่ข้อมูลตั้งต้น (seed) ให้
 * - หลังคำขอที่แก้ข้อมูล (saveState): เขียนเฉพาะเอกสารที่เปลี่ยน และลบเอกสารที่ไม่มีแล้ว
 * แต่ละรายการเป็น 1 เอกสาร (_id = รหัสของรายการ) ดู/ค้นใน MongoDB ได้ตามปกติ
 */

type Doc = { _id: string } & Record<string, unknown>;

interface Binding {
    collection: string;
    dump(): Doc[];
    load(docs: Doc[]): void;
}

const bindings: Binding[] = [];
/** ค่าที่เขียนลงฐานข้อมูลล่าสุดต่อเอกสาร (ใช้ตรวจว่าเปลี่ยนไหม) */
const written = new Map<string, Map<string, string>>();

const stripId = ({ _id, _index, ...rest }: Doc) => rest;

/**
 * อาร์เรย์ของรายการ — key คือรหัสของรายการ (เช่น id หรือ code)
 * ลำดับในอาร์เรย์: ปกติเก็บตำแหน่งไว้ใน _index (เหมาะกับรายการที่เพิ่มต่อท้าย)
 * รายการที่เพิ่มไว้ข้างหน้า (ล่าสุดก่อน) ให้ส่ง order เพื่อเรียงตอนโหลดแทน ไม่ต้องเขียนตำแหน่งใหม่ทุกรายการ
 */
export function persistArray<T extends object>(collection: string, items: T[], key: (item: T) => string, order?: (a: T, b: T) => number) {
    bindings.push({
        collection,
        dump: () => items.map((item, index) => ({ ...(item as Record<string, unknown>), _id: key(item), ...(order ? {} : { _index: index }) })),
        load: (docs) => {
            const sorted = order ? (docs.map(stripId) as T[]).sort(order) : [...docs].sort((a, b) => Number(a['_index']) - Number(b['_index'])).map((doc) => stripId(doc) as T);
            items.splice(0, items.length, ...sorted);
        }
    });
}

/** Map<key, value> — เก็บเป็น { _id: key, value } */
export function persistMap<V>(collection: string, map: Map<string, V>) {
    bindings.push({
        collection,
        dump: () => [...map.entries()].map(([key, value]) => ({ _id: key, value })),
        load: (docs) => {
            map.clear();
            for (const doc of docs) map.set(doc._id, doc['value'] as V);
        }
    });
}

/** อ็อบเจกต์เดียว (เช่น การตั้งค่า) — เก็บเป็นเอกสาร _id = 'singleton' */
export function persistObject<T extends object>(collection: string, object: T) {
    bindings.push({
        collection,
        dump: () => [{ ...(object as Record<string, unknown>), _id: 'singleton' }],
        load: (docs) => {
            if (docs[0]) Object.assign(object, stripId(docs[0]));
        }
    });
}

const db = () => {
    if (!mongoose.connection.db) throw new Error('ยังไม่ได้เชื่อมต่อฐานข้อมูล');
    return mongoose.connection.db;
};

/** โหลดข้อมูลจากฐานข้อมูล (collection ว่าง = ใส่ข้อมูลตั้งต้น) — เรียกครั้งเดียวตอนเริ่มเซิร์ฟเวอร์ */
export async function loadState(): Promise<{ seeded: string[] }> {
    const seeded: string[] = [];
    for (const binding of bindings) {
        const docs = (await db().collection<Doc>(binding.collection).find().toArray()) as Doc[];
        if (docs.length) {
            binding.load(docs);
            written.set(binding.collection, new Map(docs.map((doc) => [doc._id, JSON.stringify(doc)])));
        } else {
            seeded.push(binding.collection);
        }
    }
    await saveState();
    return { seeded };
}

let saving: Promise<void> = Promise.resolve();

/** เขียนการเปลี่ยนแปลงลงฐานข้อมูล (ต่อคิวกัน ไม่เขียนซ้อน) */
export function saveState(): Promise<void> {
    saving = saving.then(writeChanges, writeChanges);
    return saving;
}

async function writeChanges() {
    for (const binding of bindings) {
        const previous = written.get(binding.collection) ?? new Map<string, string>();
        const current = new Map<string, string>();
        const operations: mongoose.mongo.AnyBulkWriteOperation<Doc>[] = [];
        for (const doc of binding.dump()) {
            // แปลงผ่าน JSON เพื่อตัด undefined และให้เทียบการเปลี่ยนแปลงได้
            const serialized = JSON.stringify(doc);
            current.set(doc._id, serialized);
            if (previous.get(doc._id) !== serialized) operations.push({ replaceOne: { filter: { _id: doc._id }, replacement: JSON.parse(serialized) as Doc, upsert: true } });
        }
        for (const id of previous.keys()) if (!current.has(id)) operations.push({ deleteOne: { filter: { _id: id } } });
        if (operations.length) await db().collection<Doc>(binding.collection).bulkWrite(operations, { ordered: false });
        written.set(binding.collection, current);
    }
}
