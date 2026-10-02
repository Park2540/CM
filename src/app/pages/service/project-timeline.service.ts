/** โมเดลไทม์ไลน์ฝั่งหน้าบ้าน (ข้อมูลมาจาก GET /projects/{code}/timeline ผ่าน ProjectProgressService) */
export type TimelineStatus = 'done' | 'active' | 'pending';

export interface TimelineTask {
    code: string;
    name: string;
    team: string;
    note?: string;
    start: Date;
    end: Date;
    progress: number;
    status: TimelineStatus;
    isHoldPoint: boolean;
    isMilestone: boolean;
    isPaymentMilestone: boolean;
    involvesOwner: boolean;
}

export interface TimelinePhase {
    step: number;
    code: string;
    name: string;
    shortName: string;
    summary: string;
    start: Date;
    end: Date;
    progress: number;
    status: TimelineStatus;
    tasks: TimelineTask[];
    holdPoints: { passed: number; total: number };
}

export interface ProjectTimeline {
    phases: TimelinePhase[];
    progress: number;
}

/** วันนี้ (เที่ยงคืน UTC) ใช้เทียบกับวันที่ตามแผนซึ่งเป็นวันที่ไม่มีเวลา */
export function todayAsDate(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
