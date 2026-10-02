import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { Project, ProjectService } from '@/app/pages/service/project.service';

const todayLocal = () => new Intl.DateTimeFormat('en-CA').format(new Date());

function addMonths(isoDate: string, months: number): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10);
}

/** บันทึกสัญญา (POST /projects/{code}/contract) */
@Component({
    selector: 'app-contract-form',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, DialogModule, FormsModule, InputNumberModule, InputTextModule, TextareaModule],
    template: `
        <p-dialog [visible]="true" (visibleChange)="!$event && closed.emit()" [modal]="true" [draggable]="false" [style]="{ width: 'min(40rem, 95vw)' }" header="บันทึกสัญญา">
            <p class="text-sm text-muted-color mt-0 mb-5">{{ project().code }} · {{ project().name }} — ขั้นต่อไปคือตั้งค่างานก่อสร้าง ระบบจะสร้างไทม์ไลน์ให้พอดีกับระยะสัญญาและงวดงานตามมูลค่าสัญญา</p>

            <form id="contract-form" class="grid grid-cols-1 md:grid-cols-2 gap-4" (ngSubmit)="submit()" novalidate>
                <div>
                    <label for="contract-value" class="block text-sm font-semibold mb-2">มูลค่าสัญญา (บาท) <span class="text-red-600" aria-hidden="true">*</span></label>
                    <p-inputnumber
                        inputId="contract-value"
                        name="value"
                        [ngModel]="value()"
                        (ngModelChange)="value.set($event)"
                        [min]="0"
                        [maxFractionDigits]="2"
                        locale="th-TH"
                        class="w-full"
                        [inputStyle]="{ width: '100%' }"
                        [invalid]="!!errors()['value']"
                    />
                    @if (errors()['value']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['value'] }}</small>
                    }
                </div>
                <div>
                    <label for="signed-date" class="block text-sm font-semibold mb-2">วันที่เซ็นสัญญา <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="signed-date" name="signedDate" type="date" class="w-full" [max]="today" [ngModel]="signedDate()" (ngModelChange)="signedDate.set($event)" [attr.aria-invalid]="!!errors()['signedDate']" />
                    @if (errors()['signedDate']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['signedDate'] }}</small>
                    }
                </div>
                <div>
                    <label for="start-date" class="block text-sm font-semibold mb-2">วันเริ่มงาน <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="start-date" name="startDate" type="date" class="w-full" [min]="signedDate()" [ngModel]="startDate()" (ngModelChange)="startDate.set($event)" [attr.aria-invalid]="!!errors()['startDate']" />
                    @if (errors()['startDate']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['startDate'] }}</small>
                    }
                </div>
                <div>
                    <label for="delivery-date" class="block text-sm font-semibold mb-2">กำหนดส่งมอบ <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="delivery-date" name="deliveryDate" type="date" class="w-full" [min]="startDate()" [ngModel]="deliveryDate()" (ngModelChange)="deliveryDate.set($event)" [attr.aria-invalid]="!!errors()['deliveryDate']" />
                    @if (errors()['deliveryDate']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['deliveryDate'] }}</small>
                    }
                </div>
                <div class="md:col-span-2 flex flex-wrap items-center gap-2">
                    <span class="text-sm text-muted-color">ระยะเวลาก่อสร้าง:</span>
                    @for (months of [6, 9, 12, 15]; track months) {
                        <button type="button" class="px-3 py-1 rounded-full border border-surface text-sm cursor-pointer bg-transparent hover:bg-emphasis" [disabled]="!startDate()" (click)="deliveryDate.set(addMonths(startDate(), months))">
                            {{ months }} เดือน
                        </button>
                    }
                    @if (durationDays() > 0) {
                        <span class="text-sm ml-auto">{{ durationDays() }} วัน (~{{ durationDays() / 30 | number: '1.0-1' }} เดือน)</span>
                    }
                </div>
                <div class="md:col-span-2">
                    <label for="site-location" class="block text-sm font-semibold mb-2">ที่ตั้งหน้างาน <span class="text-red-600" aria-hidden="true">*</span></label>
                    <textarea pTextarea id="site-location" name="location" rows="2" class="w-full" placeholder="เลขที่ ตำบล อำเภอ" [ngModel]="location()" (ngModelChange)="location.set($event)" [attr.aria-invalid]="!!errors()['location']"></textarea>
                    @if (errors()['location']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['location'] }}</small>
                    }
                </div>
            </form>

            @if (generalError()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ generalError() }}</div>
            }

            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" (click)="closed.emit()"></button>
                <button pButton type="submit" form="contract-form" icon="pi pi-check" label="บันทึกสัญญา" [loading]="saving()"></button>
            </ng-template>
        </p-dialog>
    `
})
export class ContractForm implements OnInit {
    private readonly projectService = inject(ProjectService);

    readonly project = input.required<Project>();
    readonly saved = output<Project>();
    readonly closed = output<void>();

    readonly today = todayLocal();
    readonly addMonths = addMonths;
    readonly value = signal<number | null>(null);
    readonly signedDate = signal(this.today);
    readonly startDate = signal(this.today);
    readonly deliveryDate = signal(addMonths(this.today, 9));
    readonly location = signal('');
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');

    readonly durationDays = computed(() => {
        const start = Date.parse(this.startDate());
        const end = Date.parse(this.deliveryDate());
        return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86_400_000) : 0;
    });

    ngOnInit() {
        // ที่อยู่ลูกค้ามักเป็นที่ตั้งหน้างาน — เติมไว้ให้แก้ได้
        this.location.set(this.project().customerAddress ?? '');
    }

    submit() {
        const errors: Record<string, string> = {};
        if (!this.value()) errors['value'] = 'กรุณาระบุมูลค่าสัญญา';
        if (!this.location().trim()) errors['location'] = 'กรุณาระบุที่ตั้งหน้างาน';
        this.errors.set(errors);
        this.generalError.set('');
        if (Object.keys(errors).length) return;

        this.saving.set(true);
        this.projectService.recordContract(this.project().code, { value: this.value()!, signedDate: this.signedDate(), startDate: this.startDate(), deliveryDate: this.deliveryDate(), location: this.location().trim() }).subscribe({
            next: (project) => this.saved.emit(project),
            error: (error) => {
                this.saving.set(false);
                const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                if (problem?.errors) this.errors.set(problem.errors);
                this.generalError.set(problemMessage(error, 'บันทึกสัญญาไม่สำเร็จ'));
            }
        });
    }
}
