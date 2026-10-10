import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { CompanyProfile, ProcurementService } from '@/app/pages/service/procurement.service';

/** แก้ข้อมูลบริษัท (หัวกระดาษใบสั่งซื้อ BOQ และเอกสารชี้แจง) — สิทธิ์ user.manage */
@Component({
    selector: 'app-company-profile-dialog',
    standalone: true,
    imports: [ButtonModule, DialogModule, FormsModule, InputTextModule],
    template: `
        @let form = draft();
        <p-dialog [visible]="true" (visibleChange)="!$event && !saving() && closed.emit()" [modal]="true" [draggable]="false" [style]="{ width: 'min(34rem, 96vw)' }" header="ข้อมูลบริษัท (หัวกระดาษเอกสาร)">
            <div class="flex flex-col gap-3">
                <label class="text-sm font-semibold">ชื่อบริษัท <span class="text-red-600">*</span>
                    <input pInputText class="w-full mt-1 font-normal" maxlength="200" [(ngModel)]="form.name" [attr.aria-invalid]="!!errors()['name']" />
                </label>
                <div class="grid grid-cols-2 gap-3">
                    <label class="text-sm font-semibold">เลขประจำตัวผู้เสียภาษี
                        <input pInputText class="w-full mt-1 font-normal" inputmode="numeric" maxlength="17" [(ngModel)]="form.taxId" [attr.aria-invalid]="!!errors()['taxId']" />
                    </label>
                    <label class="text-sm font-semibold">สาขา
                        <input pInputText class="w-full mt-1 font-normal" maxlength="100" placeholder="สำนักงานใหญ่" [(ngModel)]="form.branch" />
                    </label>
                </div>
                <label class="text-sm font-semibold">ที่อยู่
                    <input pInputText class="w-full mt-1 font-normal" maxlength="500" [(ngModel)]="form.address" />
                </label>
                <div class="grid grid-cols-2 gap-3">
                    <label class="text-sm font-semibold">โทร
                        <input pInputText class="w-full mt-1 font-normal" maxlength="50" [(ngModel)]="form.phone" />
                    </label>
                    <label class="text-sm font-semibold">อีเมล
                        <input pInputText type="email" class="w-full mt-1 font-normal" maxlength="100" [(ngModel)]="form.email" />
                    </label>
                </div>
                <p class="text-xs text-muted-color m-0">ใช้กับหัวกระดาษใบสั่งซื้อ BOQ และเอกสารชี้แจงค่าดำเนินการ</p>
            </div>
            @if (error()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800" role="alert">{{ error() }}</div>
            }
            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" [disabled]="saving()" (click)="closed.emit()"></button>
                <button pButton type="button" icon="pi pi-check" label="บันทึก" [loading]="saving()" (click)="save()"></button>
            </ng-template>
        </p-dialog>
    `
})
export class CompanyProfileDialog {
    private readonly service = inject(ProcurementService);

    readonly company = input.required<CompanyProfile>();
    readonly saved = output<CompanyProfile>();
    readonly closed = output<void>();

    /** สำเนาสำหรับแก้ในฟอร์ม (ยกเลิกแล้วไม่กระทบข้อมูลเดิม) */
    readonly draft = signal<CompanyProfile>({ name: '', address: '', taxId: '', phone: '' });
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly error = signal('');

    ngOnInit() {
        this.draft.set({ ...this.company() });
    }

    save() {
        this.saving.set(true);
        this.error.set('');
        this.service.saveCompany(this.draft()).subscribe({
            next: (company) => {
                this.saving.set(false);
                this.saved.emit(company);
            },
            error: (error) => {
                this.saving.set(false);
                const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                this.errors.set(problem?.errors ?? {});
                this.error.set(problemMessage(error, 'บันทึกไม่สำเร็จ'));
            }
        });
    }
}
