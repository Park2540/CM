/**
 * ส่งออก BOQ เป็นไฟล์ Excel (.xlsx) รูปแบบเดียวกับหน้าพิมพ์ / ไฟล์ BOQ ต้นฉบับ
 * - sheet "สรุปราคา": ราคารวมแต่ละหมวด (สูตรอ้างอิง sheet หมวด) + ค่าดำเนินการ + รวมทั้งสิ้น + ราคาเฉลี่ย/ตร.ม.
 * - sheet ละหมวดงาน: ลำดับ รายการ หน่วย ปริมาณ ราคาวัสดุ ค่าแรง รวม — ช่องราคารวมเป็นสูตร แก้ปริมาณ/ราคาใน Excel แล้วคำนวณใหม่ได้
 * - sheet "ถอดปริมาณ": บรรทัดคำนวณปริมาณของแต่ละรายการ (ถ้ามี)
 * - sheet "รายการวัสดุ": วัสดุที่คำนวณจากโมเดล IFC (เฉพาะ BOQ ที่ถอดจากโมเดล)
 * - sheet "คำชี้แจงค่าดำเนินการ": เอกสารชี้แจงรายละเอียดค่าดำเนินการ (แนบท้าย BOQ) พร้อมช่องลงนาม
 * ทุกช่องคำนวณปัดทศนิยม 2 ตำแหน่งต่อรายการเหมือนหลังบ้าน ยอดใน Excel จึงตรงกับในระบบ
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import type { ApiSchemas } from '../api/api.js';

type Estimate = ApiSchemas['Estimate'];
type Company = ApiSchemas['CompanyProfile'];

/** โลโก้บริษัท (PNG แปลงจาก public/pp-prime-logo.svg — Excel ฝัง SVG ไม่ได้) */
const LOGO_PATH = fileURLToPath(new URL('../../assets/company-logo.png', import.meta.url));
const LOGO = existsSync(LOGO_PATH) ? readFileSync(LOGO_PATH) : null;
/** จำนวนแถวหัวกระดาษบริษัทบนสุดของทุก sheet */
const LETTERHEAD_ROWS = 3;

/** หัวกระดาษ: โลโก้ (ลอยอยู่มุมซ้ายบน) + ชื่อบริษัท ที่อยู่ เลขผู้เสียภาษี โทร อีเมล ในคอลัมน์ B */
function writeLetterhead(sheet: ExcelJS.Worksheet, company: Company | undefined, logo: number | null) {
    const lines: Array<[string, Partial<ExcelJS.Font>]> = [
        [company?.name ?? '', { size: 14, bold: true }],
        [company?.address ?? '', {}],
        [
            [company?.taxId ? `เลขประจำตัวผู้เสียภาษี ${company.taxId}${company.branch ? ` (${company.branch})` : ''}` : '', company?.phone ? `โทร ${company.phone}` : '', company?.email ? `อีเมล ${company.email}` : '']
                .filter(Boolean)
                .join('  ·  '),
            {}
        ]
    ];
    lines.forEach(([text, font], index) => {
        const row = sheet.getRow(index + 1);
        row.height = index === 0 ? 22 : 17;
        const cell = row.getCell(2);
        cell.value = text;
        cell.font = { name: FONT, size: 10, color: { argb: 'FF333333' }, ...font };
        // เว้นที่ให้โลโก้ที่ล้นจากคอลัมน์ A
        cell.alignment = { vertical: 'middle', indent: logo === null ? 0 : 3 };
    });
    if (logo !== null) sheet.addImage(logo, { tl: { col: 0.1, row: 0.2 }, ext: { width: 80, height: 56 }, editAs: 'oneCell' });
}
type Line = ApiSchemas['TakeoffLine'];

