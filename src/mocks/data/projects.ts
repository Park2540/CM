import { ApiSchemas } from '@/app/api/api';
import { ProjectTimeline } from '@/app/pages/service/project-timeline.service';
import { CONSTRUCTION_PLAN_TEMPLATE } from '../generators/construction-plan.template';
import { TaskOverrides, TimelineGenerator, isRequiredTask } from '../generators/timeline-generator';
import { recordAudit } from './audit-logs';
import { defaultOptions, toPlanOptions } from './construction-options';
import { PROJECT_SEED } from './project-seed';
import { ContractedProject, isContracted } from '@/app/pages/service/project.service';

type Timeline = ApiSchemas['ProjectTimeline'];
type Task = ApiSchemas['TimelineTask'];
type ProgressUpdate = ApiSchemas['ProgressUpdate'];

const DAY_MS = 86_400_000;
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** วันนี้ตามเวลาเครื่อง (YYYY-MM-DD) */
export const todayIso = () => new Intl.DateTimeFormat('en-CA').format(new Date());

const timelineGenerator = new TimelineGenerator();

/** ข้อมูลตั้งต้นของโครงการ (progress ตามที่ตั้งไว้ ไม่รวมการอัปเดตงาน) */
const findSeed = (code: string) => PROJECT_SEED.find((project) => project.code === code);
export const findProject = findSeed;

/** โครงการที่บันทึกสัญญาแล้ว (มีแผนงาน งวดงาน ภาพ เอกสาร) */
export function findContracted(code: string): ContractedProject | undefined {
    const seed = findSeed(code);
    return isContracted(seed) ? seed : undefined;
}

/**
 * โครงการตามสถานะปัจจุบัน: % มาจากไทม์ไลน์ (เปลี่ยนตามการอัปเดตงาน)
 * สถานะเปลี่ยนเป็น completed เมื่อครบ 100% หรือ delayed เมื่อเลยกำหนดส่งมอบแต่ยังไม่เสร็จ
 * โครงการที่ยังไม่บันทึกสัญญาคงสถานะ pending-contract
 * เมื่อเสร็จ 100% ถือว่าส่งมอบแล้ว: บันทึกวันส่งมอบ (ครั้งแรกที่ครบ) และนับระยะประกันจากวันนั้น
 */
export function currentProject(code: string): ApiSchemas['Project'] | undefined {
    const seed = findSeed(code);
    if (!seed) return undefined;
    const notHandedOver = { handedOverAt: null, warrantyUntil: null };
    if (!isContracted(seed)) return { ...seed, ...notHandedOver, progress: 0, status: 'pending-contract', setupConfiguredAt: null };
    const setupConfiguredAt = setups.get(code)?.configuredAt ?? null;
    if (!setupConfiguredAt) return { ...seed, ...notHandedOver, progress: 0, status: 'planning', setupConfiguredAt };
    const progress = getTimeline(code)?.progress ?? seed.progress;
    if (progress >= 100) {
        seed.handedOverAt ??= todayIso();
        return { ...seed, progress, status: 'completed', setupConfiguredAt, handedOverAt: seed.handedOverAt, warrantyUntil: addMonths(seed.handedOverAt, WARRANTY_MONTHS) };
    }
    const status: ApiSchemas['ProjectStatus'] = seed.deliveryDate < todayIso() ? 'delayed' : seed.status === 'completed' ? 'in-progress' : seed.status;
    return { ...seed, ...notHandedOver, progress, status, setupConfiguredAt };
}

/** ระยะรับประกันผลงานหลังส่งมอบ (เดือน) — ภายหลังย้ายไปตั้งค่าบริษัท */
export const WARRANTY_MONTHS = 12;

function addMonths(isoDate: string, months: number): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10);
}

/** กลุ่มของโครงการตาม ProjectGroup ในสัญญา API */
export function inGroup(project: ApiSchemas['Project'], group: ApiSchemas['ProjectGroup']): boolean {
    switch (group) {
        case 'pending-contract':
            return project.status === 'pending-contract';
        case 'active':
            return project.status !== 'pending-contract' && project.status !== 'completed';
        case 'in-hand':
            return project.status !== 'completed';
        case 'completed':
            return project.status === 'completed';
        case 'warranty':
            return project.status === 'completed' && !!project.warrantyUntil && project.warrantyUntil >= todayIso();
    }
}

