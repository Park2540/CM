import { ApiSchemas } from '@/app/api/api';
import { CONSTRUCTION_PLAN_TEMPLATE, PlanTaskTemplate, SetupOptions, includesTask } from './construction-plan.template';
import { ProjectTimeline, TimelinePhase, TimelineTask } from '@/app/pages/service/project-timeline.service';
import { ContractedProject } from '@/app/pages/service/project.service';

const DAY_MS = 86_400_000;
const HOLD_POINT = /\s*\(Hold Point\)/;
const MILESTONE = /\s*\(Milestone([^)]*)\)/;

/** Dates are handled as whole days since epoch (UTC) so time zones never shift a date. */
const toDay = (iso: string) => {
    const [year, month, day] = iso.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / DAY_MS;
};
const fromDay = (day: number) => new Date(day * DAY_MS);
const addDays = (iso: string, days: number) =>
    fromDay(toDay(iso) + days)
        .toISOString()
        .slice(0, 10);

export type CustomTask = ApiSchemas['CustomTaskInput'];

/** การปรับงานย่อยรายโครงการ: ตัดงานจากแม่แบบออก และเพิ่มงานเอง */
export interface TaskOverrides {
    excluded: string[];
    custom: CustomTask[];
}

export const NO_OVERRIDES: TaskOverrides = { excluded: [], custom: [] };

/** จุดตรวจและหมุดหมายต้องมีทุกโครงการ (ตัดออกไม่ได้) */
export const isRequiredTask = (template: PlanTaskTemplate) => HOLD_POINT.test(template.name) || MILESTONE.test(template.name);

/** งานในแผนของโครงการ (ตามตัวเลือก) พร้อมสถานะว่ารวมในไทม์ไลน์หรือถูกตัดออก */
export interface PlannedTask {
    template: PlanTaskTemplate;
    phaseIndex: number;
    included: boolean;
    custom?: CustomTask;
}

interface ScaledTask {
    template: PlanTaskTemplate;
    phaseIndex: number;
    start: number;
    end: number;
    isMilestone: boolean;
}

/**
 * สร้างไทม์ไลน์ของโครงการจากแม่แบบแผนงาน (ไฟล์ Excel) โดยคัดเฉพาะงานที่ตรงกับการตั้งค่างานก่อสร้าง
 *
 * ยังไม่มีข้อมูลความคืบหน้ารายงานจริงจากหน้างาน จึงคำนวณให้สอดคล้องกับ % ความคืบหน้าของโครงการ:
 * 1. คัดงานตามตัวเลือก (`when`) แล้วย่อ/ขยายวันที่ให้อยู่ระหว่างวันเริ่มและวันส่งมอบของโครงการ
 * 2. หา "จุดเวลา" บนแผนที่งานทั้งหมด (ถ่วงน้ำหนักตามจำนวนวัน) เสร็จรวมกันเท่ากับ % ของโครงการ
 * 3. งานก่อนจุดนั้น = เสร็จแล้ว, งานที่คร่อมจุดนั้น = กำลังทำ, งานหลังจุดนั้น = รอเริ่ม
 * เมื่อมีข้อมูลจริงจาก backend ให้แทนที่ service นี้ด้วยการดึงข้อมูลแผนงานและความคืบหน้าของแต่ละงาน
 */
export class TimelineGenerator {
    build(project: ContractedProject, options: SetupOptions, overrides: TaskOverrides = NO_OVERRIDES): ProjectTimeline {
        const scaledTasks = this.scaleToProject(
            project,
            this.planTasks(options, overrides).filter((task) => task.included)
        );
        const progressPoint = this.findProgressPoint(scaledTasks, project.progress / 100, toDay(project.startDate), toDay(project.deliveryDate) + 1);

        // ขั้นตอนที่ไม่เหลืองานหลังคัดตามตัวเลือกจะไม่แสดง และลำดับขั้นตอนนับใหม่
        const usedPhases = CONSTRUCTION_PLAN_TEMPLATE.map((phase, phaseIndex) => ({ phase, phaseIndex })).filter(({ phaseIndex }) => scaledTasks.some((task) => task.phaseIndex === phaseIndex));
        const phases = usedPhases.map(({ phase, phaseIndex }, index): TimelinePhase => {
            const phaseTasks = scaledTasks.filter((task) => task.phaseIndex === phaseIndex);
            const tasks = phaseTasks.map((task) => this.toTimelineTask(task, progressPoint));
            const workDays = phaseTasks.reduce((sum, task) => sum + (task.end - task.start), 0);
            const doneDays = phaseTasks.reduce((sum, task) => sum + (task.end - task.start) * completion(task, progressPoint), 0);
            const holdPoints = tasks.filter((task) => task.isHoldPoint);

            return {
                step: index + 1,
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

    /**
     * งานทั้งหมดในแผนตามตัวเลือก เรียงตามลำดับในขั้นตอน:
     * - งานจากแม่แบบที่ตรงเงื่อนไข (`when`) — ถูกตัดออกได้ ยกเว้นจุดตรวจและหมุดหมาย
     * - งานที่เพิ่มเอง วางต่อจากงาน afterCode (หรือต่อจากงานสุดท้ายของขั้นตอน) ใช้รหัส <ขั้นตอน>.X<ลำดับ>
     */
    planTasks(options: SetupOptions, overrides: TaskOverrides = NO_OVERRIDES): PlannedTask[] {
        const excluded = new Set(overrides.excluded);
        return CONSTRUCTION_PLAN_TEMPLATE.flatMap((phase, phaseIndex) => {
            const rows: PlannedTask[] = phase.tasks.filter((template) => includesTask(template, options)).map((template) => ({ template, phaseIndex, included: isRequiredTask(template) || !excluded.has(template.code) }));
            const lastWork = [...rows].reverse().find((row) => !MILESTONE.test(row.template.name)) ?? rows.at(-1);
            overrides.custom
                .filter((custom) => custom.phaseCode === phase.code)
                .forEach((custom, index) => {
                    const anchor = rows.find((row) => !row.custom && row.template.code === custom.afterCode) ?? lastWork;
                    const start = anchor ? addDays(anchor.template.end, 1) : phase.tasks[0].start;
                    const template: PlanTaskTemplate = {
                        code: `${phase.code}.X${index + 1}`,
                        name: custom.name.trim() + (custom.isHoldPoint ? ' (Hold Point)' : ''),
                        team: custom.team?.trim() || 'ผู้รับเหมา',
                        start,
                        end: addDays(start, custom.durationDays - 1),
                        note: 'งานที่เพิ่มในการตั้งค่างานก่อสร้างของโครงการนี้'
                    };
                    // วางหลังงานอ้างอิงและงานที่เพิ่มเองต่อจากงานนั้นก่อนหน้า
                    let at = anchor ? rows.indexOf(anchor) + 1 : rows.length;
                    while (at < rows.length && rows[at].custom) at++;
                    rows.splice(at, 0, { template, phaseIndex, included: true, custom });
                });
            return rows;
        });
    }

    private scaleToProject(project: ContractedProject, templateTasks: PlannedTask[]): ScaledTask[] {
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
