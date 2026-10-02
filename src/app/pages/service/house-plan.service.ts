import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiSchemas, apiUrl } from '@/app/api/api';

export type RoomKind = ApiSchemas['RoomKind'];
export type HousePlan = ApiSchemas['HousePlan'];
export type PlanFloor = HousePlan['floors'][number];
/** ห้องในแปลน หน่วยเป็นเมตร วัดจากมุมหลังซ้ายของตัวบ้าน (y เพิ่มไปทางด้านหน้าบ้าน) */
export type PlanRoom = PlanFloor['rooms'][number];

export const ROOM_KIND_LABEL: Record<RoomKind, string> = {
    bedroom: 'ห้องนอน',
    bathroom: 'ห้องน้ำ',
    living: 'ห้องนั่งเล่น',
    dining: 'รับประทานอาหาร',
    kitchen: 'ห้องครัว',
    garage: 'ที่จอดรถ',
    stair: 'บันได',
    void: 'โถงสูง',
    other: 'อื่นๆ'
};

const roomArea = (room: PlanRoom) => room.w * room.h;

export function usableArea(plan: HousePlan): number {
    const area = plan.floors.flatMap((floor) => floor.rooms).filter((room) => room.kind !== 'void' && room.kind !== 'garage');
    return Math.round(area.reduce((sum, room) => sum + roomArea(room), 0));
}

export function countRooms(plan: HousePlan, kind: RoomKind): number {
    return plan.floors.flatMap((floor) => floor.rooms).filter((room) => room.kind === kind).length;
}

/** แบบบ้าน (GET /house-plans/{code}) — มีแปลนรายชั้นและลิงก์ไฟล์โมเดล 3D */
@Injectable({ providedIn: 'root' })
export class HousePlanService {
    private readonly http = inject(HttpClient);

    list(): Observable<HousePlan[]> {
        return this.http.get<HousePlan[]>(apiUrl('/house-plans'));
    }

    get(code: string): Observable<HousePlan> {
        return this.http.get<HousePlan>(apiUrl(`/house-plans/${encodeURIComponent(code)}`));
    }
}
