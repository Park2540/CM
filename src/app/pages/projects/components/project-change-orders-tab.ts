import { DecimalPipe, NgClass } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { problemMessage } from '@/app/api/api';
import { ApprovalService } from '@/app/pages/service/approval.service';
import { CHANGE_SOURCE, CHANGE_STATUS, ChangeOrder, ChangeOrderService } from '@/app/pages/service/change-order.service';
import { TimelinePhase } from '@/app/pages/service/project-timeline.service';
import { ThaiDatePipe } from '../thai-date.pipe';
import { ChangeOrderForm } from './change-order-form';

type Decision = { order: ChangeOrder; action: 'reject' | 'cancel' };

/** แท็บงานเพิ่ม-ลด: สรุปมูลค่า รายการคำขอ ยืนยันจากลูกค้า อนุมัติ/ไม่อนุมัติ และยกเลิก */
@Component({
    selector: 'app-project-change-orders-tab',
    standalone: true,
    imports: [ButtonModule, ChangeOrderForm, ConfirmDialogModule, DecimalPipe, DialogModule, FormsModule, NgClass, RouterLink, TagModule, TextareaModule, ThaiDatePipe],
    providers: [ConfirmationService],
    template: `
        <p-confirmdialog />
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div class="card m-0">
                <div class="text-sm text-muted-color">มูลค่าตามสัญญา</div>
                <div class="text-2xl font-bold mt-2">฿{{ contractValue() | number: '1.0-0' }}</div>
            </div>
            <div class="card m-0">
                <div class="text-sm text-muted-color">งานเพิ่ม-ลดที่อนุมัติ</div>
                <div class="text-2xl font-bold mt-2" [ngClass]="approvedTotal() > 0 ? 'text-green-700 dark:text-green-400' : approvedTotal() < 0 ? 'text-orange-700 dark:text-orange-300' : ''">{{ signed(approvedTotal()) }}</div>
                <div class="text-sm text-muted-color mt-1">{{ approvedCount() }} รายการ</div>
            </div>
            <div class="card m-0">
                <div class="text-sm text-muted-color">มูลค่าสัญญาปัจจุบัน</div>
                <div class="text-2xl font-bold mt-2">฿{{ contractValue() + approvedTotal() | number: '1.0-0' }}</div>
            </div>
            <div class="card m-0">
                <div class="text-sm text-muted-color">รออนุมัติ</div>
                <div class="text-2xl font-bold mt-2" [class.text-orange-600]="pending().length">{{ pending().length }} รายการ</div>
                <div class="text-sm text-muted-color mt-1">{{ pending().length ? 'สุทธิ ' + signed(pendingTotal()) : 'ไม่มีรายการค้าง' }}</div>
            </div>
        </div>

        <section class="card" aria-labelledby="change-orders-heading">
            <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                    <h2 id="change-orders-heading" class="text-lg font-semibold m-0">งานเพิ่ม-ลด</h2>
                    <p class="text-sm text-muted-color mt-1 mb-0">งานนอกสัญญาที่ลูกค้าขอ หรือการแก้ไขระหว่างก่อสร้าง · อนุมัติแล้วระบบปรับมูลค่าสัญญา งวดเงิน กำหนดส่งมอบ และไทม์ไลน์ให้</p>
                </div>
                @if (canManage()) {
                    <button pButton type="button" icon="pi pi-plus" label="ขอเพิ่ม-ลดงาน" (click)="formOpen.set(true)"></button>
                }
            </div>

            @if (error()) {
                <div class="rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert"><i class="pi pi-exclamation-triangle mr-2"></i>{{ error() }}</div>
            }

            <ul class="list-none p-0 m-0 flex flex-col gap-3">
                @for (order of orders(); track order.id) {
                    <li class="border border-surface rounded-lg" [class.opacity-70]="order.status === 'cancelled' || order.status === 'rejected'">
                        <div class="flex flex-wrap items-start gap-x-6 gap-y-3 p-4">
                            <div class="flex-1 min-w-0" style="min-width: 18rem">
                                <div class="flex flex-wrap items-center gap-2 mb-1">
                                    <span class="text-sm font-semibold text-muted-color">{{ order.id }}</span>
                                    <p-tag [value]="statusInfo[order.status].label" [severity]="statusInfo[order.status].severity" />
                                    <span class="text-xs px-2 py-0.5 rounded-full bg-emphasis">{{ sourceInfo[order.source].label }}</span>
                                    @if (order.status === 'pending') {
                                        @if (order.customerConfirmed) {
                                            <span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300"><i class="pi pi-check text-xs mr-1"></i>ลูกค้ายืนยันแล้ว</span>
                                        } @else if (order.source === 'customer') {
                                            <span class="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300"><i class="pi pi-clock text-xs mr-1"></i>รอลูกค้ายืนยัน</span>
                                        }
                                    }
                                </div>
                                <div class="font-semibold">{{ order.title }}</div>
                                <div class="text-sm text-muted-color mt-1">ขอโดย {{ order.requestedBy.name }} · {{ order.requestedAt | thaiDate: 'dateTime' }}</div>
                            </div>
                            <div class="text-right" style="min-width: 10rem">
                                <div class="text-xl font-bold tabular-nums" [ngClass]="order.total > 0 ? 'text-green-700 dark:text-green-400' : order.total < 0 ? 'text-orange-700 dark:text-orange-300' : ''">{{ signed(order.total) }}</div>
                                <div class="text-xs text-muted-color">
                                    {{ order.scheduleImpactDays ? 'กำหนดส่งมอบ ' + (order.scheduleImpactDays > 0 ? '+' : '') + order.scheduleImpactDays + ' วัน' : 'ไม่กระทบกำหนดส่งมอบ' }}
                                </div>
                            </div>
                            <button
                                pButton
                                type="button"
                                [text]="true"
                                [rounded]="true"
                                severity="secondary"
                                [icon]="expanded() === order.id ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
                                [attr.aria-expanded]="expanded() === order.id"
                                [attr.aria-label]="(expanded() === order.id ? 'ซ่อนรายละเอียด ' : 'ดูรายละเอียด ') + order.id"
                                (click)="expanded.set(expanded() === order.id ? null : order.id)"
                            ></button>
                        </div>

                        @if (expanded() === order.id) {
                            <div class="border-t border-surface p-4 flex flex-col gap-4">
                                <p class="m-0"><span class="text-muted-color">เหตุผล:</span> {{ order.reason }}</p>
                                <div class="overflow-x-auto">
                                    <table class="w-full text-sm border-collapse" style="min-width: 36rem">
                                        <thead>
                                            <tr class="text-left text-muted-color border-b border-surface">
                                                <th class="py-2 pr-3 font-semibold">รายการ</th>
                                                <th class="py-2 pr-3 font-semibold">ประเภท</th>
                                                <th class="py-2 pr-3 font-semibold text-right">จำนวน</th>
                                                <th class="py-2 pr-3 font-semibold text-right">ราคา/หน่วย</th>
                                                <th class="py-2 font-semibold text-right">รวม (บาท)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            @for (item of order.items; track $index) {
                                                <tr class="border-b border-surface">
                                                    <td class="py-2 pr-3">{{ item.name }}</td>
                                                    <td class="py-2 pr-3">{{ item.kind === 'add' ? 'งานเพิ่ม' : 'งานลด' }}</td>
                                                    <td class="py-2 pr-3 text-right tabular-nums">{{ item.quantity | number: '1.0-2' }} {{ item.unit }}</td>
                                                    <td class="py-2 pr-3 text-right tabular-nums">{{ item.unitPrice | number: '1.0-2' }}</td>
                                                    <td class="py-2 text-right tabular-nums" [class.text-orange-700]="item.kind === 'deduct'">{{ item.kind === 'deduct' ? '−' : '' }}{{ item.quantity * item.unitPrice | number: '1.0-2' }}</td>
                                                </tr>
                                            }
                                        </tbody>
                                        <tfoot>
                                            <tr>
                                                <td colspan="4" class="pt-2 text-right text-muted-color">เพิ่ม {{ order.addTotal | number: '1.0-2' }} · ลด {{ order.deductTotal | number: '1.0-2' }} · สุทธิ</td>
                                                <td class="pt-2 text-right font-semibold tabular-nums">{{ signed(order.total) }}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                                <dl class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 m-0 text-sm">
                                    @if (order.newTask) {
                                        <div>
                                            <dt class="text-muted-color inline">งานในไทม์ไลน์:</dt>
                                            <dd class="inline m-0 ml-1">
                                                {{ order.newTask.name }} ({{ order.newTask.durationDays }} วัน · {{ phaseLabel(order.newTask.phaseCode) }})
                                                @if (order.appliedTaskCode) {
                                                    · เพิ่มแล้วเป็นงาน {{ order.appliedTaskCode }}
                                                }
                                            </dd>
                                        </div>
                                    }
                                    @if (order.deliveryDateAfter) {
                                        <div>
                                            <dt class="text-muted-color inline">กำหนดส่งมอบ:</dt>
                                            <dd class="inline m-0 ml-1">{{ order.deliveryDateBefore | thaiDate }} → {{ order.deliveryDateAfter | thaiDate }}</dd>
                                        </div>
                                    }
                                    @if (order.customerConfirmedAt) {
                                        <div>
                                            <dt class="text-muted-color inline">ลูกค้ายืนยันเมื่อ:</dt>
                                            <dd class="inline m-0 ml-1">{{ order.customerConfirmedAt | thaiDate: 'dateTime' }}</dd>
                                        </div>
                                    }
                                    @if (order.decidedAt) {
                                        <div>
                                            <dt class="text-muted-color inline">{{ statusInfo[order.status].label }}โดย:</dt>
                                            <dd class="inline m-0 ml-1">{{ order.decidedBy?.name }} · {{ order.decidedAt | thaiDate: 'dateTime' }}{{ order.decisionNote ? ' · ' + order.decisionNote : '' }}</dd>
                                        </div>
                                    }
                                    <div>
                                        <dt class="text-muted-color inline">คำขออนุมัติ:</dt>
                                        <dd class="inline m-0 ml-1">
                                            <a routerLink="/approvals" [queryParams]="{ q: order.approvalId }" class="text-primary">{{ order.approvalId }}</a>
                                        </dd>
                                    </div>
                                </dl>

                                @if (order.status === 'pending' && (canManage() || canApprove())) {
                                    <div class="flex flex-wrap gap-2 pt-2 border-t border-surface">
                                        @if (canManage() && !order.customerConfirmed) {
                                            <button pButton type="button" icon="pi pi-user-edit" label="บันทึกว่าลูกค้ายืนยันแล้ว" [outlined]="true" size="small" [loading]="busy() === order.id" (click)="confirmCustomer(order)"></button>
                                        }
                                        @if (canApprove()) {
                                            <button
                                                pButton
                                                type="button"
                                                icon="pi pi-check"
                                                label="อนุมัติ"
                                                size="small"
                                                [disabled]="order.source === 'customer' && !order.customerConfirmed"
                                                [loading]="busy() === order.id"
                                                (click)="approve(order)"
                                            ></button>
                                            <button pButton type="button" icon="pi pi-times" label="ไม่อนุมัติ" severity="danger" [outlined]="true" size="small" (click)="openDecision(order, 'reject')"></button>
                                        }
                                        @if (canManage()) {
                                            <button pButton type="button" icon="pi pi-ban" label="ยกเลิกคำขอ" severity="secondary" [text]="true" size="small" class="ml-auto" (click)="openDecision(order, 'cancel')"></button>
                                        }
                                    </div>
                                    @if (canApprove() && order.source === 'customer' && !order.customerConfirmed) {
                                        <small class="text-muted-color">งานที่ลูกค้าขอ อนุมัติได้หลังบันทึกว่าลูกค้ายืนยันแล้ว</small>
                                    }
                                }
                            </div>
                        }
                    </li>
                } @empty {
                    <li class="text-center text-muted-color py-10">
                        <i class="pi pi-file-edit text-3xl mb-3 block"></i>
                        ยังไม่มีงานเพิ่ม-ลดในโครงการนี้
                    </li>
                }
            </ul>
        </section>

        @if (formOpen()) {
            <app-change-order-form [projectCode]="projectCode()" [phases]="phases()" (saved)="onCreated($event)" (closed)="formOpen.set(false)" />
        }

        <p-dialog [visible]="!!decision()" (visibleChange)="!$event && closeDecision()" [modal]="true" [draggable]="false" [style]="{ width: 'min(32rem, 95vw)' }" [header]="decision()?.action === 'reject' ? 'ไม่อนุมัติงานเพิ่ม-ลด' : 'ยกเลิกคำขอ'">
            @if (decision(); as current) {
                <p class="mt-0">{{ current.order.id }} · {{ current.order.title }}</p>
                <label for="decision-note" class="block text-sm font-semibold mb-2">
                    เหตุผล
                    @if (current.action === 'reject') {
                        <span class="text-red-600" aria-hidden="true">*</span>
                    }
                </label>
                <textarea pTextarea id="decision-note" rows="2" class="w-full" [ngModel]="decisionNote()" (ngModelChange)="decisionNote.set($event)"></textarea>
                @if (decisionError()) {
                    <small class="text-red-600 dark:text-red-400" role="alert">{{ decisionError() }}</small>
                }
            }
            <ng-template #footer>
                <button pButton type="button" label="ปิด" [text]="true" severity="secondary" (click)="closeDecision()"></button>
                <button pButton type="button" [label]="decision()?.action === 'reject' ? 'ไม่อนุมัติ' : 'ยกเลิกคำขอ'" severity="danger" [loading]="!!busy()" (click)="submitDecision()"></button>
            </ng-template>
        </p-dialog>
    `
})
export class ProjectChangeOrdersTab {
    private readonly service = inject(ChangeOrderService);
    private readonly approvals = inject(ApprovalService);
    private readonly confirmation = inject(ConfirmationService);
    private readonly messages = inject(MessageService);

