/** สร้างงวดงาน ภาพ เอกสารตัวอย่างจากไทม์ไลน์ (ใช้เฉพาะใน API จำลอง) — ทีมงานอยู่ที่ data/project-team.ts */
import { ContractedProject } from '@/app/pages/service/project.service';
import { ProjectTimeline, TimelinePhase, TimelineTask, todayAsDate } from '@/app/pages/service/project-timeline.service';

export type InstallmentStatus = 'paid' | 'due' | 'working' | 'upcoming';

export interface Installment {
    no: number;
    title: string;
    phaseSteps: number[];
    percent: number;
    amount: number;
    status: InstallmentStatus;
    dueDate: Date;
    paidDate: Date | null;
}

export interface SitePhoto {
    id: string;
    date: Date;
    caption: string;
    phaseCode: string;
    phaseStep: number;
    phaseShortName: string;
}

export type DocumentCategory = 'สัญญาและงวดงาน' | 'แบบก่อสร้าง' | 'ใบอนุญาต' | 'รายงานตรวจคุณภาพ' | 'ใบแจ้งหนี้/ใบเสร็จ' | 'เอกสารส่งมอบ';
export type DocumentFileType = 'pdf' | 'dwg' | 'xlsx';

export interface ProjectDocument {
    id: string;
    category: DocumentCategory;
    name: string;
    date: Date;
    fileType: DocumentFileType;
    sizeKb: number;
}

export interface ProjectRecords {
    installments: Installment[];
    photos: SitePhoto[];
    documents: ProjectDocument[];
}

export const DOCUMENT_CATEGORIES: DocumentCategory[] = ['สัญญาและงวดงาน', 'แบบก่อสร้าง', 'ใบอนุญาต', 'รายงานตรวจคุณภาพ', 'ใบแจ้งหนี้/ใบเสร็จ', 'เอกสารส่งมอบ'];

/** งวดงานตัวอย่าง: แต่ละงวดเบิกได้เมื่อขั้นตอนที่ผูกไว้เสร็จทั้งหมด (รหัสขั้นตอนตามแม่แบบแผนงาน) */
const PAYMENT_SCHEDULE: Array<{ title: string; phaseCodes: string[]; percent: number }> = [
    { title: 'ลงนามสัญญาและได้รับใบอนุญาตก่อสร้าง', phaseCodes: ['01', '02', '03'], percent: 10 },
    { title: 'งานเตรียมพื้นที่และงานชั่วคราว', phaseCodes: ['04'], percent: 10 },
    { title: 'งานฐานรากและพื้นชั้นล่าง', phaseCodes: ['05'], percent: 15 },
    { title: 'งานโครงสร้างคอนกรีตทุกชั้น', phaseCodes: ['06'], percent: 15 },
    { title: 'งานหลังคา (Dry-in)', phaseCodes: ['07'], percent: 10 },
    { title: 'งานก่ออิฐ วงกบ และงานระบบก่อนฉาบ', phaseCodes: ['08', '09'], percent: 10 },
    { title: 'งานฉาบปูนและกันซึม', phaseCodes: ['10'], percent: 10 },
    { title: 'งานตกแต่งสถาปัตยกรรม', phaseCodes: ['11'], percent: 10 },
    { title: 'งานติดตั้งระบบและงานภายนอก', phaseCodes: ['12', '13'], percent: 5 },
    { title: 'ตรวจรับและส่งมอบงาน', phaseCodes: ['14'], percent: 5 }
];

const DAY_MS = 86_400_000;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
const minDate = (a: Date, b: Date) => (a < b ? a : b);

function hash(text: string): number {
    let value = 0;
    for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0;
    return value;
}

/**
 * ข้อมูลตัวอย่างสำหรับหน้าโครงการ (ทีมงาน งวดงาน ภาพถ่าย เอกสาร) — ใช้แสดงหน้าจอระหว่างที่ยังไม่มี API
 * สร้างจากไทม์ไลน์ของโครงการ เพื่อให้สถานะงวดเงิน ภาพ และเอกสาร สอดคล้องกับความคืบหน้า
 * เมื่อเชื่อมต่อหลังบ้านแล้ว ให้แทนที่ด้วยการเรียก API โดยคง interface เดิมไว้
 */
export class RecordsGenerator {
    build(project: ContractedProject, timeline: ProjectTimeline): ProjectRecords {
        const installments = this.buildInstallments(project, timeline);
        return {
            installments,
            photos: this.buildPhotos(project, timeline),
            documents: this.buildDocuments(project, timeline, installments)
        };
    }

