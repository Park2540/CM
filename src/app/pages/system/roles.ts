import { NgClass } from '@angular/common';
import { Component, inject } from '@angular/core';
import { AuthService } from '@/app/pages/service/auth.service';

@Component({
    selector: 'app-roles',
    standalone: true,
    imports: [NgClass],
    template: `
        <div class="mb-6">
            <h1 class="text-2xl font-bold m-0">บทบาทและสิทธิ์</h1>
            <p class="text-muted-color mt-1 mb-0">ขอบเขตการเข้าถึงของแต่ละบทบาท · ขณะนี้เปิดใช้บทบาทเจ้าของบริษัท บทบาทอื่นจะทยอยเปิดใช้</p>
        </div>

        @if (!catalog()) {
            <div class="card text-center text-muted-color py-10"><i class="pi pi-spin pi-spinner mr-2"></i>กำลังโหลดตารางบทบาท...</div>
        }
        @for (group of catalog()?.groups ?? []; track group.id; let i = $index) {
            <section class="card mb-6" [attr.aria-labelledby]="'group-' + group.id">
                <h2 [id]="'group-' + group.id" class="text-lg font-semibold m-0">กลุ่มที่ {{ i + 1 }}: {{ group.label }}</h2>
                <p class="text-sm text-muted-color mt-1 mb-4">{{ group.scope }}</p>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm border-collapse" style="min-width: 48rem">
                        <thead>
                            <tr class="border-b border-surface text-muted-color text-left">
                                <th class="py-2 pr-4 font-semibold w-56">บทบาท</th>
                                <th class="py-2 pr-4 font-semibold">เข้าถึงอะไร</th>
                                <th class="py-2 font-semibold w-80">ข้อจำกัดสำคัญ</th>
                            </tr>
                        </thead>
                        <tbody>
                            @for (role of rolesIn(group.id); track role.id) {
                                <tr class="border-b border-surface last:border-b-0 align-top" [ngClass]="role.id === currentRoleId ? 'bg-primary-50 dark:bg-primary-500/10' : ''">
                                    <td class="py-3 pr-4">
                                        <div class="font-semibold">{{ role.label }}</div>
                                        <div class="flex flex-wrap gap-1 mt-1">
                                            @if (role.id === currentRoleId) {
                                                <span class="px-1.5 py-0.5 rounded text-xs bg-primary text-primary-contrast">บทบาทของคุณ</span>
                                            }
                                            @if (role.suggested) {
                                                <span class="px-1.5 py-0.5 rounded text-xs bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300">ควรเพิ่ม</span>
                                            }
                                            @if (role.optional) {
                                                <span class="px-1.5 py-0.5 rounded text-xs bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300">ทางเลือก</span>
                                            }
                                        </div>
                                    </td>
                                    <td class="py-3 pr-4">{{ role.access }}</td>
                                    <td class="py-3">{{ role.restriction }}</td>
                                </tr>
                            }
                        </tbody>
                    </table>
                </div>
            </section>
        }
    `
})
export class Roles {
    private readonly auth = inject(AuthService);
    readonly catalog = this.auth.roleCatalog;
    get currentRoleId() {
        return this.auth.currentUser()?.roleId;
    }

    rolesIn(groupId: string) {
        return (this.catalog()?.roles ?? []).filter((role) => role.group === groupId);
    }
}
