import { DecimalPipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { apiResource } from '@/app/api/api-resource';
import { AuthService } from '@/app/pages/service/auth.service';
import { FileUploadService, UploadedFile } from '@/app/pages/service/file-upload.service';
import {
    PURCHASE_STATUS,
    ProcurementService,
    PurchaseRequest,
    RATE_UNIT_LABEL,
    RENTAL_SOURCE_LABEL,
    RENTAL_STATUS,
    RETURN_CONDITION_LABEL,
    Rental
} from '@/app/pages/service/procurement.service';
import { TimelinePhase } from '@/app/pages/service/project-timeline.service';
import { ThaiDatePipe } from '../thai-date.pipe';
import { PurchaseRequestForm } from './purchase-request-form';
import { RentalForm } from './rental-form';

const todayLocal = () => new Intl.DateTimeFormat('en-CA').format(new Date());

type Action =
    | { kind: 'order'; purchase: PurchaseRequest }
    | { kind: 'receive'; purchase: PurchaseRequest }
    | { kind: 'cancel-purchase'; purchase: PurchaseRequest }
    | { kind: 'start'; rental: Rental }
    | { kind: 'extend'; rental: Rental }
    | { kind: 'return'; rental: Rental }
    | { kind: 'cancel-rental'; rental: Rental };

const ACTION_TITLE: Record<Action['kind'], string> = {
    order: 'บันทึกการสั่งซื้อ',
    receive: 'รับของเข้าหน้างาน',
    'cancel-purchase': 'ยกเลิกใบขอซื้อ',
    start: 'รับอุปกรณ์เข้าหน้างาน',
    extend: 'ขยายกำหนดคืน',
    return: 'คืนอุปกรณ์',
    'cancel-rental': 'ยกเลิกการเช่า/ยืม'
};

/** แท็บจัดซื้อ/เช่า: ใบขอซื้อ → อนุมัติ → สั่งซื้อ → รับของ และเช่า/ยืมอุปกรณ์ → รับเข้าหน้างาน → คืน */
@Component({
    selector: 'app-project-procurement-tab',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, DialogModule, FormsModule, InputTextModule, NgClass, PurchaseRequestForm, RentalForm, RouterLink, TagModule, TextareaModule, ThaiDatePipe],
    template: `
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div class="card m-0">
                <div class="text-sm text-muted-color">ขอซื้อวัสดุ</div>
                <div class="text-2xl font-bold mt-2">฿{{ stats().requested | number: '1.0-0' }}</div>
                <div class="text-sm mt-1" [ngClass]="stats().pendingCount ? 'text-orange-600 dark:text-orange-400' : 'text-muted-color'">{{ stats().pendingCount ? 'รออนุมัติ ' + stats().pendingCount + ' ใบ' : 'ไม่มีรายการรออนุมัติ' }}</div>
            </div>
            <div class="card m-0">
                <div class="text-sm text-muted-color">สั่งซื้อแล้ว</div>
                <div class="text-2xl font-bold mt-2">฿{{ stats().ordered | number: '1.0-0' }}</div>
                <div class="text-sm mt-1" [ngClass]="stats().awaitingDelivery ? 'text-orange-600 dark:text-orange-400' : 'text-muted-color'">{{ stats().awaitingDelivery ? 'ค้างรับของ ' + stats().awaitingDelivery + ' ใบ' : 'รับของครบทุกใบ' }}</div>
            </div>
            <div class="card m-0">
                <div class="text-sm text-muted-color">ค่าเช่าอุปกรณ์</div>
                <div class="text-2xl font-bold mt-2">฿{{ stats().rentCost | number: '1.0-0' }}</div>
                <div class="text-sm text-muted-color mt-1">ถึงวันนี้ · ใช้งานอยู่ {{ stats().inUse }} รายการ</div>
            </div>
            <div class="card m-0">
                <div class="text-sm text-muted-color">เลยกำหนดคืน</div>
                <div class="text-2xl font-bold mt-2" [ngClass]="stats().overdue ? 'text-red-600 dark:text-red-400' : ''">{{ stats().overdue }} รายการ</div>
                <div class="text-sm text-muted-color mt-1">{{ stats().overdue ? 'ขยายเวลาหรือคืนอุปกรณ์' : 'ไม่มีรายการค้าง' }}</div>
            </div>
        </div>

        <section class="card" aria-labelledby="procurement-heading">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div class="inline-flex rounded-full border border-surface p-1" role="tablist" aria-label="จัดซื้อหรือเช่า">
                    <button type="button" role="tab" class="seg" [class.seg-active]="section() === 'purchase'" [attr.aria-selected]="section() === 'purchase'" (click)="section.set('purchase')">
                        <i class="pi pi-shopping-cart"></i>จัดซื้อวัสดุ ({{ purchases().length }})
                    </button>
                    <button type="button" role="tab" class="seg" [class.seg-active]="section() === 'rental'" [attr.aria-selected]="section() === 'rental'" (click)="section.set('rental')">
                        <i class="pi pi-wrench"></i>เช่า/ยืมอุปกรณ์ ({{ rentals().length }})
                        @if (stats().overdue) {
                            <span class="w-5 h-5 rounded-full bg-red-500 text-white text-xs inline-flex items-center justify-center">{{ stats().overdue }}</span>
                        }
                    </button>
                </div>
                <h2 id="procurement-heading" class="sr-only">จัดซื้อวัสดุและเช่าอุปกรณ์</h2>
                @if (canRequest()) {
                    @if (section() === 'purchase') {
                        <button pButton type="button" icon="pi pi-plus" label="ขอซื้อวัสดุ" (click)="purchaseFormOpen.set(true)"></button>
                    } @else {
                        <button pButton type="button" icon="pi pi-plus" label="ขอเช่า / ยืมอุปกรณ์" (click)="rentalFormOpen.set(true)"></button>
                    }
                }
            </div>

            @if (loadError()) {
                <div class="rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert"><i class="pi pi-exclamation-triangle mr-2"></i>{{ loadError() }}</div>
            }

            @if (section() === 'purchase') {
                <ul class="list-none p-0 m-0 flex flex-col gap-3">
                    @for (purchase of purchases(); track purchase.id) {
                        <li class="border border-surface rounded-lg p-4" [class.opacity-70]="purchase.status === 'cancelled' || purchase.status === 'rejected'">
                            <div class="flex flex-wrap items-start justify-between gap-3">
                                <div class="min-w-0 flex-1">
                                    <div class="flex flex-wrap items-center gap-2 mb-1">
                                        <span class="text-sm font-semibold text-muted-color">{{ purchase.id }}</span>
                                        <p-tag [value]="purchaseStatus[purchase.status].label" [severity]="purchaseStatus[purchase.status].severity" />
                                        @if (purchase.order) {
                                            <span class="text-xs px-2 py-0.5 rounded-full bg-emphasis">{{ purchase.order.poNumber }}</span>
                                        }
                                    </div>
                                    <div class="font-semibold">{{ purchase.title }}</div>
                                    <div class="text-xs text-muted-color mt-1">
                                        ต้องการใช้ {{ purchase.neededDate | thaiDate }}
                                        @if (phaseName(purchase.phaseCode); as phase) {
                                            · {{ phase }}
                                        }
                                        · ขอโดย {{ purchase.requestedBy.name }} {{ purchase.requestedAt | thaiDate }}
                                    </div>
                                    @if (purchase.order; as order) {
                                        <div class="text-xs mt-1">
                                            <i class="pi pi-truck mr-1 text-muted-color"></i>{{ order.supplier }} · สั่ง {{ order.orderDate | thaiDate }}
                                            @if (order.expectedDate) {
                                                · กำหนดส่ง {{ order.expectedDate | thaiDate }}
                                            }
                                        </div>
                                    } @else if (purchase.supplier) {
                                        <div class="text-xs text-muted-color mt-1">ร้านที่เสนอ: {{ purchase.supplier }}</div>
                                    }
                                    @if (purchase.cancelReason) {
                                        <div class="text-xs text-muted-color mt-1">ยกเลิก: {{ purchase.cancelReason }}</div>
                                    } @else if (purchase.decisionNote && purchase.status === 'rejected') {
                                        <div class="text-xs text-muted-color mt-1">เหตุผลที่ไม่อนุมัติ: {{ purchase.decisionNote }}</div>
                                    }
                                </div>
                                <div class="text-right">
                                    <div class="text-lg font-bold">฿{{ purchase.amount | number: '1.0-0' }}</div>
                                    <div class="text-xs text-muted-color">{{ purchase.items.length }} รายการ</div>
                                </div>
                            </div>

                            <details class="mt-3" [open]="purchase.status === 'ordered' || purchase.status === 'partial'">
                                <summary class="text-sm cursor-pointer text-muted-color">รายการวัสดุ{{ showReceived(purchase) ? ' และการรับของ' : '' }}</summary>
                                <div class="overflow-x-auto mt-2">
                                    <table class="w-full text-sm border-collapse" style="min-width: 32rem">
                                        <thead>
                                            <tr class="text-left text-muted-color border-b border-surface">
                                                <th class="py-1 pr-2 font-semibold">รายการ</th>
                                                <th class="py-1 pr-2 font-semibold text-right">จำนวน</th>
                                                <th class="py-1 pr-2 font-semibold text-right">ราคา/หน่วย</th>
                                                @if (showReceived(purchase)) {
                                                    <th class="py-1 font-semibold text-right">รับแล้ว</th>
                                                }
                                            </tr>
                                        </thead>
                                        <tbody>
                                            @for (item of purchase.items; track $index; let i = $index) {
                                                <tr class="border-b border-surface last:border-b-0">
                                                    <td class="py-1 pr-2">{{ item.name }}</td>
                                                    <td class="py-1 pr-2 text-right tabular-nums">{{ item.quantity | number: '1.0-2' }} {{ item.unit }}</td>
                                                    <td class="py-1 pr-2 text-right tabular-nums">{{ item.unitPrice | number: '1.0-2' }}</td>
                                                    @if (showReceived(purchase)) {
                                                        <td class="py-1 text-right tabular-nums" [ngClass]="receivedAt(purchase, i) >= item.quantity ? 'text-green-700 dark:text-green-400' : 'text-orange-700 dark:text-orange-300'">
                                                            {{ receivedAt(purchase, i) | number: '1.0-2' }} / {{ item.quantity | number: '1.0-2' }}
                                                        </td>
                                                    }
                                                </tr>
                                            }
                                        </tbody>
                                    </table>
                                </div>
                                @for (receipt of purchase.receipts; track $index; let n = $index) {
                                    <div class="text-xs mt-2 rounded-lg px-3 py-2 bg-emphasis">
                                        <span class="font-semibold">รับครั้งที่ {{ n + 1 }}</span> · {{ receipt.date | thaiDate }} · {{ receipt.receivedBy.name }}
                                        @if (receipt.note) {
                                            · {{ receipt.note }}
                                        }
                                        @for (file of receipt.files; track file.id) {
                                            <a [href]="file.url" target="_blank" rel="noopener" class="ml-2 text-primary"><i class="pi pi-paperclip text-[0.65rem] mr-1"></i>{{ file.name }}</a>
                                        }
                                    </div>
                                }
                            </details>

                            <div class="flex flex-wrap gap-2 mt-3">
                                @if (purchase.status === 'pending') {
                                    <a pButton routerLink="/approvals" [text]="true" size="small" icon="pi pi-inbox" label="ดูในศูนย์อนุมัติ"></a>
                                }
                                @if (canManage() && purchase.status === 'approved') {
                                    <button pButton type="button" size="small" icon="pi pi-shopping-cart" label="บันทึกการสั่งซื้อ" (click)="open({ kind: 'order', purchase })"></button>
                                }
                                @if (canManage() && (purchase.status === 'ordered' || purchase.status === 'partial')) {
                                    <button pButton type="button" size="small" icon="pi pi-box" label="รับของ" (click)="open({ kind: 'receive', purchase })"></button>
                                }
                                @if (canCancel(purchase) && ['pending', 'approved', 'ordered'].includes(purchase.status)) {
                                    <button pButton type="button" [text]="true" size="small" severity="danger" icon="pi pi-times" label="ยกเลิก" (click)="open({ kind: 'cancel-purchase', purchase })"></button>
                                }
                            </div>
                        </li>
                    } @empty {
                        <li class="text-center text-muted-color py-10">{{ purchasesResource.isLoading() ? 'กำลังโหลด...' : 'ยังไม่มีใบขอซื้อวัสดุ' }}</li>
                    }
                </ul>
            } @else {
                <ul class="list-none p-0 m-0 flex flex-col gap-3">
                    @for (rental of rentals(); track rental.id) {
                        <li class="border rounded-lg p-4" [ngClass]="rental.overdue ? 'border-red-300 dark:border-red-500/50' : 'border-surface'" [class.opacity-70]="rental.status === 'cancelled' || rental.status === 'rejected'">
                            <div class="flex flex-wrap items-start justify-between gap-3">
                                <div class="min-w-0 flex-1">
                                    <div class="flex flex-wrap items-center gap-2 mb-1">
                                        <span class="text-sm font-semibold text-muted-color">{{ rental.id }}</span>
                                        <p-tag [value]="rentalStatus[rental.status].label" [severity]="rentalStatus[rental.status].severity" />
                                        <span class="text-xs px-2 py-0.5 rounded-full bg-emphasis">{{ sourceLabel[rental.source] }}</span>
                                        @if (rental.overdue) {
                                            <span class="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200"><i class="pi pi-exclamation-circle text-xs mr-1"></i>เลยกำหนดคืน</span>
                                        }
                                    </div>
                                    <div class="font-semibold">{{ rental.equipment }} · {{ rental.quantity | number: '1.0-2' }} {{ rental.unit }}</div>
                                    <div class="text-xs text-muted-color mt-1">
                                        {{ rental.startDate | thaiDate }} – {{ rental.endDate | thaiDate }}
                                        @if (rental.vendor) {
                                            · {{ rental.vendor }}
                                        }
                                        @if (phaseName(rental.phaseCode); as phase) {
                                            · {{ phase }}
                                        }
                                        · ขอโดย {{ rental.requestedBy.name }}
                                    </div>
                                    @if (rental.deliveredAt) {
                                        <div class="text-xs mt-1">
                                            <i class="pi pi-sign-in mr-1 text-muted-color"></i>รับเข้าหน้างาน {{ rental.deliveredAt | thaiDate }}{{ rental.deliveredBy ? ' โดย ' + rental.deliveredBy.name : '' }}{{ rental.deliveryNote ? ' · ' + rental.deliveryNote : '' }}
                                            @if (rental.returnedAt) {
                                                · คืน {{ rental.returnedAt | thaiDate }}{{ rental.returnedBy ? ' โดย ' + rental.returnedBy.name : '' }} (สภาพ{{ conditionLabel[rental.returnCondition!] }}){{ rental.returnNote ? ' · ' + rental.returnNote : '' }}
                                            }
                                        </div>
                                    }
                                    @for (extension of rental.extensions ?? []; track extension.at) {
                                        <div class="text-xs text-muted-color mt-1"><i class="pi pi-calendar-plus mr-1"></i>ขยายกำหนดคืน {{ extension.from | thaiDate }} → {{ extension.to | thaiDate }}{{ extension.by ? ' โดย ' + extension.by.name : '' }}{{ extension.note ? ' · ' + extension.note : '' }}</div>
                                    }
                                    @if (rental.cancelReason) {
                                        <div class="text-xs text-muted-color mt-1">ยกเลิก: {{ rental.cancelReason }}</div>
                                    } @else if (rental.decisionNote && rental.status === 'rejected') {
                                        <div class="text-xs text-muted-color mt-1">เหตุผลที่ไม่อนุมัติ: {{ rental.decisionNote }}</div>
                                    }
                                </div>
                                @if (rental.source === 'rent') {
                                    <div class="text-right">
                                        <div class="text-xs text-muted-color">฿{{ rental.rate | number: '1.0-2' }}/{{ rateUnitLabel[rental.rateUnit!] }}</div>
                                        @if (rental.status === 'in-use' || rental.status === 'returned') {
                                            <div class="text-lg font-bold">฿{{ rental.cost | number: '1.0-0' }}</div>
                                            <div class="text-xs text-muted-color">{{ rental.status === 'in-use' ? 'ถึงวันนี้' : 'ค่าเช่าจริง' }} · แผน ฿{{ rental.estimatedCost | number: '1.0-0' }}</div>
                                        } @else {
                                            <div class="text-lg font-bold">฿{{ rental.estimatedCost | number: '1.0-0' }}</div>
                                            <div class="text-xs text-muted-color">ตามแผน</div>
                                        }
                                    </div>
                                }
                            </div>
                            <div class="flex flex-wrap gap-2 mt-3">
                                @if (rental.status === 'pending') {
                                    <a pButton routerLink="/approvals" [text]="true" size="small" icon="pi pi-inbox" label="ดูในศูนย์อนุมัติ"></a>
                                }
                                @if (canManage() && rental.status === 'approved') {
                                    <button pButton type="button" size="small" icon="pi pi-sign-in" label="รับเข้าหน้างาน" (click)="open({ kind: 'start', rental })"></button>
                                }
                                @if (canManage() && rental.status === 'in-use') {
                                    <button pButton type="button" size="small" icon="pi pi-sign-out" label="คืนอุปกรณ์" (click)="open({ kind: 'return', rental })"></button>
                                }
                                @if (canManage() && (rental.status === 'approved' || rental.status === 'in-use')) {
                                    <button pButton type="button" [outlined]="true" size="small" icon="pi pi-calendar-plus" label="ขยายเวลา" (click)="open({ kind: 'extend', rental })"></button>
                                }
                                @if (canCancel(rental) && (rental.status === 'pending' || rental.status === 'approved')) {
                                    <button pButton type="button" [text]="true" size="small" severity="danger" icon="pi pi-times" label="ยกเลิก" (click)="open({ kind: 'cancel-rental', rental })"></button>
                                }
                            </div>
                        </li>
                    } @empty {
                        <li class="text-center text-muted-color py-10">{{ rentalsResource.isLoading() ? 'กำลังโหลด...' : 'ยังไม่มีการเช่า/ยืมอุปกรณ์' }}</li>
                    }
                </ul>
            }
        </section>

        @if (purchaseFormOpen()) {
            <app-purchase-request-form [projectCode]="projectCode()" [phases]="phases()" (saved)="onCreated('ส่งใบขอซื้อ ' + $event.id + ' เข้าศูนย์อนุมัติแล้ว')" (closed)="purchaseFormOpen.set(false)" />
        }
        @if (rentalFormOpen()) {
            <app-rental-form [projectCode]="projectCode()" [phases]="phases()" (saved)="onCreated(($event.source === 'rent' ? 'ส่งขออนุมัติเช่า ' : 'บันทึกการยืม ') + $event.id + ' แล้ว')" (closed)="rentalFormOpen.set(false)" />
        }

        @if (action(); as current) {
            <p-dialog [visible]="true" (visibleChange)="!$event && !busy() && action.set(null)" [modal]="true" [draggable]="false" [closable]="!busy()" [style]="{ width: current.kind === 'receive' ? 'min(40rem, 96vw)' : 'min(30rem, 96vw)' }" [header]="actionTitle[current.kind]">
                @switch (current.kind) {
                    @case ('order') {
                        <p class="mt-0 text-sm">{{ current.purchase.id }} · {{ current.purchase.title }} · ฿{{ current.purchase.amount | number: '1.0-0' }}</p>
                        <div class="flex flex-col gap-3">
                            <label class="text-sm font-semibold">ร้านค้า <span class="text-red-600">*</span>
                                <input pInputText class="w-full mt-1 font-normal" maxlength="200" [ngModel]="form().supplier" (ngModelChange)="patch({ supplier: $event })" [attr.aria-invalid]="!!errors()['supplier']" />
                            </label>
                            <label class="text-sm font-semibold">เลขที่ใบสั่งซื้อ
                                <input pInputText class="w-full mt-1 font-normal" maxlength="50" placeholder="ไม่ระบุ = ระบบออกเลขให้" [ngModel]="form().poNumber" (ngModelChange)="patch({ poNumber: $event })" />
                            </label>
                            <div class="grid grid-cols-2 gap-3">
                                <label class="text-sm font-semibold">วันที่สั่งซื้อ <span class="text-red-600">*</span>
                                    <input pInputText type="date" class="w-full mt-1 font-normal" [max]="today" [ngModel]="form().date" (ngModelChange)="patch({ date: $event })" />
                                </label>
                                <label class="text-sm font-semibold">กำหนดส่งของ
                                    <input pInputText type="date" class="w-full mt-1 font-normal" [min]="form().date" [ngModel]="form().expectedDate" (ngModelChange)="patch({ expectedDate: $event })" />
                                </label>
                            </div>
                        </div>
                    }
                    @case ('receive') {
                        <p class="mt-0 text-sm">{{ current.purchase.order?.poNumber }} · {{ current.purchase.order?.supplier }}</p>
                        <label class="text-sm font-semibold block mb-3">วันที่รับของ <span class="text-red-600">*</span>
                            <input pInputText type="date" class="w-full mt-1 font-normal" [max]="today" [ngModel]="form().date" (ngModelChange)="patch({ date: $event })" />
                        </label>
                        <table class="w-full text-sm border-collapse">
                            <thead>
                                <tr class="text-left text-muted-color border-b border-surface">
                                    <th class="py-1 pr-2 font-semibold">รายการ</th>
                                    <th class="py-1 pr-2 font-semibold text-right">ค้างรับ</th>
                                    <th class="py-1 font-semibold text-right w-32">รับครั้งนี้</th>
                                </tr>
                            </thead>
                            <tbody>
                                @for (item of current.purchase.items; track $index; let i = $index) {
                                    <tr class="border-b border-surface">
                                        <td class="py-1 pr-2">{{ item.name }}</td>
                                        <td class="py-1 pr-2 text-right tabular-nums">{{ item.quantity - receivedAt(current.purchase, i) | number: '1.0-2' }} {{ item.unit }}</td>
                                        <td class="py-1 text-right">
                                            <input pInputText type="number" min="0" step="any" class="w-28 text-right" [attr.aria-label]="'จำนวนที่รับ ' + item.name" [value]="form().quantities[i]" (input)="setQuantity(i, +$any($event.target).value)" [attr.aria-invalid]="!!errors()['quantities.' + i]" />
                                            @if (errors()['quantities.' + i]; as message) {
                                                <small class="block text-red-600 dark:text-red-400">{{ message }}</small>
                                            }
                                        </td>
                                    </tr>
                                }
                            </tbody>
                        </table>
                        <label class="text-sm font-semibold block mt-3">หมายเหตุ
                            <textarea pTextarea rows="2" maxlength="1000" class="w-full mt-1 font-normal" placeholder="เช่น ของเสียหาย 2 ถุง ร้านจะส่งแทน" [ngModel]="form().note" (ngModelChange)="patch({ note: $event })"></textarea>
                        </label>
                        <div class="text-sm font-semibold mt-3 mb-1">ใบส่งของ / รูปของที่รับ</div>
                        <div class="flex flex-wrap gap-2 items-center">
                            @for (file of files(); track file.id) {
                                <span class="text-xs px-2 py-1 rounded-full bg-emphasis"><i class="pi pi-paperclip text-[0.65rem] mr-1"></i>{{ file.name }}
                                    <button type="button" class="bg-transparent border-0 p-0 ml-1 cursor-pointer text-muted-color" [attr.aria-label]="'นำออก ' + file.name" (click)="removeFile(file.id)"><i class="pi pi-times text-[0.6rem]"></i></button>
                                </span>
                            }
                            @if (uploading()) {
                                <span class="text-xs text-muted-color"><i class="pi pi-spin pi-spinner mr-1"></i>กำลังอัปโหลด</span>
                            }
                            <label class="text-xs px-2 py-1 rounded-full border border-dashed border-surface cursor-pointer hover:border-primary hover:text-primary">
                                <i class="pi pi-upload text-[0.65rem] mr-1"></i>แนบไฟล์
                                <input type="file" multiple class="sr-only" accept="image/jpeg,image/png,image/webp,.pdf" (change)="addFiles($event)" />
                            </label>
                        </div>
                    }
                    @case ('start') {
                        <p class="mt-0 text-sm">{{ current.rental.equipment }} {{ current.rental.quantity }} {{ current.rental.unit }} — เริ่มคิดค่าเช่าจากวันที่รับเข้าหน้างานจริง</p>
                        <label class="text-sm font-semibold block">วันที่รับเข้าหน้างาน <span class="text-red-600">*</span>
                            <input pInputText type="date" class="w-full mt-1 font-normal" [max]="today" [min]="current.rental.requestedAt.slice(0, 10)" [ngModel]="form().date" (ngModelChange)="patch({ date: $event })" [attr.aria-invalid]="!!errors()['date']" />
                        </label>
                        <label class="text-sm font-semibold block mt-3">หมายเหตุ
                            <input pInputText class="w-full mt-1 font-normal" maxlength="500" placeholder="เช่น ส่งมา 58 ชุด ร้านจะส่งเพิ่มพรุ่งนี้" [ngModel]="form().note" (ngModelChange)="patch({ note: $event })" [attr.aria-invalid]="!!errors()['note']" />
                        </label>
                    }
                    @case ('extend') {
                        <p class="mt-0 text-sm">{{ current.rental.equipment }} · กำหนดคืนเดิม {{ current.rental.endDate | thaiDate }}</p>
                        <label class="text-sm font-semibold block">กำหนดคืนใหม่ <span class="text-red-600">*</span>
                            <input pInputText type="date" class="w-full mt-1 font-normal" [min]="current.rental.endDate" [ngModel]="form().date" (ngModelChange)="patch({ date: $event })" [attr.aria-invalid]="!!errors()['endDate']" />
                        </label>
                        <label class="text-sm font-semibold block mt-3">เหตุผล
                            <input pInputText class="w-full mt-1 font-normal" maxlength="500" placeholder="เช่น งานเทพื้นเลื่อนเพราะฝนตก" [ngModel]="form().note" (ngModelChange)="patch({ note: $event })" />
                        </label>
                    }
                    @case ('return') {
                        <p class="mt-0 text-sm">{{ current.rental.equipment }} {{ current.rental.quantity }} {{ current.rental.unit }} · รับเข้า {{ current.rental.deliveredAt | thaiDate }}</p>
                        <label class="text-sm font-semibold block">วันที่คืน <span class="text-red-600">*</span>
                            <input pInputText type="date" class="w-full mt-1 font-normal" [max]="today" [min]="current.rental.deliveredAt" [ngModel]="form().date" (ngModelChange)="patch({ date: $event })" [attr.aria-invalid]="!!errors()['date']" />
                        </label>
                        <fieldset class="border-0 p-0 m-0 mt-3">
                            <legend class="text-sm font-semibold p-0 mb-1">สภาพตอนคืน</legend>
                            <div class="flex gap-4">
                                @for (option of conditions; track option.value) {
                                    <label class="flex items-center gap-2 cursor-pointer text-sm"><input type="radio" name="condition" class="accent-[var(--p-primary-color)]" [checked]="form().condition === option.value" (change)="patch({ condition: option.value })" />{{ option.label }}</label>
                                }
                            </div>
                        </fieldset>
                        <label class="text-sm font-semibold block mt-3">หมายเหตุ {{ form().condition !== 'good' ? '(จำเป็น)' : '' }}
                            <textarea pTextarea rows="2" maxlength="500" class="w-full mt-1 font-normal" [ngModel]="form().note" (ngModelChange)="patch({ note: $event })" [attr.aria-invalid]="!!errors()['note']"></textarea>
                        </label>
                    }
                    @default {
                        <p class="mt-0 text-sm">{{ cancelTarget(current) }}</p>
                        <label class="text-sm font-semibold block">เหตุผล <span class="text-red-600">*</span>
                            <textarea pTextarea rows="2" maxlength="500" class="w-full mt-1 font-normal" [ngModel]="form().note" (ngModelChange)="patch({ note: $event })" [attr.aria-invalid]="!!errors()['reason']"></textarea>
                        </label>
                    }
                }
                @if (fieldErrors().length) {
                    <ul class="mt-3 mb-0 pl-5 text-sm text-red-700 dark:text-red-300">
                        @for (message of fieldErrors(); track $index) {
                            <li>{{ message }}</li>
                        }
                    </ul>
                }
                @if (actionError()) {
                    <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ actionError() }}</div>
                }
                <ng-template #footer>
                    <button pButton type="button" label="ปิด" [text]="true" severity="secondary" [disabled]="busy()" (click)="action.set(null)"></button>
                    <button pButton type="button" icon="pi pi-check" [label]="actionTitle[current.kind]" [severity]="current.kind.startsWith('cancel') ? 'danger' : undefined" [loading]="busy()" [disabled]="uploading() > 0" (click)="confirm(current)"></button>
                </ng-template>
            </p-dialog>
        }
    `,
    styles: `
        .seg {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.4rem 0.9rem;
            border-radius: 999px;
            border: 0;
            background: transparent;
            color: var(--p-text-muted-color);
            font-size: 0.875rem;
            cursor: pointer;
        }
        .seg-active {
            background: var(--p-primary-color);
            color: var(--p-primary-contrast-color);
            font-weight: 600;
        }
    `
})
export class ProjectProcurementTab {
    private readonly service = inject(ProcurementService);
    private readonly auth = inject(AuthService);
    private readonly uploads = inject(FileUploadService);