    private buildInstallments(project: ContractedProject, timeline: ProjectTimeline): Installment[] {
        const today = todayAsDate();
        const rows = PAYMENT_SCHEDULE.map((item, index) => {
            const phases = timeline.phases.filter((phase) => item.phaseCodes.includes(phase.code));
            const completedAt = new Date(Math.max(...phases.map((phase) => phase.end.getTime())));
            return {
                item,
                index,
                phases,
                completedAt,
                done: phases.every((phase) => phase.status === 'done'),
                started: phases.some((phase) => phase.status !== 'pending')
            };
        });
        const lastDoneIndex = Math.max(-1, ...rows.filter((row) => row.done).map((row) => row.index));

        return rows.map(({ item, index, phases, completedAt, done, started }): Installment => {
            // งวดล่าสุดที่งานเสร็จถือว่ารอชำระ งวดก่อนหน้าชำระแล้ว (โครงการที่เสร็จ 100% ถือว่าชำระครบ)
            const status: InstallmentStatus = done ? (index < lastDoneIndex || project.progress >= 100 ? 'paid' : 'due') : started ? 'working' : 'upcoming';
            return {
                no: index + 1,
                title: item.title,
                phaseSteps: phases.map((phase) => phase.step),
                percent: item.percent,
                amount: Math.round((project.value * item.percent) / 100),
                status,
                dueDate: addDays(completedAt, 7),
                paidDate: status === 'paid' ? minDate(addDays(completedAt, 5), today) : null
            };
        });
    }

    private buildPhotos(project: ContractedProject, timeline: ProjectTimeline): SitePhoto[] {
        const today = todayAsDate();
        const photos = timeline.phases.flatMap((phase) =>
            phase.tasks
                .filter((task) => !task.isMilestone && task.status !== 'pending')
                .flatMap((task) => {
                    const count = 1 + (hash(project.code + task.code) % 2);
                    return Array.from({ length: count }, (_, i): SitePhoto => {
                        const base = task.status === 'done' ? addDays(task.end, -i) : addDays(task.start, i);
                        return {
                            id: `${task.code}-${i + 1}`,
                            date: minDate(base, today),
                            caption: count > 1 ? `${task.name} (${i + 1}/${count})` : task.name,
                            phaseCode: phase.code,
                            phaseStep: phase.step,
                            phaseShortName: phase.shortName
                        };
                    });
                })
        );
        return photos.sort((a, b) => b.date.getTime() - a.date.getTime() || b.id.localeCompare(a.id));
    }

    private buildDocuments(project: ContractedProject, timeline: ProjectTimeline, installments: Installment[]): ProjectDocument[] {
        const documents: ProjectDocument[] = [];
        const tasks = new Map<string, TimelineTask>(timeline.phases.flatMap((phase) => phase.tasks.map((task) => [task.code, task] as const)));
        const phase = (code: string) => timeline.phases.find((item) => item.code === code) as TimelinePhase;
        const add = (category: DocumentCategory, name: string, date: Date, fileType: DocumentFileType = 'pdf') => documents.push({ id: `doc-${documents.length + 1}`, category, name, date, fileType, sizeKb: 180 + (hash(project.code + name) % 4800) });

        const contract = tasks.get('03.07');
        if (contract?.status === 'done') {
            add('สัญญาและงวดงาน', `สัญญาจ้างก่อสร้าง ${project.code}.pdf`, contract.end);
            add('สัญญาและงวดงาน', 'ตารางงวดงานและเงื่อนไขการชำระเงิน.pdf', contract.end);
        }

        const design = phase('02');
        if (design.status === 'done') {
            add('แบบก่อสร้าง', 'แบบสถาปัตยกรรม (แปลน รูปด้าน รูปตัด).pdf', design.end);
            add('แบบก่อสร้าง', 'แบบโครงสร้างและรายการคำนวณ.pdf', design.end);
            add('แบบก่อสร้าง', 'แบบระบบไฟฟ้าและสุขาภิบาล.dwg', design.end, 'dwg');
            add('แบบก่อสร้าง', 'รายการประกอบแบบ (Specification).pdf', design.end);
            add('แบบก่อสร้าง', 'BOQ และประมาณราคา.xlsx', design.end, 'xlsx');
        }

        const permit = tasks.get('03.05');
        if (permit?.status === 'done') add('ใบอนุญาต', 'ใบอนุญาตก่อสร้างอาคาร (อ.1).pdf', permit.end);

        for (const task of tasks.values()) {
            if (task.isHoldPoint && task.status === 'done') add('รายงานตรวจคุณภาพ', `รายงานผลตรวจ - ${task.name}.pdf`, task.end);
        }

        for (const installment of installments) {
            if (installment.status === 'paid') add('ใบแจ้งหนี้/ใบเสร็จ', `ใบเสร็จรับเงิน งวดที่ ${installment.no}.pdf`, installment.paidDate ?? installment.dueDate);
            if (installment.status === 'due') add('ใบแจ้งหนี้/ใบเสร็จ', `ใบแจ้งหนี้ งวดที่ ${installment.no}.pdf`, addDays(installment.dueDate, -7));
        }

        const handover = phase('14');
        if (handover.status === 'done') {
            add('เอกสารส่งมอบ', 'แบบก่อสร้างจริง (As-built).pdf', handover.end);
            add('เอกสารส่งมอบ', 'คู่มือการใช้งานและบำรุงรักษาอาคาร.pdf', handover.end);
            add('เอกสารส่งมอบ', 'หนังสือรับประกันผลงาน.pdf', handover.end);
        }

        return documents.sort((a, b) => b.date.getTime() - a.date.getTime());
    }
}
