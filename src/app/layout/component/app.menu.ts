import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MenuItem } from 'primeng/api';
import { AppMenuitem } from './app.menuitem';

@Component({
    selector: 'app-menu',
    standalone: true,
    imports: [CommonModule, AppMenuitem, RouterModule],
    template: `<ul class="layout-menu">
        @for (item of model; track item.label) {
            @if (!item.separator) {
                <li app-menuitem [item]="item" [root]="true"></li>
            } @else {
                <li class="menu-separator"></li>
            }
        }
    </ul> `
})
export class AppMenu {
    model: (MenuItem & { sectionOnly?: boolean })[] = [];

    ngOnInit() {
        this.model = [
            {
                label: 'หลัก',
                items: [
                    { label: 'Dashboard', icon: 'pi pi-fw pi-home', routerLink: ['/dashboard'] },
                    { label: 'ศูนย์อนุมัติ', icon: 'pi pi-fw pi-check-square', routerLink: ['/approvals'] },
                    { label: 'งานของฉัน', icon: 'pi pi-fw pi-briefcase' },
                    {
                        label: 'ระบบแจ้งเตือน',
                        icon: 'pi pi-fw pi-bell',
                        path: '/notifications',
                        items: [
                            { label: 'ทั้งหมด', icon: 'pi pi-fw pi-inbox' },
                            { label: 'รออนุมัติ', icon: 'pi pi-fw pi-clock', routerLink: ['/approvals'] },
                            { label: 'ใกล้ครบกำหนด', icon: 'pi pi-fw pi-calendar' },
                            { label: 'ล่าช้า', icon: 'pi pi-fw pi-exclamation-triangle' }
                        ]
                    }
                ]
            },
            {
                label: 'โครงการ',
                items: [
                    {
                        label: 'ภาพรวมโครงการ',
                        icon: 'pi pi-fw pi-folder',
                        path: '/projects',
                        items: [
                            { label: 'โครงการรวม', icon: 'pi pi-fw pi-list', routerLink: ['/projects'] },
                            { label: 'เปิดโครงการ', icon: 'pi pi-fw pi-plus-circle', routerLink: ['/projects/new'] },
                            { label: 'การเงินรวม', icon: 'pi pi-fw pi-wallet' },
                            { label: 'โครงการที่ต้องติดตาม', icon: 'pi pi-fw pi-exclamation-circle' },
                            { label: 'โครงการที่ปิดแล้ว', icon: 'pi pi-fw pi-check-circle' }
                        ]
                    },
                    { label: 'คุณภาพและความปลอดภัย', icon: 'pi pi-fw pi-shield' }
                ]
            },
            {
                label: 'ออกแบบและประมาณราคา',
                items: [{ label: 'ถอดปริมาณและ BOQ', icon: 'pi pi-fw pi-calculator', routerLink: ['/estimates'] }]
            },
            {
                label: 'การเงินและจัดซื้อ',
                items: [
                    {
                        label: 'ระบบบัญชีและการเงิน',
                        icon: 'pi pi-fw pi-wallet',
                        path: '/finance',
                        items: [
                            { label: 'ลูกหนี้', icon: 'pi pi-fw pi-arrow-down-left' },
                            { label: 'เจ้าหนี้', icon: 'pi pi-fw pi-arrow-up-right' },
                            { label: 'เงินประกัน', icon: 'pi pi-fw pi-lock' },
                            { label: 'กระแสเงินสด', icon: 'pi pi-fw pi-chart-line' },
                            { label: 'เงินสดย่อย', icon: 'pi pi-fw pi-money-bill' },
                            { label: 'ภาษี', icon: 'pi pi-fw pi-file' },
                            { label: 'ค่าใช้จ่ายส่วนกลาง', icon: 'pi pi-fw pi-building' }
                        ]
                    },
                    {
                        label: 'ระบบจัดซื้อ',
                        icon: 'pi pi-fw pi-shopping-cart',
                        path: '/procurement',
                        items: [
                            { label: 'ใบขอซื้อ', icon: 'pi pi-fw pi-file-edit' },
                            { label: 'ขอราคา/เปรียบเทียบ', icon: 'pi pi-fw pi-tags' },
                            { label: 'ใบสั่งซื้อ', icon: 'pi pi-fw pi-shopping-cart' },
                            { label: 'สัญญาและงวดผู้รับเหมาช่วง', icon: 'pi pi-fw pi-briefcase' },
                            { label: 'รับสินค้า/รับงาน', icon: 'pi pi-fw pi-inbox' }
                        ]
                    }
                ]
            },
            {
                label: 'วัสดุและทรัพย์สิน',
                items: [
                    {
                        label: 'วัสดุและคลัง',
                        icon: 'pi pi-fw pi-box',
                        path: '/inventory',
                        items: [
                            { label: 'รายการวัสดุ', icon: 'pi pi-fw pi-th-large', routerLink: ['/inventory/materials'] },
                            { label: 'คลังหลัก', icon: 'pi pi-fw pi-warehouse', routerLink: ['/inventory/warehouse'] },
                            { label: 'เบิก', icon: 'pi pi-fw pi-sign-out' },
                            { label: 'คืน', icon: 'pi pi-fw pi-replay' },
                            { label: 'โอน', icon: 'pi pi-fw pi-arrow-right-arrow-left' },
                            { label: 'ตรวจนับ', icon: 'pi pi-fw pi-list-check' }
                        ]
                    },
                    {
                        label: 'ทรัพย์สิน/ครุภัณฑ์',
                        icon: 'pi pi-fw pi-wrench',
                        path: '/assets',
                        items: [
                            { label: 'ทะเบียน', icon: 'pi pi-fw pi-book' },
                            { label: 'เบิก-ยืม', icon: 'pi pi-fw pi-sign-out' },
                            { label: 'ซ่อมบำรุง', icon: 'pi pi-fw pi-cog' },
                            { label: 'ตัดจำหน่าย', icon: 'pi pi-fw pi-trash' }
                        ]
                    }
                ]
            },
            {
                label: 'หลังส่งมอบ',
                items: [
                    {
                        label: 'ระบบรับประกัน',
                        icon: 'pi pi-fw pi-verified',
                        path: '/warranty',
                        items: [
                            { label: 'โครงการที่รับประกัน', icon: 'pi pi-fw pi-shield', routerLink: ['/warranty'] },
                            { label: 'รายการแจ้งซ่อม', icon: 'pi pi-fw pi-wrench' }
                        ]
                    }
                ]
            },
            {
                label: 'เอกสาร',
                items: [
                    {
                        label: 'ศูนย์เอกสารบริษัท (พร้อมแจ้งเตือนหมดอายุ)',
                        icon: 'pi pi-fw pi-folder-open'
                    },
                    {
                        label: 'แม่แบบเอกสาร',
                        icon: 'pi pi-fw pi-copy'
                    }
                ]
            },
            {
                label: 'ข้อมูลหลัก',
                items: [
                    {
                        label: 'บุคคลากร',
                        icon: 'pi pi-fw pi-users',
                        path: '/master/personnel',
                        items: [
                            { label: 'ข้อมูลบุคคลากรรวม', icon: 'pi pi-fw pi-list', routerLink: ['/master/personnel'] },
                            { label: 'เพิ่มบุคคลากร', icon: 'pi pi-fw pi-user-plus', routerLink: ['/master/personnel/new'] }
                        ]
                    },
                    {
                        label: 'ลูกค้า',
                        icon: 'pi pi-fw pi-user',
                        path: '/master/customers',
                        items: [
                            { label: 'ข้อมูลลูกค้ารวม', icon: 'pi pi-fw pi-list' },
                            { label: 'เพิ่มลูกค้า', icon: 'pi pi-fw pi-user-plus' }
                        ]
                    },
                    {
                        label: 'ผู้รับเหมาช่วง',
                        icon: 'pi pi-fw pi-briefcase',
                        path: '/master/subcontractors',
                        items: [
                            { label: 'ข้อมูลผู้รับเหมาช่วง', icon: 'pi pi-fw pi-list', routerLink: ['/master/subcontractors'] },
                            { label: 'เพิ่มผู้รับเหมาช่วง', icon: 'pi pi-fw pi-plus', routerLink: ['/master/subcontractors'], queryParams: { new: 1 } }
                        ]
                    },
                    {
                        label: 'ซัพพลายเออร์',
                        icon: 'pi pi-fw pi-truck',
                        path: '/master/suppliers',
                        items: [
                            { label: 'ข้อมูลซัพพลายเออร์', icon: 'pi pi-fw pi-list' },
                            { label: 'เพิ่มซัพพลายเออร์', icon: 'pi pi-fw pi-plus' }
                        ]
                    },
                    { label: 'รายการวัสดุ/ราคามาตรฐาน', icon: 'pi pi-fw pi-database' }
                ]
            },
            { label: 'รายงานและวิเคราะห์', sectionOnly: true },
            {
                label: 'ระบบ',
                items: [
                    { label: 'ผู้ใช้งาน', icon: 'pi pi-fw pi-users', routerLink: ['/system/users'] },
                    { label: 'บทบาทและสิทธิ์', icon: 'pi pi-fw pi-key', routerLink: ['/system/roles'] },
                    { label: 'ตั้งค่าโครงการ', icon: 'pi pi-fw pi-sliders-h' },
                    { label: 'ตั้งค่าระบบ', icon: 'pi pi-fw pi-cog' },
                    { label: 'ตั้งค่าการอนุมัติ', icon: 'pi pi-fw pi-check-square' },
                    { label: 'ตั้งค่าบริษัท', icon: 'pi pi-fw pi-building' },
                    { label: 'Audit Log', icon: 'pi pi-fw pi-history', routerLink: ['/system/audit-log'] }
                ]
            }
        ];
    }
}
