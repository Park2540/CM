import type { ApiSchemas } from '../api/api.js';
import { ContractedProject, ProjectTimeline, timelineFromApi } from './shared.js';
import { isContracted } from './shared.js';
import { RecordsGenerator } from './records-generator.js';
import { PaymentRecord, activePayments, hasLedger, initLedger, installmentKey, toApiPayment } from './payments.js';
import { changeOrderInstallments } from './change-orders.js';
import { currentProject, getTimeline, getUpdates, paymentPercentsOf } from './projects.js';

const generator = new RecordsGenerator();
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const CATEGORY_CODE: Record<string, ApiSchemas['DocumentCategory']> = {
    สัญญาและงวดงาน: 'contract',
    แบบก่อสร้าง: 'drawing',
    ใบอนุญาต: 'permit',
    รายงานตรวจคุณภาพ: 'inspection',
    'ใบแจ้งหนี้/ใบเสร็จ': 'billing',
    เอกสารส่งมอบ: 'handover'
};

/** งวดงาน ภาพ เอกสาร ทีมงาน สร้างจากโครงการและไทม์ไลน์ปัจจุบัน (เปลี่ยนตามการอัปเดตงาน) — สถานะชำระแล้วมาจากการบันทึกรับชำระ */
export function generatedRecords(code: string) {
    const project = currentProject(code);
    const apiTimeline = getTimeline(code);
    if (!isContracted(project) || !apiTimeline) return undefined;
    const timeline = timelineFromApi(apiTimeline);
    ensureLedger(code, project, timeline);
    const paid = new Map<number, Date>();
    for (const record of activePayments(code).values()) if (record.key.startsWith('no:')) paid.set(record.installmentNo, new Date(`${record.paidDate}T00:00:00Z`));
    return generator.build(project, timeline, paymentPercentsOf(code), paid);
}

/**
 * ข้อมูลเดิมก่อนมีการบันทึกรับชำระ: สร้างรายการรับชำระจากกติกาเดิมครั้งเดียว ให้สถานะงวดไม่เปลี่ยน
 * (โครงการใหม่จะได้สมุดว่าง เพราะยังไม่มีงานเสร็จ)
 */
function ensureLedger(code: string, project: ContractedProject, timeline: ProjectTimeline) {
    if (hasLedger(code)) return;
    const legacy = generator.legacyPaid(project, timeline);
    const rows = generator.installments(project, timeline, paymentPercentsOf(code), new Map());
    initLedger(
        code,
        rows
            .filter((row) => legacy.has(row.no))
            .map((row): PaymentRecord => {
                const paidDate = isoDate(legacy.get(row.no)!);
                return {
                    id: `pay-${code}-${row.no}`,
                    key: installmentKey(row),
                    installmentNo: row.no,
                    paidDate,
                    amount: row.amount,
                    withholdingTax: 0,
                    method: 'transfer',
                    note: 'ข้อมูลตัวอย่างที่ระบบสร้าง',
                    evidence: [],
                    recordedBy: { id: 'system', name: 'ระบบ', roleLabel: 'ระบบ' },
                    recordedAt: `${paidDate}T10:00:00+07:00`
                };
            })
    );
}

/** งวดตามสัญญา + งวดงานเพิ่ม-ลด พร้อมการรับชำระของแต่ละงวด */
export function apiInstallments(code: string): ApiSchemas['Installment'][] | undefined {
    const contract = generatedRecords(code)?.installments.map((item): ApiSchemas['Installment'] => ({ ...item, dueDate: isoDate(item.dueDate), paidDate: item.paidDate ? isoDate(item.paidDate) : null }));
    if (!contract) return undefined;
    const payments = activePayments(code);
    return [...contract, ...changeOrderInstallments(code, contract.length + 1, currentProject(code)?.value ?? 0)].map((item) => {
        const payment = payments.get(installmentKey(item));
        return payment ? { ...item, status: 'paid', paidDate: payment.paidDate, payment: toApiPayment(payment) } : item;
    });
}

/** ไฟล์ที่อัปโหลด → ชนิดไฟล์ของเอกสารโครงการ */
function fileTypeOf(file: ApiSchemas['UploadedFile']): ApiSchemas['ProjectDocument']['fileType'] {
    if (file.contentType.startsWith('image/')) return 'image';
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    return ({ xlsx: 'xlsx', xls: 'xlsx', docx: 'docx', doc: 'docx', dwg: 'dwg' } as const)[extension as 'xlsx'] ?? 'pdf';
}

/** หลักฐานการรับชำระ (หมวดใบแจ้งหนี้/ใบเสร็จ) */
function paymentDocuments(code: string): ApiSchemas['ProjectDocument'][] {
    return [...activePayments(code).values()].flatMap((payment) =>
        payment.evidence.map((file, index) => ({
            id: `${payment.id}-evidence-${index + 1}`,
            category: 'billing' as const,
            name: `หลักฐานรับชำระ งวดที่ ${payment.installmentNo} · ${file.name}`,
            date: payment.paidDate,
            fileType: fileTypeOf(file),
            sizeKb: file.sizeKb,
            downloadUrl: file.url,
            uploadedBy: payment.recordedBy.name
        }))
    );
}