    readonly projectCode = input.required<string>();
    readonly phases = input<TimelinePhase[]>([]);
    /** แจ้งหน้าโครงการ (แสดง toast) */
    readonly notify = output<string>();

    readonly purchaseStatus = PURCHASE_STATUS;
    readonly rentalStatus = RENTAL_STATUS;
    readonly sourceLabel = RENTAL_SOURCE_LABEL;
    readonly rateUnitLabel = RATE_UNIT_LABEL;
    readonly conditionLabel = RETURN_CONDITION_LABEL;
    readonly actionTitle = ACTION_TITLE;
    readonly today = todayLocal();
    readonly conditions = (Object.keys(RETURN_CONDITION_LABEL) as Array<keyof typeof RETURN_CONDITION_LABEL>).map((value) => ({ value, label: RETURN_CONDITION_LABEL[value] }));

    readonly section = signal<'purchase' | 'rental'>('purchase');
    readonly purchaseFormOpen = signal(false);
    readonly rentalFormOpen = signal(false);

    readonly purchasesResource = apiResource({ params: () => this.projectCode(), stream: ({ params: code }) => this.service.purchases(code), defaultValue: [] });
    readonly rentalsResource = apiResource({ params: () => this.projectCode(), stream: ({ params: code }) => this.service.rentals(code), defaultValue: [] });
    readonly purchases = this.purchasesResource.value;
    readonly rentals = this.rentalsResource.value;
    readonly loadError = computed(() => {
        const error = this.purchasesResource.error() ?? this.rentalsResource.error();
        return error ? problemMessage(error, 'โหลดข้อมูลจัดซื้อ/เช่าไม่สำเร็จ') : '';
    });