const FONT = 'Tahoma';
const MONEY = '#,##0.00;-#,##0.00;"-"';
const QTY = '#,##0.00;-#,##0.00;"-"';
const BORDER: Partial<ExcelJS.Borders> = {
    left: { style: 'thin', color: { argb: 'FF555555' } },
    right: { style: 'thin', color: { argb: 'FF555555' } },
    top: { style: 'hair', color: { argb: 'FF9CA3AF' } },
    bottom: { style: 'hair', color: { argb: 'FF9CA3AF' } }
};
const BOX: Partial<ExcelJS.Borders> = { left: { style: 'thin' }, right: { style: 'thin' }, top: { style: 'thin' }, bottom: { style: 'thin' } };
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const HEAD_FILL = fill('FFD1D5DB');
const TOTAL_FILL = fill('FFDBE4EF');
const GRAND_FILL = fill('FFC6D9A8');
const MARK_FILL = fill('FFFFFF00');

const METHOD_LABEL: Record<Line['method'], string> = {
    volume: 'ปริมาตร',
    area: 'พื้นที่',
    length: 'ความยาว',
    count: 'จำนวน',
    rebar: 'เหล็กเส้น',
    steel: 'เหล็กรูปพรรณ',
    model: 'จากโมเดล'
};

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thaiDate = (iso?: string) => {
    const match = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${Number(match[3])} ${THAI_MONTHS[Number(match[2]) - 1]} ${Number(match[1]) + 543}` : '';
};

/** ชื่อ sheet: ไม่เกิน 31 ตัว ไม่มี []:*?/\ และไม่ซ้ำ */
function sheetNamer() {
    const used = new Set<string>();
    return (raw: string) => {
        const base = raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'หมวด';
        let name = base;
        for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`;
        used.add(name.toLowerCase());
        return name;
    };
}
const ref = (sheet: string, cell: string) => `'${sheet.replaceAll("'", "''")}'!${cell}`;

const COLUMNS = [
    { header: 'ลำดับ', width: 7 },
    { header: 'รายการ', width: 58 },
    { header: 'หน่วย', width: 9 },
    { header: 'ปริมาณ', width: 12 },
    { header: 'ราคา/หน่วย', width: 13 },
    { header: 'ราคารวม', width: 15 },
    { header: 'ราคา/หน่วย', width: 13 },
    { header: 'ราคารวม', width: 15 },
    { header: 'รวมราคา', width: 17 }
];

function setupSheet(sheet: ExcelJS.Worksheet) {
    sheet.columns = COLUMNS.map((column) => ({ width: column.width }));
    sheet.properties.defaultRowHeight = 18;
    sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } };
    sheet.headerFooter = { oddFooter: '&Lหน้า &P / &N&R&A' };
}

