import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { apiResource } from '@/app/api/api-resource';
import { AuthService } from '@/app/pages/service/auth.service';
import { Material, MaterialInput, ProcurementService } from '@/app/pages/service/procurement.service';

interface EditForm extends MaterialInput {
    code?: string;
}

/** รายการวัสดุของบริษัท: ใช้เลือกตอนขอซื้อและทำ BOQ เพื่อเทียบการใช้วัสดุได้ตรง */
@Component({
    selector: 'app-material-list',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, DialogModule, FormsModule, InputTextModule, TagModule, ToastModule],
    providers: [MessageService],
    template: `
        <p-toast />
        <div class="card">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                    <h1 class="text-2xl font-bold m-0">รายการวัสดุ</h1>
                    <p class="text-sm text-muted-color mt-1 mb-0">ใช้เลือกตอนขอซื้อและทำ BOQ ของโครงการ — ราคาล่าสุดมาจากใบสั่งซื้อที่อนุมัติ (รวม VAT)</p>
                </div>
                @if (canEdit()) {
                    <button pButton type="button" icon="pi pi-plus" label="เพิ่มวัสดุ" (click)="openForm()"></button>
                }
            </div>

            <div class="flex flex-wrap gap-2 mb-4">
                <span class="p-input-icon-left flex-1 min-w-60">
                    <input pInputText type="search" class="w-full" placeholder="ค้นหาชื่อ รหัส หรือสเปก" aria-label="ค้นหาวัสดุ" [ngModel]="query()" (ngModelChange)="query.set($event)" />
                </span>
                <select class="native-select" aria-label="หมวดวัสดุ" [value]="category()" (change)="category.set($any($event.target).value)">
                    <option value="">ทุกหมวด</option>
                    @for (item of categories(); track item) {
                        <option [value]="item">{{ item }}</option>
                    }
                </select>
                <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" [checked]="showInactive()" (change)="showInactive.set($any($event.target).checked)" />แสดงที่เลิกใช้</label>
            </div>

            @if (resource.error()) {
                <div class="rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ errorText() }}</div>
            }

            <div class="overflow-x-auto">
                <table class="w-full text-sm border-collapse" style="min-width: 44rem">
                    <thead>
                        <tr class="text-left text-muted-color border-b border-surface">
                            <th class="py-2 pr-2 font-semibold">รหัส</th>
                            <th class="py-2 pr-2 font-semibold">วัสดุ</th>
                            <th class="py-2 pr-2 font-semibold">หน่วย</th>
                            <th class="py-2 pr-2 font-semibold">หมวด</th>
                            <th class="py-2 pr-2 font-semibold text-right">ราคาล่าสุด</th>
                            <th class="py-2 font-semibold w-24"></th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (material of filtered(); track material.code) {
                            <tr class="border-b border-surface" [class.opacity-60]="!material.active">
                                <td class="py-2 pr-2 text-muted-color whitespace-nowrap">{{ material.code }}</td>
                                <td class="py-2 pr-2">
                                    <div class="font-semibold">{{ material.name }}
                                        @if (!material.active) {
                                            <p-tag value="เลิกใช้" severity="secondary" class="ml-1" />
                                        }
                                    </div>
                                    @if (material.spec) {
                                        <div class="text-xs text-muted-color">{{ material.spec }}</div>
                                    }
                                </td>
                                <td class="py-2 pr-2">{{ material.unit }}</td>
                                <td class="py-2 pr-2">{{ material.category }}</td>
                                <td class="py-2 pr-2 text-right tabular-nums">{{ material.lastPrice ? '฿' + (material.lastPrice | number: '1.2-2') : '-' }}</td>
                                <td class="py-2 text-right">
                                    @if (canEdit()) {
                                        <button pButton type="button" [text]="true" size="small" icon="pi pi-pencil" [attr.aria-label]="'แก้ไข ' + material.name" (click)="openForm(material)"></button>
                                    }
                                </td>
                            </tr>
                        } @empty {
                            <tr>
                                <td colspan="6" class="text-center text-muted-color py-8">{{ resource.isLoading() ? 'กำลังโหลด...' : 'ไม่พบวัสดุ' }}</td>
                            </tr>
                        }
                    </tbody>
                </table>
            </div>
            <p class="text-xs text-muted-color mt-3 mb-0">{{ filtered().length }} จาก {{ resource.value().length }} รายการ</p>
        </div>

        @if (form(); as current) {
            <p-dialog [visible]="true" (visibleChange)="!$event && !saving() && form.set(null)" [modal]="true" [draggable]="false" [style]="{ width: 'min(32rem, 96vw)' }" [header]="current.code ? 'แก้ไขวัสดุ ' + current.code : 'เพิ่มวัสดุ'">
                <div class="flex flex-col gap-3">
                    <label class="text-sm font-semibold">ชื่อวัสดุ <span class="text-red-600">*</span>
                        <input pInputText class="w-full mt-1 font-normal" maxlength="200" [(ngModel)]="current.name" [attr.aria-invalid]="!!errors()['name']" />
                    </label>
                    <div class="grid grid-cols-2 gap-3">
                        <label class="text-sm font-semibold">หน่วย <span class="text-red-600">*</span>
                            <input pInputText class="w-full mt-1 font-normal" maxlength="30" placeholder="ถุง / คิว / เส้น" [(ngModel)]="current.unit" [attr.aria-invalid]="!!errors()['unit']" />
                        </label>
                        <label class="text-sm font-semibold">หมวด <span class="text-red-600">*</span>
                            <input pInputText class="w-full mt-1 font-normal" maxlength="50" list="material-categories" [(ngModel)]="current.category" [attr.aria-invalid]="!!errors()['category']" />
                            <datalist id="material-categories">
                                @for (item of categories(); track item) {
                                    <option [value]="item"></option>
                                }
                            </datalist>
                        </label>
                    </div>
                    <label class="text-sm font-semibold">สเปก / ขนาด / ยี่ห้อ
                        <input pInputText class="w-full mt-1 font-normal" maxlength="300" [(ngModel)]="current.spec" />
                    </label>
                    @if (current.code) {
                        <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" [(ngModel)]="current.active" />ใช้งานอยู่ (ไม่เลือก = เลิกใช้ ไม่แสดงตอนขอซื้อ)</label>
                    }
                </div>
                @if (saveError()) {
                    <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ saveError() }}</div>
                }
                <ng-template #footer>
                    <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" [disabled]="saving()" (click)="form.set(null)"></button>
                    <button pButton type="button" icon="pi pi-check" label="บันทึก" [loading]="saving()" (click)="save(current)"></button>
                </ng-template>
            </p-dialog>
        }
    `,
    styles: `
        .native-select {
            padding: 0.5rem 0.75rem;
            border: 1px solid var(--p-inputtext-border-color, var(--p-content-border-color));
            border-radius: var(--p-inputtext-border-radius, 6px);
            background: var(--p-inputtext-background, transparent);
            color: var(--p-text-color);
            font: inherit;
        }
    `
})
export class MaterialList {
    private readonly service = inject(ProcurementService);
    private readonly auth = inject(AuthService);
    private readonly messages = inject(MessageService);