    /** ขอซื้อ/ขอเช่า: ทีมหน้างาน ผู้จัดการโครงการ ฝ่ายจัดซื้อ (หลังบ้านตรวจซ้ำ) */
    readonly canRequest = computed(() => this.auth.can('progress.update') || this.auth.can('project.manage') || this.auth.can('procurement.manage'));
    /** สั่งซื้อ รับของ รับ/คืนอุปกรณ์ */
    readonly canManage = computed(() => this.auth.can('procurement.manage'));

    readonly stats = computed(() => {
        const active = this.purchases().filter((p) => p.status !== 'rejected' && p.status !== 'cancelled');
        const ordered = active.filter((p) => ['ordered', 'partial', 'received'].includes(p.status));
        return {
            requested: active.reduce((sum, p) => sum + p.amount, 0),
            pendingCount: active.filter((p) => p.status === 'pending').length,
            ordered: ordered.reduce((sum, p) => sum + p.amount, 0),
            awaitingDelivery: active.filter((p) => p.status === 'ordered' || p.status === 'partial').length,
            rentCost: this.rentals().reduce((sum, r) => sum + r.cost, 0),
            inUse: this.rentals().filter((r) => r.status === 'in-use').length,
            overdue: this.rentals().filter((r) => r.overdue).length
        };
    });