    readonly projectCode = input.required<string>();
    readonly orders = input.required<ChangeOrder[]>();
    /** มูลค่าตามสัญญาเดิม (ไม่รวมงานเพิ่ม-ลด) */
    readonly contractValue = input.required<number>();
    readonly phases = input.required<TimelinePhase[]>();
    readonly canManage = input(false);
    readonly canApprove = input(false);
    /** มีการเปลี่ยนแปลง: หน้าโครงการโหลดมูลค่า ไทม์ไลน์ และงวดเงินใหม่ */
    readonly changed = output<void>();

    readonly statusInfo = CHANGE_STATUS;
    readonly sourceInfo = CHANGE_SOURCE;
    readonly formOpen = signal(false);
    readonly expanded = signal<string | null>(null);
    readonly busy = signal<string | null>(null);
    readonly error = signal('');
    readonly decision = signal<Decision | null>(null);
    readonly decisionNote = signal('');
    readonly decisionError = signal('');

    readonly pending = computed(() => this.orders().filter((order) => order.status === 'pending'));
    readonly pendingTotal = computed(() => this.pending().reduce((sum, order) => sum + order.total, 0));
    private readonly approved = computed(() => this.orders().filter((order) => order.status === 'approved'));
    readonly approvedCount = computed(() => this.approved().length);
    readonly approvedTotal = computed(() => this.approved().reduce((sum, order) => sum + order.total, 0));

