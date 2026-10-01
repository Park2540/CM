import { Injectable } from '@angular/core';
import { CONSTRUCTION_PLAN_TEMPLATE, PlanTaskTemplate } from './construction-plan.template';
import { Project } from './project.service';

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

const DAY_MS = 86_400_000;
const HOLD_POINT = /\s*\(Hold Point\)/;
const MILESTONE = /\s*\(Milestone([^)]*)\)/;

/** Dates are handled as whole days since epoch (UTC) so time zones never shift a date. */
const toDay = (iso: string) => {
    const [year, month, day] = iso.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / DAY_MS;
};
const fromDay = (day: number) => new Date(day * DAY_MS);

export function todayAsDate(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

interface ScaledTask {
    template: PlanTaskTemplate;
    phaseIndex: number;
    start: number;
    end: number;
    isMilestone: boolean;
}

/**
 * สร้างไทม์ไลน์ของโครงการจากแม่แบบแผนงาน (ไฟล์ Excel)
 *
 * ยังไม่มีข้อมูลความคืบหน้ารายงานจริงจากหน้างาน จึงคำนวณให้สอดคล้องกับ % ความคืบหน้าของโครงการ:
 * 1. ย่อ/ขยายวันที่ในแม่แบบให้อยู่ระหว่างวันเริ่มและวันส่งมอบของโครงการ
 * 2. หา "จุดเวลา" บนแผนที่งานทั้งหมด (ถ่วงน้ำหนักตามจำนวนวัน) เสร็จรวมกันเท่ากับ % ของโครงการ
 * 3. งานก่อนจุดนั้น = เสร็จแล้ว, งานที่คร่อมจุดนั้น = กำลังทำ, งานหลังจุดนั้น = รอเริ่ม
 * เมื่อมีข้อมูลจริงจาก backend ให้แทนที่ service นี้ด้วยการดึงข้อมูลแผนงานและความคืบหน้าของแต่ละงาน
 */
@Injectable({ providedIn: 'root' })
export class ProjectTimelineService {
    build(project: Project): ProjectTimeline {
        const scaledTasks = this.scaleToProject(project);
        const progressPoint = this.findProgressPoint(scaledTasks, project.progress / 100, toDay(project.startDate), toDay(project.deliveryDate) + 1);

        const phases = CONSTRUCTION_PLAN_TEMPLATE.map((phase, phaseIndex): TimelinePhase => {
            const phaseTasks = scaledTasks.filter((task) => task.phaseIndex === phaseIndex);
            const tasks = phaseTasks.map((task) => this.toTimelineTask(task, progressPoint));
            const workDays = phaseTasks.reduce((sum, task) => sum + (task.end - task.start), 0);
            const doneDays = phaseTasks.reduce((sum, task) => sum + (task.end - task.start) * completion(task, progressPoint), 0);
            const holdPoints = tasks.filter((task) => task.isHoldPoint);

            return {
                step: phaseIndex + 1,
                code: phase.code,
                name: phase.name,
                shortName: phase.shortName,
                summary: phase.summary,
                start: new Date(Math.min(...tasks.map((task) => task.start.getTime()))),
                end: new Date(Math.max(...tasks.map((task) => task.end.getTime()))),
                progress: workDays > 0 ? Math.round((doneDays / workDays) * 100) : 0,
                status: tasks.every((task) => task.status === 'done') ? 'done' : tasks.some((task) => task.status !== 'pending') ? 'active' : 'pending',
                tasks,
                holdPoints: { passed: holdPoints.filter((task) => task.status === 'done').length, total: holdPoints.length }
            };
        });

        return { phases, progress: project.progress };
    }

    private scaleToProject(project: Project): ScaledTask[] {
        const templateTasks = CONSTRUCTION_PLAN_TEMPLATE.flatMap((phase, phaseIndex) => phase.tasks.map((template) => ({ template, phaseIndex })));
        const templateStart = Math.min(...templateTasks.map(({ template }) => toDay(template.start)));
        const templateEnd = Math.max(...templateTasks.map(({ template }) => toDay(template.end) + 1));
        const projectStart = toDay(project.startDate);
        const projectEnd = toDay(project.deliveryDate) + 1;
        const scale = (projectEnd - projectStart) / (templateEnd - templateStart);
        const toProjectDay = (day: number) => projectStart + (day - templateStart) * scale;

        return templateTasks.map(({ template, phaseIndex }) => {
            const isMilestone = MILESTONE.test(template.name);
            const end = toProjectDay(toDay(template.end) + 1);
            // Milestones are a point in time at the end of their day and carry no work weight.
            return { template, phaseIndex, isMilestone, start: isMilestone ? end : toProjectDay(toDay(template.start)), end };
        });
    }

    /** Binary search for the day at which weighted completion of all tasks equals the target ratio. */
    private findProgressPoint(tasks: ScaledTask[], target: number, projectStart: number, projectEnd: number): number {
        if (target <= 0) return projectStart;
        if (target >= 1) return projectEnd;

        const totalDays = tasks.reduce((sum, task) => sum + (task.end - task.start), 0);
        const overall = (point: number) => tasks.reduce((sum, task) => sum + (task.end - task.start) * completion(task, point), 0) / totalDays;

        let low = projectStart;
        let high = projectEnd;
        for (let i = 0; i < 50; i++) {
            const mid = (low + high) / 2;
            if (overall(mid) < target) low = mid;
            else high = mid;
        }
        return high;
    }

    private toTimelineTask(task: ScaledTask, progressPoint: number): TimelineTask {
        const progress = Math.round(completion(task, progressPoint) * 100);
        const startDay = task.isMilestone ? Math.ceil(task.end) - 1 : Math.floor(task.start);
        const endDay = Math.max(startDay, Math.ceil(task.end) - 1);
        const milestoneLabel = task.template.name.match(MILESTONE)?.[1] ?? '';

        return {
            code: task.template.code,
            name: task.template.name.replace(HOLD_POINT, '').replace(MILESTONE, ''),
            team: task.template.team,
            note: task.template.note,
            start: fromDay(startDay),
            end: fromDay(endDay),
            progress,
            status: progress >= 100 ? 'done' : progress > 0 ? 'active' : 'pending',
            isHoldPoint: HOLD_POINT.test(task.template.name),
            isMilestone: task.isMilestone,
            isPaymentMilestone: milestoneLabel.includes('งวดงาน'),
            involvesOwner: /เจ้าของงาน|ทุกฝ่าย/.test(task.template.team)
        };
    }
}

function completion(task: ScaledTask, point: number): number {
    if (task.isMilestone) return point >= task.end ? 1 : 0;
    return Math.min(1, Math.max(0, (point - task.start) / (task.end - task.start)));
}