export const listProjects = () => PROJECT_SEED.map((project) => currentProject(project.code)!);

const DAY_MS_PORTFOLIO = 86_400_000;

/** จำนวนโครงการตามกลุ่มสำหรับ Dashboard */
export function projectPortfolio(includeValue: boolean): ApiSchemas['ProjectPortfolio'] {
    const projects = listProjects();
    const count = (group: ApiSchemas['ProjectGroup']) => projects.filter((project) => inGroup(project, group)).length;
    const active = projects.filter((project) => inGroup(project, 'active'));
    const today = todayIso();
    return {
        asOf: new Date().toISOString(),
        warrantyMonths: WARRANTY_MONTHS,
        counts: { total: projects.length, inHand: count('in-hand'), pendingContract: count('pending-contract'), active: active.length, completed: count('completed'), warranty: count('warranty') },
        activeByStatus: {
            planning: active.filter((project) => project.status === 'planning').length,
            'in-progress': active.filter((project) => project.status === 'in-progress').length,
            'near-handover': active.filter((project) => project.status === 'near-handover').length,
            delayed: active.filter((project) => project.status === 'delayed').length
        },
        ...(includeValue ? { inHandValue: active.reduce((sum, project) => sum + (project.value ?? 0), 0) } : {}),
        warranties: projects
            .filter((project) => inGroup(project, 'warranty'))
            .map((project) => ({
                code: project.code,
                name: project.name,
                customerName: project.customerName,
                handedOverAt: project.handedOverAt!,
                warrantyUntil: project.warrantyUntil!,
                daysLeft: Math.round((Date.parse(project.warrantyUntil!) - Date.parse(today)) / DAY_MS_PORTFOLIO)
            }))
            .sort((a, b) => a.warrantyUntil.localeCompare(b.warrantyUntil))
    };
}

/** รหัสภูมิภาคสำหรับขึ้นต้นรหัสโครงการ (ตั้งค่าได้ในอนาคตที่ "ตั้งค่าโครงการ") */
export const PROJECT_REGIONS: ApiSchemas['ProjectRegion'][] = [
    { code: 'CR', province: 'เชียงราย' },
    { code: 'CNX', province: 'เชียงใหม่' },
    { code: 'PYO', province: 'พะเยา' },
    { code: 'LPG', province: 'ลำปาง' },
    { code: 'LPN', province: 'ลำพูน' },
    { code: 'PRE', province: 'แพร่' },
    { code: 'NAN', province: 'น่าน' },
    { code: 'BKK', province: 'กรุงเทพมหานคร' },
    { code: 'PKT', province: 'ภูเก็ต' }
];

