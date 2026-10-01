import { Injectable } from '@angular/core';

export interface Project {
    code: string;
    name: string;
    location: string;
    housePlanCode: string;
    customerName: string;
    phone: string;
    responsibleName: string;
    value: number;
    startDate: string;
    deliveryDate: string;
    progress: number;
    status: string;
}

export function getProjectSeverity(status: string) {
    switch (status) {
        case 'เสร็จสิ้น':
            return 'success';
        case 'ล่าช้า':
            return 'danger';
        case 'รอดำเนินการ':
            return 'warn';
        default:
            return 'info';
    }
}

@Injectable({ providedIn: 'root' })
export class ProjectService {
    readonly projects: Project[] = [
        {
            code: 'CR690001',
            housePlanCode: 'ARUN',
            name: 'ก่อสร้างบ้านพักอาศัย 2 ชั้น คุณณัฐวุฒิ ใจดี',
            location: 'อ.เมือง จ.เชียงราย (ข้อมูลตัวอย่าง)',
            customerName: 'ณัฐวุฒิ ใจดี',
            phone: '081-234-5678',
            responsibleName: 'ธนกฤต ศรีวงศ์',
            value: 3850000,
            startDate: '2026-01-15',
            deliveryDate: '2026-10-30',
            progress: 72,
            status: 'กำลังดำเนินการ'
        },
        {
            code: 'CR690002',
            housePlanCode: 'RAWEE',
            name: 'ก่อสร้างบ้านพักอาศัย 2 ชั้น คุณสุภาวดี แสงทอง',
            location: 'อ.แม่จัน จ.เชียงราย (ข้อมูลตัวอย่าง)',
            customerName: 'สุภาวดี แสงทอง',
            phone: '089-123-4567',
            responsibleName: 'พิมพ์ชนก วัฒนกุล',
            value: 2475000,
            startDate: '2026-02-01',
            deliveryDate: '2026-11-15',
            progress: 48,
            status: 'กำลังดำเนินการ'
        },
        {
            code: 'BKK690001',
            housePlanCode: 'ARUN',
            name: 'ก่อสร้างบ้านพักอาศัย 2 ชั้น คุณกิตติพงษ์ วัฒนชัย',
            location: 'เขตบางกะปิ กรุงเทพฯ (ข้อมูลตัวอย่าง)',
            customerName: 'กิตติพงษ์ วัฒนชัย',
            phone: '086-555-0192',
            responsibleName: 'ณัฐพล ภูมิรักษ์',
            value: 5200000,
            startDate: '2026-01-05',
            deliveryDate: '2026-09-30',
            progress: 91,
            status: 'ใกล้ส่งมอบ'
        },
        {
            code: 'CNX690001',
            housePlanCode: 'RAWEE',
            name: 'ก่อสร้างบ้านพักอาศัย 2 ชั้น คุณพิมพ์ชนก ธรรมรักษ์',
            location: 'อ.สันทราย จ.เชียงใหม่ (ข้อมูลตัวอย่าง)',
            customerName: 'พิมพ์ชนก ธรรมรักษ์',
            phone: '095-765-4321',
            responsibleName: 'วรัญญา อินทร์แก้ว',
            value: 3180000,
            startDate: '2026-03-10',
            deliveryDate: '2026-12-20',
            progress: 35,
            status: 'รอดำเนินการ'
        },
        {
            code: 'PKT690001',
            housePlanCode: 'ARUN',
            name: 'ก่อสร้างบ้านพักอาศัย 2 ชั้น คุณธนกร พูลสวัสดิ์',
            location: 'อ.ถลาง จ.ภูเก็ต (ข้อมูลตัวอย่าง)',
            customerName: 'ธนกร พูลสวัสดิ์',
            phone: '082-456-7890',
            responsibleName: 'ศุภชัย จันทร์เพ็ญ',
            value: 4600000,
            startDate: '2026-01-20',
            deliveryDate: '2026-08-31',
            progress: 100,
            status: 'เสร็จสิ้น'
        }
    ];

    getProject(code: string): Project | undefined {
        return this.projects.find((project) => project.code === code);
    }
}