    readonly resource = apiResource({ stream: () => this.service.materials(), defaultValue: [] });
    readonly canEdit = computed(() => this.auth.can('procurement.manage') || this.auth.can('project.manage'));
    readonly query = signal('');
    readonly category = signal('');
    readonly showInactive = signal(false);
    readonly categories = computed(() => [...new Set(this.resource.value().map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'th')));
    readonly filtered = computed(() => {
        const query = this.query().trim().toLowerCase();
        return this.resource
            .value()
            .filter((item) => this.showInactive() || item.active)
            .filter((item) => !this.category() || item.category === this.category())
            .filter((item) => !query || [item.code, item.name, item.spec ?? ''].some((value) => value.toLowerCase().includes(query)));
    });
    readonly errorText = computed(() => problemMessage(this.resource.error(), 'โหลดรายการวัสดุไม่สำเร็จ'));

    readonly form = signal<EditForm | null>(null);
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly saveError = signal('');

    openForm(material?: Material) {
        this.errors.set({});
        this.saveError.set('');
        this.form.set(material ? { code: material.code, name: material.name, unit: material.unit, category: material.category, spec: material.spec ?? '', active: material.active } : { name: '', unit: '', category: this.category() || '', spec: '', active: true });
    }

    save(form: EditForm) {
        const input: MaterialInput = { name: form.name, unit: form.unit, category: form.category, ...(form.spec?.trim() ? { spec: form.spec.trim() } : {}), active: form.active ?? true };
        this.saving.set(true);
        this.errors.set({});
        this.saveError.set('');
        (form.code ? this.service.updateMaterial(form.code, input) : this.service.createMaterial(input)).subscribe({
            next: (material) => {
                this.saving.set(false);
                this.form.set(null);
                this.resource.reload();
                this.messages.add({ severity: 'success', summary: form.code ? `บันทึก ${material.name} แล้ว` : `เพิ่ม ${material.code} ${material.name} แล้ว` });
            },
            error: (error) => {
                this.saving.set(false);
                const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                if (problem?.errors) this.errors.set(problem.errors);
                this.saveError.set(problemMessage(error, 'บันทึกไม่สำเร็จ'));
            }
        });
    }
}