    canCancel(record: PurchaseRequest | Rental) {
        return record.requestedBy.id === this.auth.currentUser()?.id || this.auth.can('procurement.manage') || this.auth.can('project.manage');
    }

    receivedAt(purchase: PurchaseRequest, index: number): number {
        return purchase.received.at(index) ?? 0;
    }

    showReceived(purchase: PurchaseRequest) {
        return ['ordered', 'partial', 'received'].includes(purchase.status);
    }

    phaseName(code: string | undefined) {
        const phase = code ? this.phases().find((item) => item.code === code) : undefined;
        return phase ? `ขั้นตอนที่ ${phase.step} ${phase.shortName}` : '';
    }

    onCreated(message: string) {
        this.purchaseFormOpen.set(false);
        this.rentalFormOpen.set(false);
        this.reload();
        this.notify.emit(message);
    }

    // ---------- หน้าต่างดำเนินการ (สั่งซื้อ รับของ ยกเลิก รับเข้า ขยายเวลา คืน) ----------
    readonly action = signal<Action | null>(null);
    readonly form = signal<{ supplier: string; poNumber: string; date: string; expectedDate: string; note: string; condition: 'good' | 'damaged' | 'lost'; quantities: number[] }>(this.emptyForm());
    readonly files = signal<UploadedFile[]>([]);
    readonly uploading = signal(0);
    readonly busy = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly actionError = signal('');
    /** ข้อผิดพลาดรายช่องจากหลังบ้าน (ช่องจำนวนรับของแสดงในตารางแล้ว) */
    readonly fieldErrors = computed(() => Object.entries(this.errors()).filter(([key]) => !key.startsWith('quantities.')).map(([, message]) => message));

