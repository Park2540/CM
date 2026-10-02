import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { debounceTime } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TableLazyLoadEvent, TableModule } from 'primeng/table';
import { problemMessage } from '@/app/api/api';
import { ThaiDatePipe } from '@/app/pages/projects/thai-date.pipe';
import { AUDIT_MODULE_LABEL, AuditEntry, AuditLogService, AuditModule } from '@/app/pages/service/audit-log.service';
import { UserService } from '@/app/pages/service/user.service';

const PAGE_SIZE = 15;

@Component({
    selector: 'app-audit-log',
    standalone: true,
    imports: [ButtonModule, FormsModule, IconFieldModule, InputIconModule, InputTextModule, SelectModule, TableModule, ThaiDatePipe],
    template: `
        <div class="flex flex-wrap justify-between items-end gap-3 mb-6">
            <div>
                <h1 class="text-2xl font-bold m-0">Audit Log</h1>
                <p class="text-muted-color mt-1 mb-0">บันทึกทุกการกระทำในระบบ เรียงจากล่าสุด · แก้ไขหรือลบบันทึกไม่ได้</p>
            </div>
            <button pButton type="button" [outlined]="true" icon="pi pi-download" label="ส่งออก CSV" [loading]="exporting()" [disabled]="!logs.value().total" (click)="exportCsv()"></button>
        </div>

        <div class="card">
            <div class="flex flex-wrap items-center gap-3 mb-4">
                <p-select [options]="moduleOptions" [ngModel]="moduleFilter()" (ngModelChange)="moduleFilter.set($event)" optionLabel="label" optionValue="value" placeholder="ทุกระบบ" [showClear]="true" ariaLabel="กรองตามระบบ" class="w-40" />
                <p-select
                    [options]="userOptions()"
                    [ngModel]="userFilter()"
                    (ngModelChange)="userFilter.set($event)"
                    optionLabel="name"
                    optionValue="id"
                    placeholder="ผู้ใช้ทุกคน"
                    [showClear]="true"
                    [filter]="true"
                    ariaLabel="กรองตามผู้ใช้"
                    class="w-52"
                />
                <p-iconfield iconPosition="left" class="ml-auto w-full sm:w-72">
                    <p-inputicon><i class="pi pi-search"></i></p-inputicon>
                    <input pInputText type="search" class="w-full" placeholder="ค้นหาการกระทำ รายการ หรือรายละเอียด" aria-label="ค้นหาใน Audit Log" [ngModel]="query()" (ngModelChange)="query.set($event)" />
                </p-iconfield>
            </div>

            @if (logs.error() || exportError()) {
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                    <span><i class="pi pi-exclamation-triangle mr-2"></i>{{ logs.error() ? 'โหลดบันทึกไม่สำเร็จ: ' + errorMessage(logs.error()) : exportError() }}</span>
                    @if (logs.error()) {
                        <button pButton type="button" [outlined]="true" severity="danger" size="small" icon="pi pi-refresh" label="ลองใหม่" (click)="logs.reload()"></button>
                    }
                </div>
            }

            <p-table
                [value]="logs.value().items"
                [lazy]="true"
                (onLazyLoad)="onPage($event)"
                [totalRecords]="logs.value().total"
                [first]="(page() - 1) * pageSize"
                [rows]="pageSize"
                [paginator]="logs.value().total > pageSize"
                [loading]="logs.isLoading()"
                [rowHover]="true"
                [tableStyle]="{ 'min-width': '64rem' }"
            >
                <ng-template #header>
                    <tr>
                        <th style="width: 10rem">เวลา</th>
                        <th>ผู้ใช้</th>
                        <th>ระบบ</th>
                        <th>การกระทำ</th>
                        <th>รายการ</th>
                        <th>รายละเอียด</th>
                    </tr>
                </ng-template>
                <ng-template #body let-row>
                    @let entry = asEntry(row);
                    <tr>
                        <td class="whitespace-nowrap">{{ entry.at | thaiDate: 'dateTime' }}</td>
                        <td>
                            <div class="font-semibold">{{ entry.user.name }}</div>
                            <div class="text-xs text-muted-color">{{ entry.user.roleLabel }}</div>
                        </td>
                        <td>
                            <span class="px-2 py-1 rounded-md bg-emphasis text-xs whitespace-nowrap">{{ moduleLabel[entry.module] }}</span>
                        </td>
                        <td class="whitespace-nowrap">{{ entry.action }}</td>
                        <td class="font-semibold whitespace-nowrap">{{ entry.target }}</td>
                        <td class="text-muted-color">{{ entry.detail || '-' }}</td>
                    </tr>
                </ng-template>
                <ng-template #emptymessage>
                    <tr>
                        <td colspan="6" class="text-center text-muted-color py-8">{{ logs.isLoading() ? 'กำลังโหลด...' : 'ไม่พบบันทึกที่ตรงกับตัวกรอง' }}</td>
                    </tr>
                </ng-template>
            </p-table>
        </div>
    `
})
export class AuditLog {
    private readonly auditLog = inject(AuditLogService);

    readonly pageSize = PAGE_SIZE;
    readonly moduleLabel = AUDIT_MODULE_LABEL;
    readonly moduleOptions = (Object.keys(AUDIT_MODULE_LABEL) as AuditModule[]).map((value) => ({ value, label: AUDIT_MODULE_LABEL[value] }));
    readonly userOptions = toSignal(inject(UserService).list(), { initialValue: [] });

    readonly moduleFilter = signal<AuditModule | null>(null);
    readonly userFilter = signal<string | null>(null);
    readonly query = signal('');
    private readonly debouncedQuery = toSignal(toObservable(this.query).pipe(debounceTime(300)), { initialValue: '' });
    private readonly filters = computed(() => ({ module: this.moduleFilter(), userId: this.userFilter(), q: this.debouncedQuery() }));
    readonly page = linkedSignal({ source: this.filters, computation: () => 1 });

    readonly logs = rxResource({
        params: () => ({ ...this.filters(), page: this.page(), pageSize: PAGE_SIZE }),
        stream: ({ params }) => this.auditLog.list(params),
        defaultValue: { items: [], total: 0, page: 1, pageSize: PAGE_SIZE }
    });

    readonly exporting = signal(false);
    readonly exportError = signal('');

    /** p-table rows are untyped in the template; this restores the type. */
    asEntry(row: AuditEntry): AuditEntry {
        return row;
    }

    errorMessage(error: unknown) {
        return problemMessage(error);
    }

    onPage(event: TableLazyLoadEvent) {
        this.page.set(Math.floor((event.first ?? 0) / PAGE_SIZE) + 1);
    }

    exportCsv() {
        this.exporting.set(true);
        this.exportError.set('');
        this.auditLog.exportCsv(this.filters()).subscribe({
            next: (blob) => {
                this.exporting.set(false);
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
                link.click();
                URL.revokeObjectURL(url);
            },
            error: (error) => {
                this.exporting.set(false);
                this.exportError.set(`ส่งออกไม่สำเร็จ: ${problemMessage(error)}`);
            }
        });
    }
}