/** รหัสโครงการ: รหัสภูมิภาค + ปี พ.ศ. 2 หลักของวันที่เปิดโครงการ + ลำดับ 4 หลัก เช่น CR690004 */
function nextProjectCode(regionCode: string, openedOn: string): string {
    const prefix = `${regionCode}${String(Number(openedOn.slice(0, 4)) + 543).slice(-2)}`;
    const highest = Math.max(0, ...PROJECT_SEED.filter((project) => project.code.startsWith(prefix) && /^\d{4}$/.test(project.code.slice(prefix.length))).map((project) => Number(project.code.slice(prefix.length))));
    return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

const optional = (value: string | undefined) => value?.trim() || undefined;

/** เปิดโครงการ: ออกรหัสและบันทึกข้อมูลเบื้องต้น สถานะ pending-contract (ยังไม่มีแผนงานจนกว่าจะบันทึกสัญญา) */
export function createProject(input: ApiSchemas['ProjectInput']): ApiSchemas['Project'] {
    const code = nextProjectCode(input.regionCode, todayIso());
    PROJECT_SEED.push({
        code,
        name: input.name.trim(),
        housePlanName: input.housePlanName.trim(),
        housePlanCode: optional(input.housePlanCode),
        requirements: optional(input.requirements),
        location: null,
        customerName: input.customerName.trim(),
        phone: input.phone.trim(),
        customerEmail: optional(input.customerEmail),
        customerLineId: optional(input.customerLineId),
        customerAddress: optional(input.customerAddress),
        responsibleName: input.responsibleName.trim(),
        value: null,
        startDate: null,
        deliveryDate: null,
        contractSignedAt: null,
        createdAt: new Date().toISOString(),
        progress: 0,
        status: 'pending-contract'
    });
    recordAudit({ module: 'project', action: 'เปิดโครงการ', target: code, detail: `${input.customerName.trim()} · แบบบ้าน ${input.housePlanName.trim()}` });
    return currentProject(code)!;
}

/** บันทึกสัญญา: เติมมูลค่า/วันที่/ที่ตั้ง — แผนงานและงวดงานสร้างหลังตั้งค่างานก่อสร้าง (saveSetup) */
export function recordContract(code: string, input: ApiSchemas['ContractInput']): ApiSchemas['Project'] {
    const seed = findSeed(code)!;
    const region = PROJECT_REGIONS.find((item) => code.startsWith(item.code));
    const location = input.location.trim();
    Object.assign(seed, {
        value: input.value,
        contractSignedAt: input.signedDate,
        startDate: input.startDate,
        deliveryDate: input.deliveryDate,
        location: region && !location.includes(region.province) ? `${location} จ.${region.province}` : location,
        status: 'planning'
    } satisfies Partial<ApiSchemas['Project']>);
    recordAudit({ module: 'project', action: 'บันทึกสัญญา', target: code, detail: `฿${input.value.toLocaleString('th-TH')} · เริ่ม ${input.startDate} ส่งมอบ ${input.deliveryDate}` });
    return currentProject(code)!;
}

function toApi(timeline: ProjectTimeline): Timeline {
    return {
        progress: timeline.progress,
        phases: timeline.phases.map((phase) => ({
            ...phase,
            start: isoDate(phase.start),
            end: isoDate(phase.end),
            tasks: phase.tasks.map((task) => ({ ...task, start: isoDate(task.start), end: isoDate(task.end) }))
        }))
    };
}

const taskDays = (task: Task) => (Date.parse(task.end) - Date.parse(task.start)) / DAY_MS + 1;
const statusOf = (progress: number): Task['status'] => (progress >= 100 ? 'done' : progress > 0 ? 'active' : 'pending');

/** คำนวณสถานะ/% ของขั้นตอนและภาพรวมใหม่ หลังงานย่อยเปลี่ยน (ถ่วงน้ำหนักตามจำนวนวัน) */
export function recalculate(timeline: Timeline) {
    let totalDays = 0;
    let doneDays = 0;
    for (const phase of timeline.phases) {
        const work = phase.tasks.filter((task) => !task.isMilestone);
        const phaseDone = work.every((task) => task.progress >= 100);
        for (const task of phase.tasks) {
            if (task.isMilestone) task.progress = phaseDone ? 100 : 0;
            task.status = statusOf(task.progress);
        }
        const days = work.reduce((sum, task) => sum + taskDays(task), 0);
        const done = work.reduce((sum, task) => sum + (taskDays(task) * task.progress) / 100, 0);
        totalDays += days;
        doneDays += done;
        phase.progress = days ? Math.round((done / days) * 100) : 0;
        phase.status = phase.tasks.every((task) => task.status === 'done') ? 'done' : phase.tasks.some((task) => task.status !== 'pending') ? 'active' : 'pending';
        const holdPoints = phase.tasks.filter((task) => task.isHoldPoint);
        phase.holdPoints = { passed: holdPoints.filter((task) => task.status === 'done').length, total: holdPoints.length };
    }
    timeline.progress = totalDays ? Math.round((doneDays / totalDays) * 100) : 0;
}

const timelines = new Map<string, Timeline>();

interface StoredSetup {
    configuredAt: string;
    configuredBy: string;
    options: ApiSchemas['ConstructionSetupOptions'];
    excludedTasks: string[];
    customTasks: ApiSchemas['CustomTaskInput'][];
}

/** การตั้งค่างานก่อสร้างรายโครงการ — โครงการตัวอย่างที่มีสัญญาแล้วถือว่าตั้งค่าตามแบบบ้านไว้แล้ว */
const setups = new Map<string, StoredSetup>(
    PROJECT_SEED.filter(isContracted).map((project) => [
        project.code,
        { configuredAt: `${project.contractSignedAt}T10:00:00+07:00`, configuredBy: project.responsibleName, options: defaultOptions(project.housePlanCode), excludedTasks: [], customTasks: [] }
    ])
);

const overridesOf = (setup: StoredSetup): TaskOverrides => ({ excluded: setup.excludedTasks, custom: setup.customTasks });

/** แก้การตั้งค่าไม่ได้เมื่อเริ่มรายงานความคืบหน้าแล้ว (ไทม์ไลน์เดิมจะถูกแทนที่ทั้งหมด) */
function lockReason(code: string): string | undefined {
    if (!setups.has(code)) return undefined;
    const started = getTimeline(code)?.phases.some((phase) => phase.tasks.some((task) => task.progress > 0)) || getUpdates(code).length > 0;
    return started ? 'เริ่มรายงานความคืบหน้าแล้ว แก้การตั้งค่าไม่ได้ (ไทม์ไลน์ใช้งานอยู่)' : undefined;
}

export function getSetup(code: string): ApiSchemas['ProjectSetup'] {
    const stored = setups.get(code);
    const reason = lockReason(code);
    return {
        configured: !!stored,
        locked: !!reason,
        ...(reason ? { lockedReason: reason } : {}),
        configuredAt: stored?.configuredAt ?? null,
        configuredBy: stored?.configuredBy ?? null,
        options: stored?.options ?? defaultOptions(findSeed(code)?.housePlanCode),
        excludedTasks: stored?.excludedTasks ?? [],
        customTasks: stored?.customTasks ?? []
    };
}

export const isSetupLocked = (code: string) => !!lockReason(code);
export const isConfigured = (code: string) => setups.has(code);

const MAX_CUSTOM_TASKS = 50;

/**
 * ตรวจการปรับงานย่อย (เรียกหลัง normalizeOptions ผ่านแล้ว)
 * - งานที่ตัดออก: เก็บเฉพาะรหัสที่อยู่ในแผนตามตัวเลือก; ตัดจุดตรวจ/หมุดหมายไม่ได้
 * - งานที่เพิ่มเอง: ต้องมีชื่อ ขั้นตอนที่มีอยู่ ระยะเวลา 1-120 วัน และงานอ้างอิง (ถ้าระบุ) ต้องอยู่ในขั้นตอนเดียวกัน
 */
export function normalizeOverrides(options: ApiSchemas['ConstructionSetupOptions'], input: Partial<ApiSchemas['ProjectSetupInput']>): { overrides: TaskOverrides; errors: Record<string, string> } {
    const errors: Record<string, string> = {};
    const planned = timelineGenerator.planTasks(toPlanOptions(options));
    const byCode = new Map(planned.map((task) => [task.template.code, task]));

    const excluded = [...new Set(input.excludedTasks ?? [])].filter((code) => byCode.has(code));
    const required = excluded.filter((code) => isRequiredTask(byCode.get(code)!.template));
    if (required.length) errors['excludedTasks'] = `ตัดจุดตรวจหรือหมุดหมายออกไม่ได้: ${required.join(', ')}`;

    const custom = (input.customTasks ?? []).map((task) => ({ ...task, name: task.name?.trim() ?? '', team: task.team?.trim() || undefined }));
    if (custom.length > MAX_CUSTOM_TASKS) errors['customTasks'] = `เพิ่มงานเองได้ไม่เกิน ${MAX_CUSTOM_TASKS} งาน`;
    const ids = new Set<string>();
    for (const task of custom) {
        const key = `customTasks.${task.id}`;
        const phase = CONSTRUCTION_PLAN_TEMPLATE.find((item) => item.code === task.phaseCode);
        if (!task.id || ids.has(task.id)) errors['customTasks'] = 'รหัสงานที่เพิ่มเองซ้ำกัน';
        else if (!phase) errors[key] = 'ไม่พบขั้นตอนนี้ในแผนงาน';
        else if (!task.name) errors[key] = 'กรุณาระบุชื่องาน';
        else if (task.name.length > 200) errors[key] = 'ชื่องานยาวเกิน 200 ตัวอักษร';
        else if (!Number.isInteger(task.durationDays) || task.durationDays < 1 || task.durationDays > 120) errors[key] = 'ระยะเวลาต้องเป็น 1-120 วัน';
        else if (task.afterCode && byCode.get(task.afterCode)?.template.code.slice(0, 2) !== task.phaseCode) errors[key] = 'งานที่ทำต่อจาก ต้องอยู่ในขั้นตอนเดียวกัน';
        ids.add(task.id);
    }
    return { overrides: { excluded: excluded.filter((code) => !required.includes(code)), custom }, errors };
}

/** บันทึกการตั้งค่าและสร้างไทม์ไลน์ใหม่ (ผ่าน normalizeOptions/normalizeOverrides แล้ว) */
export function saveSetup(code: string, options: ApiSchemas['ConstructionSetupOptions'], overrides: TaskOverrides, by: string): ApiSchemas['ProjectSetup'] {
    const isNew = !setups.has(code);
    setups.set(code, { configuredAt: new Date().toISOString(), configuredBy: by, options, excludedTasks: overrides.excluded, customTasks: overrides.custom });
    timelines.delete(code);
    updates.delete(code);
    const timeline = getTimeline(code)!;
    const taskCount = timeline.phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
    const adjusted = [overrides.excluded.length ? `ตัดออก ${overrides.excluded.length} งาน` : '', overrides.custom.length ? `เพิ่มเอง ${overrides.custom.length} งาน` : ''].filter(Boolean).join(' ');
    recordAudit({ module: 'project', action: isNew ? 'ตั้งค่างานก่อสร้าง' : 'แก้ไขการตั้งค่างานก่อสร้าง', target: code, detail: `สร้างไทม์ไลน์ ${timeline.phases.length} ขั้นตอน ${taskCount} งาน${adjusted ? ` (${adjusted})` : ''}` });
    return getSetup(code);
}

/** ตัวอย่างงานทั้งหมดตามตัวเลือก — รวมงานที่ตัดออก (included = false) เพื่อให้เลือกกลับได้ โดยไม่บันทึก */
export function previewSetup(code: string, options: ApiSchemas['ConstructionSetupOptions'], overrides: TaskOverrides): ApiSchemas['SetupPreview'] {
    const project = { ...findContracted(code)!, progress: 0 };
    const planOptions = toPlanOptions(options);
    const planned = new Map(timelineGenerator.planTasks(planOptions, overrides).map((task) => [task.template.code, task]));
    // วันที่ของงานที่ตัดออกมาจากแผนที่ไม่ได้ตัดงาน (เพื่อแสดงตำแหน่งเดิม) ส่วนงานที่ใช้จริงมาจากแผนจริง
    const full = toApi(timelineGenerator.build(project, planOptions, { excluded: [], custom: overrides.custom }));
    const actual = toApi(timelineGenerator.build(project, planOptions, overrides));
    const actualTasks = new Map(actual.phases.flatMap((phase) => phase.tasks).map((task) => [task.code, task]));
    const used = [...actualTasks.values()];
    return {
        taskCount: used.filter((task) => !task.isMilestone).length,
        holdPointCount: used.filter((task) => task.isHoldPoint).length,
        milestoneCount: used.filter((task) => task.isMilestone).length,
        optionalTaskCount: used.filter((task) => !!planned.get(task.code)?.template.when).length,
        excludedCount: [...planned.values()].filter((task) => !task.included).length,
        customCount: overrides.custom.length,
        phases: full.phases.map((phase) => {
            const actualPhase = actual.phases.find((item) => item.code === phase.code);
            return {
                step: phase.step,
                code: phase.code,
                name: phase.name,
                shortName: phase.shortName,
                start: actualPhase?.start ?? phase.start,
                end: actualPhase?.end ?? phase.end,
                tasks: phase.tasks.map((task) => {
                    const meta = planned.get(task.code)!;
                    const dates = actualTasks.get(task.code) ?? task;
                    return {
                        code: task.code,
                        name: task.name,
                        team: task.team,
                        start: dates.start,
                        end: dates.end,
                        isHoldPoint: task.isHoldPoint,
                        isMilestone: task.isMilestone,
                        optional: !!meta.template.when,
                        included: actualTasks.has(task.code),
                        required: isRequiredTask(meta.template),
                        custom: !!meta.custom,
                        ...(meta.custom ? { customId: meta.custom.id } : {})
                    };
                })
            };
        })
    };
}
const updates = new Map<string, ProgressUpdate[]>();
export const uploads = new Map<string, ApiSchemas['UploadedFile']>();

/** ไทม์ไลน์ของโครงการ (สร้างจากแม่แบบแผนงานตามการตั้งค่างานก่อสร้าง แล้วเก็บสถานะไว้) — undefined จนกว่าจะบันทึกสัญญาและตั้งค่า */
export function getTimeline(code: string): Timeline | undefined {
    if (!timelines.has(code)) {
        const project = findContracted(code);
        const setup = setups.get(code);
        if (!project || !setup) return undefined;
        timelines.set(code, toApi(timelineGenerator.build(project, toPlanOptions(setup.options), overridesOf(setup))));
    }
    return timelines.get(code);
}

export function findTask(timeline: Timeline, taskCode: string) {
    for (const phase of timeline.phases) {
        const task = phase.tasks.find((item) => item.code === taskCode);
        if (task) return { phase, task };
    }
    return undefined;
}

const WEATHER: ApiSchemas['Weather'][] = ['sunny', 'cloudy', 'sunny', 'light-rain'];
const NOTES = ['ทีมทำงานตามแผน เก็บความสะอาดหน้างานเรียบร้อย', 'ช่วงบ่ายฝนตกเล็กน้อย หยุดงานภายนอกประมาณ 1 ชั่วโมง', 'ผู้ควบคุมงานเข้าตรวจหน้างานตามรอบ ไม่พบปัญหา'];

/** บันทึกหน้างานของโครงการ ล่าสุดก่อน (มีตัวอย่างย้อนหลังให้ทุกโครงการที่กำลังทำงาน) */
export function getUpdates(code: string): ProgressUpdate[] {
    if (!updates.has(code)) {
        const project = findProject(code);
        const timeline = getTimeline(code);
        const seeded: ProgressUpdate[] = [];
        if (project && timeline) {
            const author = { id: `user-pm-${code}`, name: project.responsibleName, roleLabel: 'ผู้จัดการโครงการ' };
            const active = timeline.phases.flatMap((phase) => phase.tasks.filter((task) => task.status === 'active' && !task.isMilestone && !task.isHoldPoint).map((task) => ({ phase, task }))).slice(0, 3);
            for (let k = 0; k < 3 && active.length; k++) {
                const taskChanges = active
                    .map(({ phase, task }) => ({ taskCode: task.code, taskName: task.name, phaseStep: phase.step, from: Math.max(0, task.progress - 15 * (k + 1)), to: Math.max(0, task.progress - 15 * k) }))
                    .filter((change) => change.to > change.from);
                const date = new Date(Date.now() - (k * 2 + 1) * DAY_MS);
                seeded.push({
                    id: `upd-${code}-seed-${k + 1}`,
                    projectCode: code,
                    reportDate: isoDate(date),
                    createdAt: new Date(date.getTime() + 10 * 3_600_000).toISOString(),
                    author,
                    weather: WEATHER[k],
                    workers: 9 + ((k * 3) % 5),
                    note: NOTES[k],
                    taskChanges,
                    issues: k === 0 ? [{ title: 'วัสดุงวดถัดไปยังไม่เข้าหน้างาน ฝ่ายจัดซื้อกำลังติดตาม', severity: 'medium' }] : [],
                    photos: [],
                    documents: [],
                    overallProgress: timeline.progress
                });
            }
        }
        updates.set(code, seeded);
    }
    return updates.get(code)!;
}