    private emptyForm() {
        return { supplier: '', poNumber: '', date: todayLocal(), expectedDate: '', note: '', condition: 'good' as 'good' | 'damaged' | 'lost', quantities: [] as number[] };
    }

    open(action: Action) {
        const form = this.emptyForm();
        if (action.kind === 'order') form.supplier = action.purchase.supplier ?? '';
        if (action.kind === 'receive') form.quantities = action.purchase.items.map((item, i) => Math.max(0, item.quantity - this.receivedAt(action.purchase, i)));
        if (action.kind === 'extend') form.date = '';
        this.form.set(form);
        this.files.set([]);
        this.errors.set({});
        this.actionError.set('');
        this.action.set(action);
    }

    patch(change: Partial<ReturnType<typeof this.emptyForm>>) {
        this.form.update((form) => ({ ...form, ...change }));
    }

    setQuantity(index: number, value: number) {
        this.form.update((form) => ({ ...form, quantities: form.quantities.map((q, i) => (i === index ? value : q)) }));
    }

    addFiles(event: Event) {
        const element = event.target as HTMLInputElement;
        const selected = Array.from(element.files ?? []);
        element.value = '';
        for (const file of selected.slice(0, Math.max(0, 10 - this.files().length))) {
            this.uploading.update((n) => n + 1);
            this.uploads.upload(file).subscribe({
                next: (uploaded) => {
                    this.uploading.update((n) => n - 1);
                    this.files.update((list) => [...list, uploaded]);
                },
                error: (error) => {
                    this.uploading.update((n) => n - 1);
                    this.actionError.set(`${file.name}: ${problemMessage(error, 'อัปโหลดไม่สำเร็จ')}`);
                }
            });
        }
    }