/** เอกสารที่ระบบสร้างตามความคืบหน้า + เอกสารที่แนบมากับบันทึกหน้างาน + หลักฐานรับชำระ ล่าสุดก่อน */
export function apiDocuments(code: string): ApiSchemas['ProjectDocument'][] | undefined {
    const records = generatedRecords(code);
    // งวดที่มีหลักฐานจริงแล้ว ไม่ต้องแสดงใบเสร็จตัวอย่างที่ระบบสร้าง
    const withEvidence = new Set([...activePayments(code).values()].filter((payment) => payment.evidence.length).map((payment) => `ใบเสร็จรับเงิน งวดที่ ${payment.installmentNo}.pdf`));
    const generated = records?.documents.filter((doc) => !withEvidence.has(doc.name)).map((doc): ApiSchemas['ProjectDocument'] => ({
        id: doc.id,
        category: CATEGORY_CODE[doc.category],
        name: doc.name,
        date: isoDate(doc.date),
        fileType: doc.fileType,
        sizeKb: doc.sizeKb,
        downloadUrl: samplePdfUrl()
    }));
    if (!generated) return undefined;
    const attached = getUpdates(code).flatMap((update) => update.documents);
    return [...attached, ...paymentDocuments(code), ...generated].sort((a, b) => b.date.localeCompare(a.date));
}

/** ภาพตัวอย่างจากแผน + ภาพจริงที่แนบมากับบันทึกหน้างาน ล่าสุดก่อน */
export function apiPhotos(code: string): ApiSchemas['SitePhoto'][] | undefined {
    const records = generatedRecords(code);
    const timeline = getTimeline(code);
    if (!records || !timeline) return undefined;

    const generated = records.photos.map((photo): ApiSchemas['SitePhoto'] => {
        const url = placeholderImage(photo.caption, photo.phaseShortName, photo.phaseStep, isoDate(photo.date));
        return { id: photo.id, url, thumbnailUrl: url, takenAt: photo.date.toISOString(), caption: photo.caption, phaseCode: photo.phaseCode, phaseStep: photo.phaseStep, phaseShortName: photo.phaseShortName };
    });
    const uploaded = getUpdates(code).flatMap((update) => {
        const phase = timeline.phases.find((item) => item.step === update.taskChanges[0]?.phaseStep);
        return update.photos.map((photo): ApiSchemas['SitePhoto'] => ({
            id: photo.id,
            url: photo.url,
            thumbnailUrl: photo.url,
            takenAt: update.createdAt,
            caption: update.note?.slice(0, 80) || (update.inspection ? `ผลตรวจ ${update.inspection.taskName}` : `บันทึกหน้างาน ${update.reportDate}`),
            phaseCode: phase?.code ?? '00',
            phaseStep: phase?.step ?? 0,
            phaseShortName: phase?.shortName ?? 'ทั่วไป'
        }));
    });
    return [...uploaded, ...generated].sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt));
}

// ---------- ไฟล์ตัวอย่าง ----------

const PHASE_HUES = [210, 25, 160, 45, 330, 120, 260, 0, 190, 80, 300, 15, 140, 230];

/** ภาพแทนรูปถ่ายจริง (SVG) แสดงชื่อขั้นตอนและวันที่ */
function placeholderImage(caption: string, phaseName: string, step: number, date: string): string {
    const hue = PHASE_HUES[(step - 1 + PHASE_HUES.length) % PHASE_HUES.length];
    const escape = (text: string) => text.replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char]!);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<defs><pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="40" height="40" fill="hsl(${hue} 30% 88%)"/><rect width="20" height="40" fill="hsl(${hue} 30% 82%)"/></pattern></defs>
<rect width="800" height="600" fill="url(#p)"/>
<circle cx="400" cy="250" r="56" fill="hsl(${hue} 35% 45%)" opacity="0.85"/>
<rect x="372" y="232" width="56" height="38" rx="6" fill="#fff"/><circle cx="400" cy="251" r="11" fill="hsl(${hue} 35% 45%)"/>
<text x="400" y="370" text-anchor="middle" font-family="sans-serif" font-size="30" font-weight="700" fill="hsl(${hue} 40% 25%)">ขั้นตอนที่ ${step} · ${escape(phaseName)}</text>
<text x="400" y="412" text-anchor="middle" font-family="sans-serif" font-size="22" fill="hsl(${hue} 30% 30%)">${escape(caption.slice(0, 48))}</text>
<text x="400" y="560" text-anchor="middle" font-family="sans-serif" font-size="20" fill="hsl(${hue} 30% 35%)">ภาพตัวอย่างที่ระบบสร้าง · ${date}</text>
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** ลิงก์เอกสารตัวอย่างที่ระบบสร้างเอง (ยังไม่มีไฟล์จริง) */
const samplePdfUrl = () => '/api/files/sample.pdf';

/** PDF หน้าเดียวสำหรับเอกสารตัวอย่าง (GET /api/files/sample.pdf) */
export function samplePdf(): Buffer {
    const content = 'BT /F1 20 Tf 72 760 Td (PP Prime Construction) Tj 0 -32 Td /F1 12 Tf (Sample document generated by the backend.) Tj 0 -18 Td (Upload real files from the project page.) Tj ET';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = objects.map((body, index) => {
        const offset = pdf.length;
        pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
        return offset;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, 'latin1');
}
