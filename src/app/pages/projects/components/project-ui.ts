import { Component, input } from '@angular/core';
import { TimelineStatus } from '@/app/pages/service/project-timeline.service';
import { InstallmentStatus } from '@/app/pages/service/project-records.service';
import { ThaiDatePipe } from '../thai-date.pipe';

export type ProjectTab = 'overview' | 'timeline' | 'updates' | 'team' | 'plan' | 'photos' | 'payments' | 'changes' | 'documents';

export const PROJECT_TABS: Array<{ value: ProjectTab; label: string; icon: string }> = [
    { value: 'overview', label: 'ภาพรวม', icon: 'pi pi-home' },
    { value: 'timeline', label: 'ไทม์ไลน์', icon: 'pi pi-calendar' },
    { value: 'updates', label: 'บันทึกหน้างาน', icon: 'pi pi-book' },
    { value: 'team', label: 'ทีมงานและผู้รับเหมา', icon: 'pi pi-users' },
    { value: 'plan', label: 'แบบบ้าน', icon: 'pi pi-building' },
    { value: 'photos', label: 'ภาพถ่ายหน้างาน', icon: 'pi pi-images' },
    { value: 'payments', label: 'งวดงานและการชำระ', icon: 'pi pi-wallet' },
    { value: 'changes', label: 'งานเพิ่ม-ลด', icon: 'pi pi-file-edit' },
    { value: 'documents', label: 'เอกสาร', icon: 'pi pi-folder' }
];

export const STATUS_LABEL: Record<TimelineStatus, string> = { done: 'เสร็จแล้ว', active: 'กำลังดำเนินการ', pending: 'รอเริ่ม' };

export const STATUS_PILL_CLASS: Record<TimelineStatus, string> = {
    done: 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300',
    active: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
    pending: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300'
};

export const INSTALLMENT_LABEL: Record<InstallmentStatus, string> = { paid: 'ชำระแล้ว', due: 'รอชำระ', working: 'กำลังทำงานงวดนี้', upcoming: 'ยังไม่ถึงงวด' };

export const INSTALLMENT_PILL_CLASS: Record<InstallmentStatus, string> = {
    paid: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300',
    due: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
    working: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
    upcoming: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300'
};

export function initials(name: string): string {
    return name
        .split(' ')
        .slice(0, 2)
        .map((part) => part[0] ?? '')
        .join('');
}

/** ช่องแสดงภาพแทนรูปจริง จนกว่าจะเชื่อมต่อที่เก็บไฟล์ */
@Component({
    selector: 'app-photo-placeholder',
    standalone: true,
    imports: [ThaiDatePipe],
    template: `
        <div class="photo-placeholder relative w-full h-full rounded-lg overflow-hidden flex items-center justify-center text-muted-color">
            <i class="pi pi-image" [class]="large() ? 'text-5xl' : 'text-xl'"></i>
            @if (date()) {
                <span class="absolute left-2 bottom-2 text-xs font-medium px-1.5 py-0.5 rounded bg-surface-0/80 dark:bg-surface-900/80 text-color">{{ date() | thaiDate: 'dayMonth' }}</span>
            }
        </div>
    `,
    styles: `
        .photo-placeholder {
            background: repeating-linear-gradient(135deg, var(--p-surface-100), var(--p-surface-100) 10px, var(--p-surface-200) 10px, var(--p-surface-200) 20px);
        }
        :host-context(.app-dark) .photo-placeholder {
            background: repeating-linear-gradient(135deg, var(--p-surface-800), var(--p-surface-800) 10px, var(--p-surface-700) 10px, var(--p-surface-700) 20px);
        }
    `,
    host: { class: 'block' }
})
export class PhotoPlaceholder {
    readonly date = input<Date | null>(null);
    readonly large = input(false);
}