    removeFile(id: string) {
        this.files.update((list) => list.filter((file) => file.id !== id));
    }

    cancelTarget(action: Action) {
        if (action.kind === 'cancel-purchase') return `${action.purchase.id} · ${action.purchase.title}${action.purchase.status === 'pending' ? ' — คำขอในศูนย์อนุมัติจะถูกปิดด้วย' : ''}`;
        if (action.kind === 'cancel-rental') return `${action.rental.id} · ${action.rental.equipment}${action.rental.status === 'pending' ? ' — คำขอในศูนย์อนุมัติจะถูกปิดด้วย' : ''}`;
        return '';
    }

    confirm(action: Action) {
        const code = this.projectCode();
        const form = this.form();
        const note = form.note.trim() || undefined;
        let request: Observable<unknown>;
        let message: string;
        switch (action.kind) {
            case 'order':
                request = this.service.order(code, action.purchase.id, { supplier: form.supplier.trim(), orderDate: form.date, ...(form.poNumber.trim() ? { poNumber: form.poNumber.trim() } : {}), ...(form.expectedDate ? { expectedDate: form.expectedDate } : {}) });
                message = `บันทึกการสั่งซื้อ ${action.purchase.id} แล้ว`;
                break;
            case 'receive':
                request = this.service.receive(code, action.purchase.id, { date: form.date, quantities: form.quantities, ...(note ? { note } : {}), fileIds: this.files().map((file) => file.id) });
                message = `บันทึกรับของ ${action.purchase.id} แล้ว`;
                break;
            case 'cancel-purchase':
                request = this.service.cancelPurchase(code, action.purchase.id, form.note.trim());
                message = `ยกเลิก ${action.purchase.id} แล้ว`;
                break;
            case 'start':
                request = this.service.startRental(code, action.rental.id, form.date, note);
                message = `รับ${action.rental.equipment}เข้าหน้างานแล้ว`;
                break;
            case 'extend':
                request = this.service.extendRental(code, action.rental.id, form.date, note);
                message = `ขยายกำหนดคืน${action.rental.equipment}แล้ว`;
                break;
            case 'return':
                request = this.service.returnRental(code, action.rental.id, { date: form.date, condition: form.condition, ...(note ? { note } : {}) });
                message = `บันทึกการคืน${action.rental.equipment}แล้ว`;
                break;
            case 'cancel-rental':
                request = this.service.cancelRental(code, action.rental.id, form.note.trim());
                message = `ยกเลิก ${action.rental.id} แล้ว`;
                break;
        }
        this.busy.set(true);
        this.errors.set({});
        this.actionError.set('');
        request.subscribe({
            next: () => {
                this.busy.set(false);
                this.action.set(null);
                this.reload();
                this.notify.emit(message);
            },
            error: (error) => {
                this.busy.set(false);
                const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                if (problem?.errors) this.errors.set(problem.errors);
                this.actionError.set(problemMessage(error, 'บันทึกไม่สำเร็จ'));
            }
        });
    }

    private reload() {
        this.purchasesResource.reload();
        this.rentalsResource.reload();
    }
}