/** หัวกระดาษ (ชื่อเอกสาร + ข้อมูลโครงการ) + หัวตาราง 2 แถว — คืนเลขแถวสุดท้ายของหัวตาราง */
function writeHeader(sheet: ExcelJS.Worksheet, estimate: Estimate, company: Company | undefined, logo: number | null): number {
    writeLetterhead(sheet, company, logo);
    const T = LETTERHEAD_ROWS + 1; // แถวชื่อเอกสาร
    const H = T + 5; // แถวแรกของหัวตาราง (2 แถว)
    sheet.mergeCells(`A${T}:I${T}`);
    const title = sheet.getCell(`A${T}`);
    title.value = 'รายละเอียดบัญชีแสดงปริมาณงานและราคา';
    title.font = { name: FONT, size: 16, bold: true };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    title.border = BOX;
    sheet.getRow(T).height = 28;

    const meta: Array<[string, string, string, string]> = [
        ['โครงการ', estimate.title, 'วันที่', thaiDate(estimate.estimateDate)],
        ['เจ้าของโครงการ', estimate.ownerName ?? '', 'เลขที่', estimate.id + (estimate.projectCode ? ` · โครงการ ${estimate.projectCode}` : '')],
        ['สถานที่ก่อสร้าง', estimate.location ?? '', 'ผู้เสนอราคา', estimate.estimator ?? '']
    ];
    meta.forEach(([leftLabel, leftValue, rightLabel, rightValue], index) => {
        const row = sheet.getRow(T + 1 + index);
        sheet.mergeCells(row.number, 2, row.number, 5);
        sheet.mergeCells(row.number, 7, row.number, 9);
        row.getCell(1).value = leftLabel;
        row.getCell(2).value = `: ${leftValue}`;
        row.getCell(6).value = rightLabel;
        row.getCell(7).value = `: ${rightValue}`;
        row.font = { name: FONT, size: 11 };
        row.getCell(1).font = row.getCell(6).font = { name: FONT, size: 11, bold: true };
    });

    const top = sheet.getRow(H);
    const bottom = sheet.getRow(H + 1);
    top.values = ['ลำดับ', 'รายการ', 'หน่วย', 'ปริมาณ', 'ราคาวัสดุ', '', 'ราคาค่าแรง', '', 'รวมราคา'];
    bottom.values = ['', '', '', '', 'ราคา/หน่วย', 'ราคารวม', 'ราคา/หน่วย', 'ราคารวม', ''];
    for (const col of ['A', 'B', 'C', 'D', 'I']) sheet.mergeCells(`${col}${H}:${col}${H + 1}`);
    sheet.mergeCells(`E${H}:F${H}`);
    sheet.mergeCells(`G${H}:H${H}`);
    for (const row of [top, bottom]) {
        row.eachCell({ includeEmpty: true }, (cell, col) => {
            if (col > 9) return;
            cell.font = { name: FONT, size: 11, bold: true };
            cell.fill = HEAD_FILL;
            cell.border = BOX;
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        });
    }
    // หัวตารางพิมพ์ซ้ำทุกหน้า และตรึงไว้ตอนเลื่อน
    sheet.pageSetup.printTitlesRow = `${H}:${H + 1}`;
    sheet.views = [{ state: 'frozen', ySplit: H + 1 }];
    return H + 1;
}

