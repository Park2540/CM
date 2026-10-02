import { Pipe, PipeTransform } from '@angular/core';

const formatters = {
    full: new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    dayMonth: new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    // Real timestamps (audit, approvals) are shown in the viewer's local time.
    dateTime: new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
};

/** วันที่แบบไทย พ.ศ. เช่น "15 ม.ค. 2569" (full), "15 ม.ค." (dayMonth) หรือ "15 ม.ค. 69 14:30" (dateTime) */
@Pipe({ name: 'thaiDate', standalone: true })
export class ThaiDatePipe implements PipeTransform {
    transform(value: Date | string | null | undefined, format: keyof typeof formatters = 'full'): string {
        if (!value) return '-';
        // วันที่ล้วน (YYYY-MM-DD) อ่านเป็นเที่ยงคืน UTC; วันเวลาเต็ม (ISO date-time) ใช้ตามที่ส่งมา
        const date = typeof value === 'string' ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value) : value;
        return Number.isNaN(date.getTime()) ? '-' : formatters[format].format(date);
    }
}
