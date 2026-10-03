/** ข้อมูลแบบบ้านของโครงการที่ผู้ตั้งค่ากรอกเอง: รายละเอียด ภาพแปลนรายชั้น และภาพทัศนียภาพ 4 มุม */
import { persistMap } from '../db/state.js';
import type { ApiSchemas } from '../api/api.js';
import { HOUSE_PLANS } from './house-plans.js';
import { findProject } from './projects.js';

type ProjectHouse = ApiSchemas['ProjectHouse'];
type StoredHouse = Omit<ProjectHouse, 'configured'>;

/** รหัสโครงการ → ข้อมูลแบบบ้าน */
const houses = new Map<string, StoredHouse>();

/** ยังไม่ตั้งค่า: เติมรายละเอียดจากแบบบ้านในคลังที่เลือกตอนเปิดโครงการ (ภาพว่าง) */
export function getHouse(code: string): ProjectHouse {
    const saved = houses.get(code);
    if (saved) return { configured: true, ...saved };
    const project = findProject(code);
    const plan = HOUSE_PLANS.find((item) => item.code === project?.housePlanCode);
    if (!plan) return { configured: false, name: project?.housePlanName ?? '', floorPlans: [], renders: {} };
    const rooms = plan.floors.flatMap((floor) => floor.rooms);
    const count = (kind: ApiSchemas['RoomKind']) => rooms.filter((room) => room.kind === kind).length;
    return {
        configured: false,
        name: plan.name,
        description: plan.description,
        usableArea: Math.round(rooms.filter((room) => room.kind !== 'void' && room.kind !== 'garage').reduce((sum, room) => sum + room.w * room.h, 0)),
        width: plan.width,
        depth: plan.depth,
        floors: plan.floors.length,
        bedrooms: count('bedroom'),
        bathrooms: count('bathroom'),
        kitchens: count('kitchen'),
        parking: plan.parking,
        floorPlans: [],
        renders: {}
    };
}

export function saveHouse(code: string, house: StoredHouse): ProjectHouse {
    houses.set(code, house);
    return getHouse(code);
}

persistMap('project_houses', houses);
