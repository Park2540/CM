import { persistMap } from '../db/state.js';
import type { ApiSchemas } from '../api/api.js';
import { isContracted } from './shared.js';
import { recordAudit } from './audit-logs.js';
import { findPersonnel, listPersonnel } from './personnel.js';
import { PROJECT_SEED } from './project-seed.js';
import { currentProject, findProject, getTimeline } from './projects.js';
import { findSubcontractor } from './subcontractors.js';
import { CURRENT_USER } from './users.js';

type StaffRole = ApiSchemas['StaffRole'];
type StaffInput = ApiSchemas['StaffAssignmentInput'];
type SubInput = ApiSchemas['SubcontractorAssignmentInput'];

interface StoredStaff {
    id: string;
    personnelId: string;
    role: StaffRole;
    note?: string;
}

interface StoredSub {
    id: string;
    subcontractorId: string;
    scope: string;
    phaseCodes: string[];
    contractValue?: number;
    note?: string;
}

/** ชื่อบทบาทภาษาไทยสำหรับรายชื่อติดต่อ (/team) และ Audit Log */
const ROLE_LABEL: Record<StaffRole, string> = {
    'project-manager': 'ผู้จัดการโครงการ',
    engineer: 'วิศวกรโครงการ',
    'site-supervisor': 'ผู้ควบคุมงาน',
    architect: 'สถาปนิก',
    foreman: 'โฟร์แมน',
    'safety-officer': 'เจ้าหน้าที่ความปลอดภัย',
    purchasing: 'ฝ่ายจัดซื้อ',
    accounting: 'ฝ่ายบัญชีและการเงิน'
};
const ROLE_ORDER = Object.keys(ROLE_LABEL) as StaffRole[];

