import { DecimalPipe, NgClass } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { problemMessage } from '@/app/api/api';
import { apiResource } from '@/app/api/api-resource';
import { ProcurementService } from '@/app/pages/service/procurement.service';
import { ThaiDatePipe } from '@/app/pages/projects/thai-date.pipe';

/** คลังหลักของบริษัท: ของเหลือจากหน้างาน และการเบิกไปใช้ที่โครงการอื่น */
@Component({
    selector: 'app-warehouse',
    standalone: true,
    imports: [DecimalPipe, FormsModule, InputTextModule, NgClass, RouterLink, ThaiDatePipe],
    template: `
        <div class="grid grid-cols-12 gap-6">
            <section class="card m-0 col-span-12 xl:col-span-7" aria-labelledby="stock-heading">
                <h1 id="stock-heading" class="text-2xl font-bold m-0">คลังหลัก</h1>
                <p class="text-sm text-muted-color mt-1 mb-4">ของเหลือที่ส่งกลับจากหน้างาน พร้อมเบิกไปใช้ที่โครงการอื่น (เบิกได้ที่แท็บจัดซื้อ/เช่า → วัสดุเทียบ BOQ ของโครงการ)</p>
                <input pInputText type="search" class="w-full mb-3" placeholder="ค้นหาวัสดุ" aria-label="ค้นหาวัสดุในคลัง" [ngModel]="query()" (ngModelChange)="query.set($event)" />
                @if (error()) {
                    <div class="rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ error() }}</div>
                }
                <table class="w-full text-sm border-collapse">
                    <thead>
                        <tr class="text-left text-muted-color border-b border-surface">
                            <th class="py-2 pr-2 font-semibold">วัสดุ</th>
                            <th class="py-2 pr-2 font-semibold">หมวด</th>
                            <th class="py-2 pr-2 font-semibold text-right">คงเหลือ</th>
                            <th class="py-2 font-semibold text-right">เคลื่อนไหวล่าสุด</th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (item of stock(); track item.key) {
                            <tr class="border-b border-surface">
                                <td class="py-2 pr-2">
                                    <div class="font-semibold">{{ item.name }}</div>
                                    <div class="text-xs text-muted-color">{{ item.materialCode ?? 'ไม่อยู่ในรายการวัสดุ' }}</div>
                                </td>
                                <td class="py-2 pr-2">{{ item.category ?? '-' }}</td>
                                <td class="py-2 pr-2 text-right tabular-nums font-semibold whitespace-nowrap">{{ item.quantity | number: '1.0-2' }} {{ item.unit }}</td>
                                <td class="py-2 text-right text-muted-color">{{ item.lastMovementAt | thaiDate }}</td>
                            </tr>
                        } @empty {
                            <tr>
                                <td colspan="4" class="text-center text-muted-color py-8">{{ stockResource.isLoading() ? 'กำลังโหลด...' : 'ยังไม่มีของในคลังหลัก' }}</td>
                            </tr>
                        }
                    </tbody>
                </table>
            </section>

            <section class="card m-0 col-span-12 xl:col-span-5" aria-labelledby="movement-heading">
                <h2 id="movement-heading" class="text-lg font-semibold m-0 mb-4">ประวัติรับเข้า/เบิกออก</h2>
                <ul class="list-none p-0 m-0 flex flex-col gap-2 text-sm">
                    @for (movement of movementsResource.value(); track movement.id) {
                        <li class="rounded-lg px-3 py-2 bg-emphasis">
                            <div class="flex justify-between gap-2">
                                <span [ngClass]="movement.type === 'return' ? 'text-green-700 dark:text-green-400' : 'text-blue-700 dark:text-blue-300'"><i class="pi mr-1" [ngClass]="movement.type === 'return' ? 'pi-arrow-down' : 'pi-arrow-up'"></i>{{ movement.type === 'return' ? 'รับเข้าจาก' : 'เบิกไป' }} <a [routerLink]="['/projects', movement.projectCode]" [queryParams]="{ tab: 'procurement' }" class="text-primary">{{ movement.projectCode }}</a></span>
                                <span class="text-xs text-muted-color">{{ movement.date | thaiDate }}</span>
                            </div>
                            <div class="font-semibold">{{ movement.name }} {{ movement.type === 'return' ? '+' : '−' }}{{ movement.quantity | number: '1.0-2' }} {{ movement.unit }}</div>
                            <div class="text-xs text-muted-color">{{ movement.recordedBy.name }}{{ movement.note ? ' · ' + movement.note : '' }}</div>
                        </li>
                    } @empty {
                        <li class="text-muted-color">{{ movementsResource.isLoading() ? 'กำลังโหลด...' : 'ยังไม่มีการเคลื่อนไหว' }}</li>
                    }
                </ul>
            </section>
        </div>
    `
})
export class Warehouse {
    private readonly service = inject(ProcurementService);

    readonly stockResource = apiResource({ stream: () => this.service.warehouseStock(), defaultValue: [] });
    readonly movementsResource = apiResource({ stream: () => this.service.warehouseMovements(), defaultValue: [] });
    readonly query = signal('');
    readonly stock = computed(() => {
        const query = this.query().trim().toLowerCase();
        return this.stockResource.value().filter((item) => !query || item.name.toLowerCase().includes(query) || (item.materialCode ?? '').toLowerCase().includes(query));
    });
    readonly error = computed(() => {
        const error = this.stockResource.error() ?? this.movementsResource.error();
        return error ? problemMessage(error, 'โหลดข้อมูลคลังไม่สำเร็จ') : '';
    });
}