    signed(value: number) {
        return `${value < 0 ? '−' : value > 0 ? '+' : ''}฿${Math.abs(value).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;
    }

    phaseLabel(code: string) {
        const phase = this.phases().find((item) => item.code === code);
        return phase ? `ขั้นตอนที่ ${phase.step} ${phase.shortName}` : `ขั้นตอน ${code}`;
    }

    onCreated(order: ChangeOrder) {
        this.formOpen.set(false);
        this.expanded.set(order.id);
        this.approvals.refreshSummary();
        this.messages.add({ severity: 'success', summary: 'ส่งขออนุมัติแล้ว', detail: `${order.id} · สุทธิ ${this.signed(order.total)}` });
        this.changed.emit();
    }

    confirmCustomer(order: ChangeOrder) {
        this.confirmation.confirm({
            header: 'ลูกค้ายืนยันแล้ว',
            message: `บันทึกว่าลูกค้ายืนยันรายการและราคาของ ${order.id} แล้ว (สุทธิ ${this.signed(order.total)})?`,
            acceptLabel: 'บันทึก',
            rejectLabel: 'ยกเลิก',
            rejectButtonProps: { text: true, severity: 'secondary' },
            accept: () => this.run(order, this.service.confirmByCustomer(this.projectCode(), order.id), 'บันทึกการยืนยันของลูกค้าแล้ว')
        });
    }

    approve(order: ChangeOrder) {
        const effects = [
            `มูลค่าสัญญา ${this.signed(order.total)}`,
            order.scheduleImpactDays ? `กำหนดส่งมอบ ${order.scheduleImpactDays > 0 ? '+' : ''}${order.scheduleImpactDays} วัน` : '',
            order.newTask ? `เพิ่มงาน "${order.newTask.name}" เข้าไทม์ไลน์` : ''
        ].filter(Boolean);
        this.confirmation.confirm({
            header: 'อนุมัติงานเพิ่ม-ลด',
            message: `อนุมัติ ${order.id}? ระบบจะปรับ: ${effects.join(' · ')}`,
            acceptLabel: 'อนุมัติ',
            rejectLabel: 'ยกเลิก',
            rejectButtonProps: { text: true, severity: 'secondary' },
            accept: () => this.run(order, this.approvals.approve(order.approvalId), 'อนุมัติแล้ว ปรับมูลค่าและแผนงานให้แล้ว')
        });
    }

    openDecision(order: ChangeOrder, action: Decision['action']) {
        this.decisionNote.set('');
        this.decisionError.set('');
        this.decision.set({ order, action });
    }

    closeDecision() {
        if (!this.busy()) this.decision.set(null);
    }

    submitDecision() {
        const current = this.decision();
        if (!current) return;
        const note = this.decisionNote().trim();
        if (current.action === 'reject' && !note) {
            this.decisionError.set('กรุณาระบุเหตุผล');
            return;
        }
        const request = current.action === 'reject' ? this.approvals.reject(current.order.approvalId, note) : this.service.cancel(this.projectCode(), current.order.id, note);
        this.run(
            current.order,
            request,
            current.action === 'reject' ? 'บันทึกไม่อนุมัติแล้ว' : 'ยกเลิกคำขอแล้ว',
            () => this.decision.set(null),
            (message) => this.decisionError.set(message)
        );
    }

    private run(order: ChangeOrder, request: { subscribe: (observer: { next: () => void; error: (error: unknown) => void }) => unknown }, success: string, done?: () => void, onError?: (message: string) => void) {
        this.busy.set(order.id);
        this.error.set('');
        request.subscribe({
            next: () => {
                this.busy.set(null);
                done?.();
                this.approvals.refreshSummary();
                this.messages.add({ severity: 'success', summary: success, detail: order.id });
                this.changed.emit();
            },
            error: (error) => {
                this.busy.set(null);
                const message = problemMessage(error, 'ทำรายการไม่สำเร็จ');
                if (onError) onError(message);
                else this.error.set(message);
            }
        });
    }
}