/** แถวในตาราง (เส้นขอบแนวตั้ง + รูปแบบตัวเลข) */
function styleBodyRow(row: ExcelJS.Row, options: { bold?: boolean; fill?: ExcelJS.Fill; box?: boolean } = {}) {
    for (let col = 1; col <= 9; col++) {
        const cell = row.getCell(col);
        cell.font = { name: FONT, size: 11, bold: options.bold ?? false, ...(cell.font?.color ? { color: cell.font.color } : {}), ...(cell.font?.italic ? { italic: true } : {}) };
        cell.border = options.box ? BOX : BORDER;
        if (options.fill) cell.fill = options.fill;
        if (col === 1 || col === 3) cell.alignment = { horizontal: 'center', vertical: 'top' };
        else if (col === 2) cell.alignment = { vertical: 'top', wrapText: true, indent: cell.alignment?.indent ?? 0, horizontal: cell.alignment?.horizontal };
        else {
            cell.alignment = { horizontal: 'right', vertical: 'top' };
            cell.numFmt = col === 4 ? QTY : MONEY;
        }
    }
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export async function estimateWorkbook(estimate: Estimate, options: { company?: Company } = {}): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    // ExcelJS ต้องการ Buffer แบบ Node รุ่นเก่า — ส่งเป็น ArrayBuffer ของไฟล์แทน
    const logo = LOGO ? workbook.addImage({ buffer: LOGO.buffer.slice(LOGO.byteOffset, LOGO.byteOffset + LOGO.byteLength) as ArrayBuffer, extension: 'png' }) : null;
    const company = options.company;
    workbook.creator = estimate.estimator || 'CM Planning';
    workbook.created = new Date();
    workbook.title = estimate.title;
    workbook.calcProperties.fullCalcOnLoad = true;

    const name = sheetNamer();
    const summary = workbook.addWorksheet(name('สรุปราคา'), { properties: { tabColor: { argb: 'FF5B8BD6' } } });
    /** แถวยอดรวมของแต่ละหมวด (อ้างอิงจากหน้าสรุป) */
    const categoryTotals: Array<{ sheet: string; row: number; id: string }> = [];
    const takeoffRows: Array<{ category: string; item: string; unit: string; waste?: number; lines: Line[]; quantity: number }> = [];

    // ---------- sheet ละหมวด ----------
    for (const category of estimate.categories) {
        const sheetName = name(category.name);
        const sheet = workbook.addWorksheet(sheetName, category.excluded ? { properties: { tabColor: { argb: 'FF9CA3AF' } } } : {});
        setupSheet(sheet);
        let r = writeHeader(sheet, estimate, company, logo) + 1;

        const catRow = sheet.getRow(r++);
        catRow.getCell(2).value = category.name + (category.excluded ? ' (ไม่รวมในสรุปราคา)' : '');
        styleBodyRow(catRow, { bold: true });
        catRow.getCell(2).fill = MARK_FILL;
        const firstItemRow = r;

        category.groups.forEach((group, g) => {
            if (group.title) {
                const row = sheet.getRow(r++);
                row.getCell(1).value = g + 1;
                row.getCell(2).value = group.title;
                styleBodyRow(row, { bold: true });
            }
            for (const item of group.items) {
                const row = sheet.getRow(r);
                if (item.kind === 'heading') {
                    row.getCell(2).value = item.description;
                    styleBodyRow(row);
                    row.getCell(2).font = { name: FONT, size: 11, underline: true };
                    r++;
                    continue;
                }
                const material = round2(item.quantity * item.materialPrice);
                const labor = round2(item.quantity * item.laborPrice);
                row.values = [
                    null,
                    (item.indent ? '- ' : '') + item.description,
                    item.unit ?? '',
                    item.quantity,
                    item.materialPrice,
                    { formula: `ROUND(D${r}*E${r},2)`, result: material },
                    item.laborPrice,
                    { formula: `ROUND(D${r}*G${r},2)`, result: labor },
                    { formula: `F${r}+H${r}`, result: round2(material + labor) }
                ];
                styleBodyRow(row);
                if (item.indent) row.getCell(2).alignment = { vertical: 'top', wrapText: true, indent: 2 };
                if (item.note) row.getCell(2).note = item.note;
                if (item.takeoff?.length) takeoffRows.push({ category: category.name, item: item.description, unit: item.unit ?? '', waste: item.waste, lines: item.takeoff, quantity: item.quantity });
                r++;
            }
        });
        // แถวว่างก่อนยอดรวม (เส้นขอบต่อเนื่องเหมือนแบบฟอร์ม)
        styleBodyRow(sheet.getRow(r++));
        const lastItemRow = r - 1;

        const totals = estimate.totals.categories.find((item) => item.id === category.id) ?? { material: 0, labor: 0, total: 0 };
        const totalRow = sheet.getRow(r);
        totalRow.getCell(2).value = `รวมราคา${category.name}`;
        totalRow.getCell(6).value = { formula: `SUM(F${firstItemRow}:F${lastItemRow})`, result: totals.material };
        totalRow.getCell(8).value = { formula: `SUM(H${firstItemRow}:H${lastItemRow})`, result: totals.labor };
        totalRow.getCell(9).value = { formula: `F${r}+H${r}`, result: totals.total };
        styleBodyRow(totalRow, { bold: true, fill: TOTAL_FILL, box: true });
        totalRow.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.pageSetup.printArea = `A1:I${r}`;
        if (!category.excluded) categoryTotals.push({ sheet: sheetName, row: r, id: category.id });
    }

    // ---------- สรุปราคา ----------
    setupSheet(summary);
    let r = writeHeader(summary, estimate, company, logo) + 1;
    const headRow = summary.getRow(r++);
    headRow.getCell(2).value = 'สรุปราคาค่าก่อสร้าง';
    styleBodyRow(headRow, { bold: true });
    headRow.getCell(2).font = { name: FONT, size: 11, bold: true, underline: true };
    const firstRow = r;
    categoryTotals.forEach((entry, index) => {
        const totals = estimate.totals.categories.find((item) => item.id === entry.id)!;
        const category = estimate.categories.find((item) => item.id === entry.id)!;
        const row = summary.getRow(r);
        row.values = [
            index + 1,
            category.name,
            'งาน',
            1,
            null,
            { formula: ref(entry.sheet, `F${entry.row}`), result: totals.material },
            null,
            { formula: ref(entry.sheet, `H${entry.row}`), result: totals.labor },
            { formula: `F${r}+H${r}`, result: totals.total }
        ];
        styleBodyRow(row);
        r++;
    });
    const lastRow = r - 1;
    for (const note of estimate.notes ?? []) {
        const row = summary.getRow(r++);
        row.getCell(2).value = `- ${note}`;
        styleBodyRow(row);
        row.getCell(2).font = { name: FONT, size: 11, italic: true, color: { argb: 'FFDC2626' } };
    }
    styleBodyRow(summary.getRow(r++));

    const sumRow = summary.getRow(r);
    const subtotalRow = r;
    sumRow.getCell(2).value = `รวม ${categoryTotals.length} รายการ`;
    const range = (col: string) => (categoryTotals.length ? `SUM(${col}${firstRow}:${col}${lastRow})` : '0');
    sumRow.getCell(6).value = { formula: range('F'), result: estimate.totals.material };
    sumRow.getCell(8).value = { formula: range('H'), result: estimate.totals.labor };
    sumRow.getCell(9).value = { formula: `F${r}+H${r}`, result: estimate.totals.subtotal };
    styleBodyRow(sumRow, { bold: true, fill: TOTAL_FILL, box: true });
    sumRow.getCell(2).alignment = { horizontal: 'center' };
    r++;

    // % อยู่ในช่องแยก (D) แก้ใน Excel แล้วยอดรวมคำนวณใหม่ — ค่าดำเนินการ/กำไรคิดจากวัสดุ + ค่าแรง, ภาษีคิดจากรวมก่อนภาษี
    const percentRow = (label: string, percent: number, base: number, result: number) => {
        const row = summary.getRow(r);
        row.getCell(2).value = label;
        row.getCell(4).value = percent;
        row.getCell(9).value = { formula: `ROUND(I${base}*D${r}/100,2)`, result };
        styleBodyRow(row, { bold: true, fill: TOTAL_FILL, box: true });
        row.getCell(2).alignment = { horizontal: 'center' };
        row.getCell(4).numFmt = '0.00"%"';
        return r++;
    };
    const overheadAt = percentRow('ค่าดำเนินการ (%)', estimate.overheadPercent ?? 0, subtotalRow, estimate.totals.overhead);
    const profitAt = percentRow('กำไร (%)', estimate.profitPercent ?? 0, subtotalRow, estimate.totals.profit);

    const beforeVatRow = summary.getRow(r);
    beforeVatRow.getCell(2).value = 'รวมก่อนภาษีมูลค่าเพิ่ม';
    beforeVatRow.getCell(9).value = { formula: `I${subtotalRow}+I${overheadAt}+I${profitAt}`, result: estimate.totals.beforeVat };
    styleBodyRow(beforeVatRow, { bold: true, fill: TOTAL_FILL, box: true });
    beforeVatRow.getCell(2).alignment = { horizontal: 'center' };
    const beforeVatAt = r++;
    const vatAt = percentRow('ภาษีมูลค่าเพิ่ม (%)', estimate.vatPercent ?? 0, beforeVatAt, estimate.totals.vat);

    const grandRow = summary.getRow(r);
    summary.mergeCells(r, 2, r, 8);
    grandRow.getCell(2).value = 'รวมเป็นเงินทั้งสิ้น';
    grandRow.getCell(9).value = { formula: `I${beforeVatAt}+I${vatAt}`, result: estimate.totals.grandTotal };
    styleBodyRow(grandRow, { bold: true, fill: GRAND_FILL, box: true });
    grandRow.getCell(2).alignment = { horizontal: 'center' };
    grandRow.font = { name: FONT, size: 13, bold: true };
    grandRow.height = 22;
    const grandAt = r;
    r++;

    if (estimate.area) {
        const areaRow = summary.getRow(r);
        areaRow.getCell(2).value = 'พื้นที่ทั้งหมด (ตร.ม.)';
        areaRow.getCell(4).value = estimate.area;
        areaRow.getCell(6).value = 'ราคาเฉลี่ย (บาท/ตร.ม.)';
        summary.mergeCells(r, 6, r, 8);
        areaRow.getCell(9).value = { formula: `ROUND(I${grandAt}/D${r},2)`, result: estimate.totals.pricePerSqm ?? 0 };
        styleBodyRow(areaRow, { bold: true, box: true });
        areaRow.getCell(2).alignment = { horizontal: 'right' };
        areaRow.getCell(6).alignment = { horizontal: 'right' };
        r++;
    }
    summary.pageSetup.printArea = `A1:I${r - 1}`;

    // ---------- ถอดปริมาณ ----------
    if (takeoffRows.length) {
        const sheet = workbook.addWorksheet(name('ถอดปริมาณ'), { properties: { tabColor: { argb: 'FFF59E0B' } } });
        sheet.columns = [
            { header: 'หมวดงาน', width: 26 },
            { header: 'รายการ', width: 40 },
            { header: 'บรรทัด', width: 34 },
            { header: 'วิธี', width: 12 },
            { header: 'กว้าง (ม.)', width: 10 },
            { header: 'ยาว (ม.)', width: 10 },
            { header: 'สูง/หนา (ม.)', width: 11 },
            { header: 'จำนวน', width: 9 },
            { header: 'ขนาด/กก.ต่อ ม.', width: 13 },
            { header: 'ผล', width: 12 },
            { header: 'หน่วย', width: 9 }
        ];
        const head = sheet.getRow(1);
        head.eachCell((cell) => {
            cell.font = { name: FONT, size: 11, bold: true };
            cell.fill = HEAD_FILL;
            cell.border = BOX;
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        });
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        for (const entry of takeoffRows) {
            for (const line of entry.lines) {
                const sign = line.deduct ? -1 : 1;
                const row = sheet.addRow([
                    entry.category,
                    entry.item,
                    (line.deduct ? '(หัก) ' : '') + (line.label ?? ''),
                    METHOD_LABEL[line.method],
                    line.width ?? null,
                    line.length ?? null,
                    line.height ?? null,
                    line.count,
                    line.method === 'rebar' ? (line.diameter ? `Ø${line.diameter} มม.` : null) : line.method === 'steel' ? (line.kgPerMeter ?? null) : null,
                    sign * Math.abs(line.result ?? 0),
                    entry.unit
                ]);
                row.font = { name: FONT, size: 10 };
                for (const col of [5, 6, 7, 8, 10]) row.getCell(col).numFmt = '#,##0.00;-#,##0.00;""';
            }
            const total = sheet.addRow(['', `ปริมาณรวม${entry.waste ? ` (เผื่อเสีย ${entry.waste}%)` : ''}`, '', '', null, null, null, null, null, entry.quantity, entry.unit]);
            total.font = { name: FONT, size: 10, bold: true };
            total.getCell(10).numFmt = '#,##0.00';
            total.eachCell({ includeEmpty: true }, (cell, col) => {
                if (col <= 11) cell.fill = TOTAL_FILL;
            });
        }
        sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' };
    }

    // ---------- รายการวัสดุจากโมเดล ----------
    if (estimate.source?.materials.length) {
        const sheet = workbook.addWorksheet(name('รายการวัสดุ'), { properties: { tabColor: { argb: 'FF10B981' } } });
        sheet.columns = [
            { header: 'รหัสวัสดุ', width: 14 },
            { header: 'วัสดุ', width: 42 },
            { header: 'จำนวน', width: 13 },
            { header: 'หน่วย', width: 10 },
            { header: 'ที่มาของจำนวน', width: 50 }
        ];
        sheet.getRow(1).eachCell((cell) => {
            cell.font = { name: FONT, size: 11, bold: true };
            cell.fill = HEAD_FILL;
            cell.border = BOX;
            cell.alignment = { horizontal: 'center' };
        });
        for (const material of estimate.source.materials) {
            const row = sheet.addRow([material.materialCode ?? '', material.name, material.quantity, material.unit, material.basis]);
            row.font = { name: FONT, size: 10 };
            row.getCell(3).numFmt = '#,##0.00';
        }
        sheet.addRow([]);
        const info = sheet.addRow(['', `ถอดจากโมเดล ${estimate.source.fileName} (${estimate.source.elements} ชิ้นงาน)`]);
        info.font = { name: FONT, size: 10, italic: true, color: { argb: 'FF6B7280' } };
        for (const warning of estimate.source.warnings) {
            const row = sheet.addRow(['', `⚠ ${warning}`]);
            row.font = { name: FONT, size: 10, color: { argb: 'FFB45309' } };
        }
    }

    writeStatement(workbook.addWorksheet(name('คำชี้แจงค่าดำเนินการ'), { properties: { tabColor: { argb: 'FF7C3AED' } } }), estimate, company, logo);

    workbook.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];
    return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** ชื่อไฟล์ดาวน์โหลด เช่น BOQ-EST-0001-บ้านพักอาศัย.xlsx */