const staff = new Map<string, StoredStaff[]>();
const subs = new Map<string, StoredSub[]>();
let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++sequence}`;

const personnelByName = (name: string) => listPersonnel().find((record) => record.fullName === name);
const DAY_MS = 86_400_000;

/** ทีมตัวอย่างของโครงการที่มีอยู่เดิม: ผู้จัดการตาม responsibleName + วิศวกร ผู้ควบคุมงาน บัญชี และผู้รับเหมาช่วงตามขั้นตอน */
const SEED_SUBCONTRACTORS: Array<{ subcontractorId: string; scope: string; phaseCodes: string[]; share: number }> = [
    { subcontractorId: 'sub-001', scope: 'งานเสาเข็มเจาะตามแบบ รวมทดสอบ', phaseCodes: ['05'], share: 0.06 },
    { subcontractorId: 'sub-002', scope: 'งานฐานราก โครงสร้าง คสล. และงานก่อผนัง', phaseCodes: ['05', '06', '08'], share: 0.22 },
    { subcontractorId: 'sub-003', scope: 'งานโครงหลังคา มุงหลังคา และกันซึม', phaseCodes: ['07'], share: 0.08 },
    { subcontractorId: 'sub-004', scope: 'งานระบบไฟฟ้าและประปา เดินท่อ ติดตั้ง ทดสอบ', phaseCodes: ['09', '12'], share: 0.07 },
    { subcontractorId: 'sub-007', scope: 'งานกระเบื้อง ฝ้า และสี', phaseCodes: ['10', '11'], share: 0.09 },
    { subcontractorId: 'sub-009', scope: 'งานภูมิทัศน์และงานภายนอก', phaseCodes: ['13'], share: 0.03 }
];

/** โครงการตัวอย่างที่มีสัญญาตั้งแต่เริ่ม (คำนวณตอนโหลด ก่อนมีการบันทึกสัญญาใหม่) */
const SEEDED_TEAMS = new Set(PROJECT_SEED.filter(isContracted).map((project) => project.code));

function ensure(code: string) {
    if (staff.has(code)) return;
    const project = findProject(code);
    const rows: StoredStaff[] = [];
    const manager = project && personnelByName(project.responsibleName);
    if (manager) rows.push({ id: nextId('stf'), personnelId: manager.id, role: 'project-manager' });
    // โครงการที่เปิดใหม่มีเฉพาะผู้รับผิดชอบที่เลือกตอนเปิดโครงการ; โครงการตัวอย่างที่มีสัญญาอยู่เดิมมีทีมครบ
    if (SEEDED_TEAMS.has(code)) {
        for (const [personnelId, role] of [
            ['personnel-006', 'engineer'],
            ['personnel-007', 'site-supervisor'],
            ['personnel-008', 'accounting']
        ] as Array<[string, StaffRole]>)
            rows.push({ id: nextId('stf'), personnelId, role });
        subs.set(
            code,
            SEED_SUBCONTRACTORS.map(({ share, ...item }) => ({ id: nextId('asg'), ...item, contractValue: Math.round(((project?.value ?? 0) * share) / 1000) * 1000 }))
        );
    }
    staff.set(code, rows);
    if (!subs.has(code)) subs.set(code, []);
}

// ---------- read ----------
function presentStaff(row: StoredStaff): ApiSchemas['StaffAssignment'] {
    const person = findPersonnel(row.personnelId);
    return {
        id: row.id,
        personnelId: row.personnelId,
        name: person?.fullName ?? '(ไม่พบข้อมูลบุคลากร)',
        role: row.role,
        ...(person?.position ? { position: person.position } : {}),
        ...(person?.phone ? { phone: person.phone } : {}),
        ...(row.note ? { note: row.note } : {})
    };
}

const isoDate = (value: string) => value.slice(0, 10);

/** ความคืบหน้าของขั้นตอนที่มอบหมาย ถ่วงตามระยะเวลาของขั้นตอน */
function presentSub(code: string, row: StoredSub, includeValue: boolean): ApiSchemas['SubcontractorAssignment'] {
    const sub = findSubcontractor(row.subcontractorId)!;
    const phases = (getTimeline(code)?.phases ?? []).filter((phase) => row.phaseCodes.includes(phase.code));
    const days = (phase: (typeof phases)[number]) => (Date.parse(phase.end) - Date.parse(phase.start)) / DAY_MS + 1;
    const totalDays = phases.reduce((sum, phase) => sum + days(phase), 0);
    const progress = totalDays ? Math.round(phases.reduce((sum, phase) => sum + days(phase) * phase.progress, 0) / totalDays) : 0;
    return {
        id: row.id,
        subcontractor: { id: sub.id, code: sub.code, name: sub.name, contactName: sub.contactName, phone: sub.phone, trades: sub.trades },
        scope: row.scope,
        phaseCodes: phases.map((phase) => phase.code),
        ...(includeValue && row.contractValue !== undefined ? { contractValue: row.contractValue } : {}),
        ...(row.note ? { note: row.note } : {}),
        start: phases.length ? isoDate(phases.map((phase) => phase.start).sort()[0]) : '',
        end: phases.length
            ? isoDate(
                  phases
                      .map((phase) => phase.end)
                      .sort()
                      .at(-1)!
              )
            : '',
        progress,
        status: progress >= 100 ? 'done' : progress > 0 ? 'working' : 'upcoming'
    };
}

const canManage = () => CURRENT_USER.permissions.includes('project.manage');

export function projectAssignments(code: string): ApiSchemas['ProjectAssignments'] {
    ensure(code);
    return {
        staff: [...staff.get(code)!].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)).map(presentStaff),
        subcontractors: subs.get(code)!.map((row) => presentSub(code, row, canManage()))
    };
}

/** รายชื่อติดต่อทีมงาน (การ์ด "ติดต่อทีมงาน") สร้างจากผู้รับผิดชอบที่มอบหมาย */
export function projectTeam(code: string): ApiSchemas['TeamMember'][] {
    return projectAssignments(code).staff.map((member) => ({ name: member.name, role: ROLE_LABEL[member.role], phone: member.phone ?? '-' }));
}

/** จำนวนโครงการที่ยังไม่ส่งมอบที่ผู้รับเหมารายนี้ถูกมอบหมายอยู่ */
export function activeProjectCount(subcontractorId: string): number {
    return PROJECT_SEED.filter((project) => {
        ensure(project.code);
        return currentProject(project.code)?.status !== 'completed' && subs.get(project.code)!.some((row) => row.subcontractorId === subcontractorId);
    }).length;
}

/** ประวัติการมอบหมายของบุคลากร (ใช้เติม projectHistory ในหน้าบุคลากร) */
export function staffHistory(personnelId: string): ApiSchemas['Personnel']['projectHistory'] {
    return PROJECT_SEED.flatMap((project) => {
        ensure(project.code);
        const current = currentProject(project.code)!;
        return staff
            .get(project.code)!
            .filter((row) => row.personnelId === personnelId)
            .map((row) => ({
                projectCode: project.code,
                role: ROLE_LABEL[row.role],
                period: current.startDate ? `${current.startDate} – ${current.handedOverAt ?? current.deliveryDate ?? ''}` : 'รอเริ่มโครงการ',
                assignment: row.note ?? ROLE_LABEL[row.role],
                dailyReport: current.status === 'completed' ? 'ส่งมอบแล้ว' : `ความคืบหน้า ${current.progress}%`
            }));
    });
}

// ---------- write: staff ----------
export type Outcome<T> = { ok: T } | { status: 404 | 409 | 422; title: string; detail?: string; errors?: Record<string, string> };

const ROLES = ROLE_ORDER;

function validateStaff(input: StaffInput): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!input.personnelId || !findPersonnel(input.personnelId)) errors['personnelId'] = 'กรุณาเลือกบุคลากร';
    if (!ROLES.includes(input.role)) errors['role'] = 'กรุณาเลือกบทบาท';
    return errors;
}

/** ผู้จัดการโครงการคนแรกคือ responsibleName ของโครงการ */
function syncResponsible(code: string) {
    const first = staff.get(code)!.find((row) => row.role === 'project-manager');
    const name = first && findPersonnel(first.personnelId)?.fullName;
    const project = findProject(code);
    if (project && name) project.responsibleName = name;
}

export function addStaff(code: string, input: StaffInput): Outcome<ApiSchemas['StaffAssignment']> {
    ensure(code);
    const errors = validateStaff(input);
    if (Object.keys(errors).length) return { status: 422, title: 'ข้อมูลไม่ถูกต้อง', detail: Object.values(errors)[0], errors };
    const rows = staff.get(code)!;
    if (rows.some((row) => row.personnelId === input.personnelId && row.role === input.role)) return { status: 409, title: 'มอบหมายซ้ำ', detail: 'บุคลากรนี้มีบทบาทนี้ในโครงการแล้ว' };
    const row: StoredStaff = { id: nextId('stf'), personnelId: input.personnelId, role: input.role, ...(input.note?.trim() ? { note: input.note.trim() } : {}) };
    rows.push(row);
    syncResponsible(code);
    recordAudit({ module: 'project', action: 'มอบหมายผู้รับผิดชอบ', target: code, detail: `${findPersonnel(row.personnelId)!.fullName} · ${ROLE_LABEL[row.role]}` });
    return { ok: presentStaff(row) };
}

const isLastManager = (rows: StoredStaff[], row: StoredStaff) => row.role === 'project-manager' && rows.filter((item) => item.role === 'project-manager').length === 1;

export function updateStaff(code: string, id: string, input: StaffInput): Outcome<ApiSchemas['StaffAssignment']> {
    ensure(code);
    const rows = staff.get(code)!;
    const row = rows.find((item) => item.id === id);
    if (!row) return { status: 404, title: 'ไม่พบการมอบหมายนี้' };
    const errors = validateStaff(input);
    if (Object.keys(errors).length) return { status: 422, title: 'ข้อมูลไม่ถูกต้อง', detail: Object.values(errors)[0], errors };
    if (input.role !== 'project-manager' && isLastManager(rows, row)) return { status: 409, title: 'เปลี่ยนบทบาทไม่ได้', detail: 'โครงการต้องมีผู้จัดการโครงการอย่างน้อย 1 คน' };
    if (rows.some((item) => item.id !== id && item.personnelId === input.personnelId && item.role === input.role)) return { status: 409, title: 'มอบหมายซ้ำ', detail: 'บุคลากรนี้มีบทบาทนี้ในโครงการแล้ว' };
    Object.assign(row, { personnelId: input.personnelId, role: input.role, note: input.note?.trim() || undefined });
    syncResponsible(code);
    recordAudit({ module: 'project', action: 'แก้ไขผู้รับผิดชอบ', target: code, detail: `${findPersonnel(row.personnelId)!.fullName} · ${ROLE_LABEL[row.role]}` });
    return { ok: presentStaff(row) };
}

export function removeStaff(code: string, id: string): Outcome<true> {
    ensure(code);
    const rows = staff.get(code)!;
    const row = rows.find((item) => item.id === id);
    if (!row) return { status: 404, title: 'ไม่พบการมอบหมายนี้' };
    if (isLastManager(rows, row)) return { status: 409, title: 'นำออกไม่ได้', detail: 'โครงการต้องมีผู้จัดการโครงการอย่างน้อย 1 คน ให้เพิ่มผู้จัดการคนใหม่ก่อน' };
    rows.splice(rows.indexOf(row), 1);
    syncResponsible(code);
    recordAudit({ module: 'project', action: 'นำผู้รับผิดชอบออก', target: code, detail: `${findPersonnel(row.personnelId)?.fullName ?? row.personnelId} · ${ROLE_LABEL[row.role]}` });
    return { ok: true };
}

// ---------- write: subcontractors ----------
/** ข้อผิดพลาดของการมอบหมายผู้รับเหมา (null = ผ่าน) */
function validateSub(code: string, input: SubInput, selfId?: string): Exclude<Outcome<never>, { ok: never }> | null {
    const errors: Record<string, string> = {};
    const sub = input.subcontractorId ? findSubcontractor(input.subcontractorId) : undefined;
    const phaseCodes = new Set((getTimeline(code)?.phases ?? []).map((phase) => phase.code));
    if (!sub) errors['subcontractorId'] = 'กรุณาเลือกผู้รับเหมา';
    else if (sub.status !== 'active' && !selfId) errors['subcontractorId'] = 'ผู้รับเหมารายนี้ปิดใช้งานอยู่';
    if (!input.scope?.trim()) errors['scope'] = 'กรุณาระบุขอบเขตงาน';
    if (!input.phaseCodes?.length) errors['phaseCodes'] = 'กรุณาเลือกขั้นตอนที่รับผิดชอบอย่างน้อย 1 ขั้นตอน';
    else if (input.phaseCodes.some((phase) => !phaseCodes.has(phase))) errors['phaseCodes'] = 'มีขั้นตอนที่ไม่อยู่ในไทม์ไลน์ของโครงการ';
    if (input.contractValue !== undefined && input.contractValue !== null && !(input.contractValue >= 0)) errors['contractValue'] = 'มูลค่าจ้างต้องไม่ติดลบ';
    if (Object.keys(errors).length) return { status: 422, title: 'ข้อมูลไม่ถูกต้อง', detail: Object.values(errors)[0], errors };
    if (subs.get(code)!.some((row) => row.id !== selfId && row.subcontractorId === input.subcontractorId)) return { status: 409, title: 'มอบหมายซ้ำ', detail: `${sub!.name} อยู่ในโครงการนี้แล้ว ให้แก้ไขรายการเดิม` };
    return null;
}

function toStored(input: SubInput, id: string): StoredSub {
    return {
        id,
        subcontractorId: input.subcontractorId,
        scope: input.scope.trim(),
        phaseCodes: [...new Set(input.phaseCodes)].sort(),
        ...(input.contractValue !== undefined && input.contractValue !== null ? { contractValue: input.contractValue } : {}),
        ...(input.note?.trim() ? { note: input.note.trim() } : {})
    };
}

export function addSubAssignment(code: string, input: SubInput): Outcome<ApiSchemas['SubcontractorAssignment']> {
    ensure(code);
    const invalid = validateSub(code, input);
    if (invalid) return invalid;
    const row = toStored(input, nextId('asg'));
    subs.get(code)!.push(row);
    recordAudit({ module: 'project', action: 'มอบหมายผู้รับเหมาช่วง', target: code, detail: `${findSubcontractor(row.subcontractorId)!.name} · ขั้นตอน ${row.phaseCodes.join(', ')}` });
    return { ok: presentSub(code, row, canManage()) };
}

export function updateSubAssignment(code: string, id: string, input: SubInput): Outcome<ApiSchemas['SubcontractorAssignment']> {
    ensure(code);
    const rows = subs.get(code)!;
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) return { status: 404, title: 'ไม่พบการมอบหมายนี้' };
    const invalid = validateSub(code, input, id);
    if (invalid) return invalid;
    rows[index] = toStored(input, id);
    recordAudit({ module: 'project', action: 'แก้ไขการมอบหมายผู้รับเหมาช่วง', target: code, detail: `${findSubcontractor(rows[index].subcontractorId)!.name} · ขั้นตอน ${rows[index].phaseCodes.join(', ')}` });
    return { ok: presentSub(code, rows[index], canManage()) };
}

export function removeSubAssignment(code: string, id: string): Outcome<true> {
    ensure(code);
    const rows = subs.get(code)!;
    const row = rows.find((item) => item.id === id);
    if (!row) return { status: 404, title: 'ไม่พบการมอบหมายนี้' };
    if (presentSub(code, row, false).progress > 0) return { status: 409, title: 'ยกเลิกไม่ได้', detail: 'ขั้นตอนที่รับผิดชอบเริ่มงานแล้ว ให้แก้ไขขอบเขตหรือขั้นตอนแทน' };
    rows.splice(rows.indexOf(row), 1);
    recordAudit({ module: 'project', action: 'ยกเลิกการมอบหมายผู้รับเหมาช่วง', target: code, detail: findSubcontractor(row.subcontractorId)?.name ?? row.subcontractorId });
    return { ok: true };
}

persistMap('project_staff', staff);
persistMap('project_subcontractors', subs);
