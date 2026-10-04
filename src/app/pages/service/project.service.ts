import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiSchemas, apiUrl, queryParams } from '@/app/api/api';

export type Project = ApiSchemas['Project'];
export type ProjectStatus = ApiSchemas['ProjectStatus'];
export type ProjectInput = ApiSchemas['ProjectInput'];
export type ContractInput = ApiSchemas['ContractInput'];
export type ProjectRegion = ApiSchemas['ProjectRegion'];
export type ProjectGroup = ApiSchemas['ProjectGroup'];
export type ProjectPortfolio = ApiSchemas['ProjectPortfolio'];
export type WarrantyType = ApiSchemas['WarrantyType'];
export type WarrantyTerm = ApiSchemas['WarrantyTerm'];
export type WarrantyCoverage = ApiSchemas['WarrantyCoverage'];
export type SiteLocation = ApiSchemas['SiteLocation'];
export type DesignBrief = ApiSchemas['DesignBrief'];
export type SiteLocationInput = ApiSchemas['SiteLocationInput'];

/** ใกล้หมดประกัน: เหลือไม่เกินกี่วัน */
export const WARRANTY_EXPIRING_DAYS = 60;

/** ระยะประกันเป็นข้อความ เช่น 12 → "1 ปี", 18 → "18 เดือน" */
export function warrantyPeriod(months: number): string {
    return months % 12 === 0 ? `${months / 12} ปี` : `${months} เดือน`;
}

/** สถานะของการรับประกันแต่ละส่วน */
export function coverageState(coverage: WarrantyCoverage): 'expired' | 'expiring' | 'active' {
    if (!coverage.active) return 'expired';
    return coverage.daysLeft <= WARRANTY_EXPIRING_DAYS ? 'expiring' : 'active';
}

/** กลุ่มโครงการ (ตัวกรองในรายการโครงการและการ์ดใน Dashboard) */
export const PROJECT_GROUP_LABEL: Record<ProjectGroup, string> = {
    'in-hand': 'โครงการในมือ',
    'pending-contract': 'รอทำสัญญา',
    active: 'กำลังดำเนินการ',
    completed: 'เสร็จแล้ว',
    warranty: 'อยู่ในประกัน'
};

/** โครงการที่บันทึกสัญญาแล้ว — มีมูลค่า วันที่ และที่ตั้งหน้างานครบ จึงมีแผนงาน งวดงาน ภาพ เอกสาร */
export type ContractedProject = Project & { value: number; startDate: string; deliveryDate: string; location: string; contractSignedAt: string };

export function isContracted(project: Project | null | undefined): project is ContractedProject {
    return !!project && project.status !== 'pending-contract' && project.value !== null && !!project.startDate && !!project.deliveryDate;
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
    'pending-contract': 'รอเซ็นสัญญา',
    planning: 'รอดำเนินการ',
    'in-progress': 'กำลังดำเนินการ',
    'near-handover': 'ใกล้ส่งมอบ',
    completed: 'เสร็จสิ้น',
    delayed: 'ล่าช้า'
};

export function getProjectSeverity(status: ProjectStatus) {
    switch (status) {
        case 'pending-contract':
            return 'secondary';
        case 'completed':
            return 'success';
        case 'delayed':
            return 'danger';
        case 'planning':
            return 'warn';
        default:
            return 'info';
    }
}

/** โครงการ — เรียก API ตามสัญญา (/projects) */
@Injectable({ providedIn: 'root' })
export class ProjectService {
    private readonly http = inject(HttpClient);

    list(query: { status?: ProjectStatus | null; group?: ProjectGroup | null; q?: string } = {}): Observable<Project[]> {
        return this.http.get<Project[]>(apiUrl('/projects'), { params: queryParams(query) });
    }

    get(code: string): Observable<Project> {
        return this.http.get<Project>(apiUrl(`/projects/${encodeURIComponent(code)}`));
    }

    /** เปิดโครงการ (ข้อมูลเบื้องต้น) — สถานะเริ่มต้น "รอเซ็นสัญญา" */
    create(input: ProjectInput): Observable<Project> {
        return this.http.post<Project>(apiUrl('/projects'), input);
    }

    /** บันทึกสัญญา — แผนงานและงวดงานสร้างหลังตั้งค่างานก่อสร้าง */
    recordContract(code: string, input: ContractInput): Observable<Project> {
        return this.http.post<Project>(apiUrl(`/projects/${encodeURIComponent(code)}/contract`), input);
    }

    /** ปักหมุดพิกัดหน้างาน */
    setSiteLocation(code: string, input: SiteLocationInput): Observable<Project> {
        return this.http.put<Project>(apiUrl(`/projects/${encodeURIComponent(code)}/site-location`), input);
    }

    /** ลบหมุด (แผนที่กลับไปค้นหาจากที่ตั้งหน้างาน) */
    clearSiteLocation(code: string): Observable<Project> {
        return this.http.delete<Project>(apiUrl(`/projects/${encodeURIComponent(code)}/site-location`));
    }

    /** จำนวนโครงการตามกลุ่มสำหรับ Dashboard */
    portfolio(): Observable<ProjectPortfolio> {
        return this.http.get<ProjectPortfolio>(apiUrl('/dashboard/projects'));
    }

    regions(): Observable<ProjectRegion[]> {
        return this.http.get<ProjectRegion[]>(apiUrl('/settings/project-regions'));
    }
}

/** พิกัดจากข้อความ: "lat, lng" หรือลิงก์ Google Maps (…/@lat,lng,… · ?q=lat,lng · !3dlat!4dlng) */
export function parseCoordinates(text: string): SiteLocationInput | null {
    let value = text.trim();
    try {
        value = decodeURIComponent(value);
    } catch {
        // ข้อความมี % ที่ไม่ใช่ URL encoding — ใช้ตามที่พิมพ์
    }
    const number = String.raw`(-?\d+(?:\.\d+)?)`;
    const patterns = [
        new RegExp(`!3d${number}!4d${number}`),
        new RegExp(`@${number},\\s*${number}`),
        new RegExp(`[?&](?:q|query|destination|ll)=${number},\\s*${number}`),
        new RegExp(`^${number}\\s*[,\\s]\\s*${number}$`)
    ];
    for (const pattern of patterns) {
        const match = value.match(pattern);
        if (!match) continue;
        const lat = Number(match[1]);
        const lng = Number(match[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
    return null;
}

/** ปลายทางสำหรับ Google Maps: พิกัดที่ปักหมุด หรือที่ตั้งหน้างาน (ตัดหมายเหตุในวงเล็บออก) */
export function mapDestination(project: Pick<Project, 'location' | 'siteCoordinates'>): string | null {
    if (project.siteCoordinates) return `${project.siteCoordinates.lat},${project.siteCoordinates.lng}`;
    const address = project.location?.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    return address || null;
}

/** ลิงก์นำทาง Google Maps (มือถือเปิดแอป Google Maps) */
export const directionsUrl = (destination: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
/** ลิงก์เปิดตำแหน่งใน Google Maps */
export const mapSearchUrl = (destination: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;
/** แผนที่ฝังในหน้า (ไม่ต้องใช้ API key) */
export const mapEmbedUrl = (destination: string, zoom: number) => `https://maps.google.com/maps?q=${encodeURIComponent(destination)}&z=${zoom}&hl=th&output=embed`;
