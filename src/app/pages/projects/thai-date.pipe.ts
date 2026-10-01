import { Pipe, PipeTransform } from '@angular/core';

const formatters = {
    full: new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    dayMonth: new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' })
};

/** วันที่แบบไทย พ.ศ. เช่น "15 ม.ค. 2569" (full) หรือ "15 ม.ค." (dayMonth) */
@Pipe({ name: 'thaiDate', standalone: true })
export class ThaiDatePipe implements PipeTransform {
    transform(value: Date | string | null | undefined, format: keyof typeof formatters = 'full'): string {
        if (!value) return '-';
        const date = typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : value;
        return formatters[format].format(date);
    }
}
