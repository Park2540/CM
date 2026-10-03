import type { ApiSchemas } from '../api/api.js';

/** ชนิดข้อมูลและฟังก์ชันช่วยที่ใช้ร่วมกันในตรรกะโครงการ (ตรงกับฝั่งหน้าบ้าน) */

export type Project = ApiSchemas['Project'];
export type ContractedProject = Project & { value: number; startDate: string; deliveryDate: string; location: string; contractSignedAt: string };

export function isContracted(project: Project | null | undefined): project is ContractedProject {
    return !!project && project.status !== 'pending-contract' && project.value !== null && !!project.startDate && !!project.deliveryDate;
}

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

const dateOnly = (value: string) => new Date(`${value}T00:00:00Z`);

/** ไทม์ไลน์รูปแบบ API (วันที่เป็นข้อความ) → แบบ Date สำหรับตัวสร้างงวดงาน/ภาพ/เอกสาร */
export function timelineFromApi(timeline: ApiSchemas['ProjectTimeline']): ProjectTimeline {
    return {
        progress: timeline.progress,
        phases: timeline.phases.map((phase) => ({
            ...phase,
            start: dateOnly(phase.start),
            end: dateOnly(phase.end),
            tasks: phase.tasks.map((task) => ({ ...task, start: dateOnly(task.start), end: dateOnly(task.end) }))
        }))
    };
}
