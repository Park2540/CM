import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiSchemas, apiUrl } from '@/app/api/api';

export type ProjectModel = ApiSchemas['ProjectModel'];
export type ProjectModelInput = ApiSchemas['ProjectModelInput'];
export type ModelFormat = ApiSchemas['ModelFormat'];
export type ModelSourceApp = ApiSchemas['ModelSourceApp'];
export type UpAxis = ProjectModel['upAxis'];
export type ModelConversion = ApiSchemas['ModelConversion'];

/** กำลังรอ/กำลังแปลง .skp ที่หลังบ้าน */
export const isConverting = (model: ProjectModel) => model.conversion?.status === 'queued' || model.conversion?.status === 'converting';

/** ไฟล์ที่ตัวดู 3 มิติเปิดได้ */
export interface ModelFile {
    url: string;
    name: string;
    format: ModelFormat;
    upAxis: UpAxis;
    /** ข้อมูลชิ้นงาน (ไฟล์ที่แปลงจาก IFC) สำหรับคลิกดูคุณสมบัติ */
    elementsUrl?: string;
}

/** ข้อมูลชิ้นงาน 1 ชิ้นจากไฟล์ที่แปลงจาก IFC (ลำดับตรงกับ attribute _ELEMENT ของจุดในโมเดล) */
export interface ModelElement {
    id: number;
    guid: string;
    ifcClass: string;
    discipline: string;
    category: string;
    name: string;
    type: string;
    storey: string;
    system: string;
    properties: Array<[string, string, string]>;
}

export const VIEWABLE_MODEL_FORMATS: ModelFormat[] = ['glb', 'gltf', 'dae', 'fbx', 'obj'];
export const VIEWABLE_MODEL_ACCEPT = '.glb,.gltf,.dae,.fbx,.obj';
export const SOURCE_MODEL_ACCEPT = '.skp,.rvt,.ifc';
/** ปุ่มเลือกไฟล์เดียวรับได้ทุกชนิด แล้วระบบแยกเป็นไฟล์แสดงผล / ไฟล์ต้นฉบับเอง */
export const ALL_MODEL_ACCEPT = `${SOURCE_MODEL_ACCEPT},${VIEWABLE_MODEL_ACCEPT}`;
export const SOURCE_MODEL_EXTENSIONS = ['skp', 'rvt', 'ifc'];
/** ไฟล์ต้นฉบับที่หลังบ้านแปลงเป็น 3 มิติให้ (.rvt ยังแปลงไม่ได้ ต้องส่งออกเป็น .ifc) */
export const isConvertibleSource = (fileName: string) => /\.(skp|ifc)$/i.test(fileName);
export const MAX_MODEL_MB = 200;

export const SOURCE_APP: Record<ModelSourceApp, { label: string; sourceExtension?: string; exportHint: string[] }> = {
    sketchup: {
        label: 'SketchUp',
        sourceExtension: '.skp',
        exportHint: [
            'File > Export > 3D Model แล้วเลือก "GLTF Exporter (*.glb)" — แนะนำ ไฟล์เดียว เล็ก และแสดงสี/วัสดุครบ',
            'ถ้าไม่มีตัวเลือกนี้ ให้เลือก COLLADA (*.dae) หรือ FBX (*.fbx) แทน (ภาพวัสดุอาจไม่แสดง เห็นเป็นสีพื้น)',
            'ไม่ต้องเลือก .gltf หรือ .ifc — ระบบยังเปิดไม่ได้'
        ]
    },
    revit: {
        label: 'Revit',
        sourceExtension: '.rvt',
        exportHint: [
            'File > Export > IFC (แนะนำ) — เลือก IFC4 Reference View และเปิด "Export Revit property sets" ระบบแปลงเป็น 3D และแยกเปิด/ปิดตามงาน หมวด ชั้น ระบบ รวมเหล็กเสริม (3D Rebar) และงานระบบ (MEP) ให้',
            'ไฟล์ใหญ่มาก: ส่งออกแยกเป็นงานสถาปัตย์+โครงสร้าง / เหล็กเสริม / งานระบบ แล้วอัปโหลดเป็นเวอร์ชันแยกกัน',
            'แสดงผลอย่างเดียว (ไม่แยกงาน): เปิดมุมมอง 3D แล้ว File > Export > FBX (.fbx)'
        ]
    },
    other: {
        label: 'โปรแกรมอื่น',
        exportHint: ['ส่งออกเป็น .glb (แนะนำ) .gltf (ไฟล์เดียว) .dae .fbx หรือ .obj']
    }
};

export const FORMAT_LABEL: Record<ModelFormat, string> = { glb: 'glTF (.glb)', gltf: 'glTF (.gltf)', dae: 'COLLADA (.dae)', fbx: 'FBX', obj: 'OBJ' };

/** ชื่อไฟล์ → รูปแบบที่แสดงผลได้ (null = แสดงในเบราว์เซอร์ไม่ได้) */
export function modelFormatOf(fileName: string): ModelFormat | null {
    const extension = fileName.split('.').pop()?.toLowerCase() as ModelFormat;
    return VIEWABLE_MODEL_FORMATS.includes(extension) ? extension : null;
}

/** null = เวอร์ชันนี้มีเฉพาะไฟล์ต้นฉบับ (.skp / .rvt) ยังแสดงเป็น 3 มิติไม่ได้ */
export const toModelFile = (model: ProjectModel): ModelFile | null =>
    model.file && model.format ? { url: model.file.url, name: model.file.name, format: model.format, upAxis: model.upAxis, ...(model.elements ? { elementsUrl: model.elements.url } : {}) } : null;

/** แบบบ้าน 3 มิติของโครงการ (/projects/{code}/models) */
@Injectable({ providedIn: 'root' })
export class ProjectModelService {
    private readonly http = inject(HttpClient);

    list(code: string): Observable<ProjectModel[]> {
        return this.http.get<ProjectModel[]>(this.url(code));
    }

    create(code: string, input: ProjectModelInput): Observable<ProjectModel> {
        return this.http.post<ProjectModel>(this.url(code), input);
    }

    /** สั่งแปลง .skp เป็น 3 มิติใหม่ (หลังแปลงไม่สำเร็จ) */
    convert(code: string, id: string): Observable<ProjectModel> {
        return this.http.post<ProjectModel>(this.url(code, `/${encodeURIComponent(id)}/convert`), null);
    }

    remove(code: string, id: string): Observable<void> {
        return this.http.delete<void>(this.url(code, `/${encodeURIComponent(id)}`));
    }

    private url(code: string, suffix = '') {
        return apiUrl(`/projects/${encodeURIComponent(code)}/models${suffix}`);
    }
}