export const estimateFileName = (estimate: Estimate) => `BOQ-${estimate.id}-${estimate.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60)}.xlsx`;

// ---------- เอกสารชี้แจงค่าดำเนินการ ----------

/** จำนวนบรรทัดโดยประมาณของข้อความในคอลัมน์กว้าง width (ไม่นับสระ/วรรณยุกต์ที่ไม่กินที่) — ใช้ตั้งความสูงแถว */
const lineCount = (text: string, width: number) =>
    text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.replace(/[ัิ-ฺ็-๎]/g, '').length / (width * 1.15))), 0);

type StatementBlocks = ApiSchemas['StatementBlock'][];

function writeStatement(sheet: ExcelJS.Worksheet, estimate: Estimate, company: Company | undefined, logo: number | null) {
    const statement: ApiSchemas['OverheadStatement'] = estimate.statement!;
    const TEXT_WIDTH = 82;
    sheet.columns = [{ width: 7 }, { width: TEXT_WIDTH }, { width: 12 }, { width: 15 }, { width: 22 }];
    sheet.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.6, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
    sheet.headerFooter = { oddFooter: `&L${statement.title}&Rหน้า &P / &N` };
    const add = (values: ExcelJS.CellValue[], font: Partial<ExcelJS.Font> = {}) => {
        const row = sheet.addRow(values);
        row.eachCell({ includeEmpty: true }, (cell) => {
            cell.font = { name: FONT, size: 11, ...font };
            cell.alignment = { vertical: 'top', wrapText: true };
        });
        const lines = lineCount(String(row.getCell(2).value ?? ''), TEXT_WIDTH);
        if (lines > 1) row.height = lines * 16 + 2;
        return row;
    };
    const numberCell = (row: ExcelJS.Row) => (row.getCell(1).alignment = { horizontal: 'right', vertical: 'top' });

    writeLetterhead(sheet, company, logo);
    sheet.addRow([]);
    add(['', statement.title], { size: 15, bold: true }).getCell(2).alignment = { horizontal: 'center' };
    if (statement.subtitle) add(['', statement.subtitle], { bold: true }).getCell(2).alignment = { horizontal: 'center' };
    sheet.addRow([]);
    const blank = '.................................................';
    const meta: Array<[string, string]> = [
        ['ชื่อโครงการ', estimate.title],
        ['สถานที่ก่อสร้าง', estimate.location ?? ''],
        ['เจ้าของโครงการ', estimate.ownerName ?? ''],
        ['ผู้รับเหมาก่อสร้าง', company?.name ?? ''],
        ['เลขที่เอกสาร BOQ', estimate.id + (estimate.estimateDate ? ` ลงวันที่ ${thaiDate(estimate.estimateDate)}` : '')]
    ];
    for (const [label, value] of meta) add(['', `${label}: ${value || blank}`]);
    const money = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const box = add(['', `ค่าดำเนินการตาม BOQ ฉบับนี้ ${estimate.overheadPercent ?? 0}% ของค่าวัสดุและค่าแรง (${money(estimate.totals.subtotal)} บาท) เป็นเงิน ${money(estimate.totals.overhead)} บาท`], { bold: true });
    box.getCell(2).fill = TOTAL_FILL;
    box.getCell(2).border = BOX;
    sheet.addRow([]);

    const writeBlocks = (blocks: StatementBlocks, clause: { n: number; prefix: string }) => {
        for (const block of blocks) {
            if (block.kind === 'paragraph') add(['', block.text ?? '']);
            else if (block.kind === 'list') {
                if (block.title) add(['', block.title], { bold: true, underline: true });
                (block.items ?? []).forEach((item, index) => {
                    const mark = block.style === 'bullet' ? '•' : block.style === 'clause' ? `${clause.prefix}.${++clause.n}` : `${index + 1}.`;
                    numberCell(add([mark, item]));
                });
            } else if (block.kind === 'responsibility') {
                const head = sheet.addRow(['', 'รายการ', 'ผู้รับเหมา', 'เจ้าของโครงการ', 'หมายเหตุ']);
                head.eachCell((cell, col) => {
                    if (col < 2) return;
                    cell.font = { name: FONT, size: 11, bold: true };
                    cell.fill = HEAD_FILL;
                    cell.border = BOX;
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                });
                for (const r of block.rows ?? []) {
                    const row = sheet.addRow(['', r.item, r.contractor ? '☑' : '☐', r.owner ? '☑' : '☐', r.note ?? '']);
                    for (let col = 2; col <= 5; col++) {
                        const cell = row.getCell(col);
                        const check = col === 3 || col === 4;
                        cell.font = { name: FONT, size: check ? 13 : 11 };
                        cell.border = BOX;
                        cell.alignment = { vertical: 'middle', wrapText: true, horizontal: check ? 'center' : 'left' };
                    }
                }
            }
        }
    };
    statement.sections.forEach((section, s) => {
        const no = String(s + 1);
        numberCell(add([`${no}.`, section.title], { bold: true, size: 12 }));
        writeBlocks(section.blocks, { n: 0, prefix: no });
        section.subsections.forEach((subsection, j) => {
            numberCell(add([`${no}.${j + 1}`, subsection.title], { bold: true }));
            writeBlocks(subsection.blocks, { n: 0, prefix: `${no}.${j + 1}` });
        });
        sheet.addRow([]);
    });

    // ช่องลงนาม
    sheet.addRow([]);
    for (const party of ['ผู้รับเหมาก่อสร้าง', 'เจ้าของโครงการ']) {
        add(['', `ลงชื่อ ........................................................ ${party}`]);
        add(['', '        (.....................................................................)']);
        add(['', '        วันที่ ............... / ............... / ...............']);
        sheet.addRow([]);
    }
}
