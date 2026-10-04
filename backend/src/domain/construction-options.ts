import type { ApiSchemas } from '../api/api.js';
import { CONSTRUCTION_PLAN_TEMPLATE, SetupOptions } from './construction-plan.template.js';
import { HOUSE_PLANS } from './house-plans.js';

type OptionGroup = ApiSchemas['ConstructionOptionGroup'];
type Options = ApiSchemas['ConstructionSetupOptions'];

/**
 * ตัวเลือกในหน้า "ตั้งค่างานก่อสร้าง" เรียงตามลำดับงาน ตั้งแต่สำรวจจนส่งมอบ
 * งานที่แต่ละตัวเลือกเพิ่ม/เปลี่ยนอยู่ที่ `when` ในแม่แบบแผนงาน
 * เพิ่มตัวเลือกใหม่: เพิ่มที่นี่ + ใส่ `when` ให้งานในแม่แบบ (หน้าบ้านสร้างฟอร์มจากรายการนี้เอง)
 */
const OPTION_DEFINITIONS: Omit<OptionGroup, 'affectsPhases'>[] = [
    {
        key: 'buildingType',
        section: 'ข้อมูลอาคาร',
        label: 'ประเภทอาคาร',
        type: 'single',
        default: 'residential',
        choices: [
            { value: 'residential', label: 'บ้านพักอาศัย' },
            { value: 'commercial', label: 'อาคารพาณิชย์', description: 'เพิ่มงานหน้าร้าน ป้าย และตรวจตามกฎหมายอาคารพาณิชย์' }
        ]
    },
    {
        key: 'floors',
        section: 'ข้อมูลอาคาร',
        label: 'จำนวนชั้น',
        type: 'single',
        default: '2',
        description: 'บ้านพักอาศัยไม่เกิน 3 ชั้น · อาคารพาณิชย์ไม่เกิน 8 ชั้น',
        // ชั้น 2 ขึ้นไป: งาน "ชั้น 2" ในแม่แบบถูกสร้างซ้ำทีละชั้น (timeline-generator)
        choices: [
            { value: '1', label: '1 ชั้น' },
            { value: '2', label: '2 ชั้น', description: 'เพิ่มงานโครงสร้าง ผนัง ฝ้า พื้น และงานระบบของชั้น 2' },
            { value: '3', label: '3 ชั้น', description: 'เพิ่มงานโครงสร้าง ผนัง ฝ้า พื้น และงานระบบของชั้น 2–3' },
            ...[4, 5, 6, 7, 8].map((floors) => ({
                value: String(floors),
                label: `${floors} ชั้น`,
                description: `งานชั้นบน ชั้น 2–${floors} · เฉพาะอาคารพาณิชย์`,
                visibleWhen: { key: 'buildingType', values: ['commercial'] }
            }))
        ]
    },
    {
        key: 'designScope',
        section: 'งานสำรวจและออกแบบ',
        label: 'ขอบเขตงานออกแบบ',
        type: 'single',
        default: 'custom',
        choices: [
            { value: 'catalog', label: 'ปรับจากแบบมาตรฐานของบริษัท', description: 'ข้ามขั้นออกแบบแนวคิด ปรับแบบตามความต้องการแล้วให้ลูกค้ายืนยัน' },
            { value: 'custom', label: 'ออกแบบใหม่ทั้งหมด', description: 'ออกแบบแนวคิด ทัศนียภาพ 3 มิติ และเขียนแบบครบทุกขั้น' }
        ]
    },
    {
        key: 'soilTest',
        section: 'งานสำรวจและออกแบบ',
        label: 'เจาะสำรวจดิน (Soil Boring)',
        description: 'ไม่เจาะได้เมื่อมีข้อมูลดินบริเวณใกล้เคียงและวิศวกรรับรอง',
        type: 'boolean',
        default: true,
        choices: []
    },
    {
        key: 'siteWork',
        section: 'งานเตรียมพื้นที่',
        label: 'งานเตรียมพื้นที่',
        type: 'multiple',
        default: ['landFill'],
        choices: [
            { value: 'landFill', label: 'ถมดินและปรับระดับ' },
            { value: 'demolition', label: 'รื้อถอนอาคารเดิม', description: 'สำรวจและรื้อถอนสิ่งปลูกสร้างเดิมก่อนเริ่มงาน' },
            { value: 'retainingWall', label: 'กำแพงกันดิน' },
            { value: 'basement', label: 'ห้องใต้ดิน', description: 'ผนังกันดิน ขุดดิน ผนัง/พื้น คสล. กันซึมและทดสอบรั่วซึม' }
        ]
    },
    {
        key: 'foundation',
        section: 'งานฐานราก',
        label: 'ประเภทฐานราก',
        description: 'ให้วิศวกรเลือกตามผลเจาะสำรวจดิน',
        type: 'single',
        default: 'bored',
        choices: [
            { value: 'spread', label: 'ฐานรากแผ่ (ไม่ใช้เสาเข็ม)', description: 'ขุดและบดอัดดิน ทดสอบความแน่นของดินก่อนทำฐานราก' },
            { value: 'driven', label: 'เสาเข็มตอก', description: 'เข้าปั้นจั่น ตอกเข็ม บันทึกจำนวนครั้งตอก ตัดหัวเข็ม' },
            { value: 'bored', label: 'เสาเข็มเจาะ', description: 'เจาะ ใส่เหล็ก เทคอนกรีต เหมาะกับพื้นที่ติดอาคารข้างเคียง' },
            { value: 'micropile', label: 'ไมโครไพล์', description: 'เครื่องจักรขนาดเล็ก เหมาะกับพื้นที่แคบ/ต่อเติม' }
        ]
    },
    {
        key: 'pileLoadTest',
        section: 'งานฐานราก',
        label: 'ทดสอบน้ำหนักบรรทุกเสาเข็ม (Pile Load Test)',
        description: 'เพิ่มจุดตรวจก่อนทำฐานราก ตามที่วิศวกรกำหนดในแบบ',
        type: 'boolean',
        default: false,
        choices: [],
        visibleWhen: { key: 'foundation', values: ['driven', 'bored', 'micropile'] }
    },
    {
        key: 'slabType',
        section: 'งานโครงสร้าง',
        label: 'ระบบพื้นชั้นบน',
        type: 'single',
        default: 'cast',
        choices: [
            { value: 'cast', label: 'พื้นหล่อในที่', description: 'ตั้งแบบหล่อและผูกเหล็กพื้นทั้งผืน' },
            { value: 'precast', label: 'แผ่นพื้นสำเร็จรูป', description: 'วางแผ่นพื้นบนคาน เทคอนกรีตทับหน้า ใช้แบบหล่อน้อยกว่า' }
        ]
    },
    {
        key: 'roofType',
        section: 'งานหลังคา',
        label: 'ประเภทหลังคา',
        type: 'single',
        default: 'tile',
        choices: [
            { value: 'tile', label: 'โครงเหล็ก มุงกระเบื้อง' },
            { value: 'metal', label: 'โครงเหล็ก มุงเมทัลชีท', description: 'มุงได้เร็วกว่า ต้องมีฉนวนกันความร้อน' },
            { value: 'slab', label: 'หลังคา คสล. (Flat Slab)', description: 'เทพื้นหลังคา ปรับลาด กันซึม และทดสอบขังน้ำ' }
        ]
    },
    {
        key: 'wallType',
        section: 'งานผนังและฉาบ',
        label: 'วัสดุผนัง',
        type: 'single',
        default: 'aac',
        choices: [
            { value: 'aac', label: 'อิฐมวลเบา', description: 'ใช้ปูนก่อและปูนฉาบสำหรับอิฐมวลเบา' },
            { value: 'brick', label: 'อิฐมอญ' }
        ]
    },
    {
        key: 'windowType',
        section: 'งานตกแต่ง',
        label: 'ประตู-หน้าต่าง',
        type: 'single',
        default: 'aluminium',
        choices: [
            { value: 'aluminium', label: 'อลูมิเนียม' },
            { value: 'upvc', label: 'uPVC', description: 'สั่งผลิตตามขนาดจริง ใช้เวลาผลิตนานกว่า' }
        ]
    },
    {
        key: 'flooring',
        section: 'งานตกแต่ง',
        label: 'พื้นห้องนั่งเล่นและห้องนอน',
        type: 'single',
        default: 'tile',
        choices: [
            { value: 'tile', label: 'กระเบื้อง' },
            { value: 'laminate', label: 'ไม้ลามิเนต/SPC', description: 'ปูหลังงานสีรองพื้น' },
            { value: 'wood', label: 'ไม้จริง', description: 'ปูแล้วขัดและเคลือบผิว' }
        ]
    },
    {
        key: 'builtIn',
        section: 'งานตกแต่ง',
        label: 'เฟอร์นิเจอร์บิวท์อิน (เคาน์เตอร์ครัว ตู้เสื้อผ้า)',
        description: 'เพิ่มงานออกแบบภายในและติดตั้งบิวท์อิน',
        type: 'boolean',
        default: true,
        choices: []
    },
    {
        key: 'systems',
        section: 'งานระบบและส่วนประกอบพิเศษ',
        label: 'งานระบบและส่วนประกอบพิเศษ',
        type: 'multiple',
        default: ['aircon'],
        choices: [
            { value: 'aircon', label: 'เครื่องปรับอากาศ', description: 'ออกแบบ เดินท่อน้ำยาก่อนฉาบ ติดตั้งและทดสอบ' },
            { value: 'solar', label: 'โซลาร์เซลล์', description: 'ติดตั้งแผงและอินเวอร์เตอร์ ขออนุญาตขนานไฟ' },
            { value: 'lightning', label: 'ระบบป้องกันฟ้าผ่า' },
            { value: 'fire', label: 'ระบบป้องกันอัคคีภัย', description: 'ออกแบบ ติดตั้ง และทดสอบระบบดับเพลิง/สัญญาณเตือน' },
            { value: 'roofDeck', label: 'ดาดฟ้า', description: 'กันซึม ทดสอบขังน้ำ ราวกันตก ฐานเครื่องจักร' },
            { value: 'lift', label: 'ลิฟต์', description: 'กำหนดช่องลิฟต์ สั่งผลิตล่วงหน้า ติดตั้งและทดสอบ' },
            { value: 'pool', label: 'สระว่ายน้ำ' }
        ]
    },
    {
        key: 'exterior',
        section: 'งานภายนอก',
        label: 'งานภายนอกและภูมิทัศน์',
        type: 'multiple',
        default: ['fence', 'driveway', 'outdoorLighting', 'landscape'],
        choices: [
            { value: 'fence', label: 'รั้วและประตูรั้ว' },
            { value: 'driveway', label: 'พื้นรอบอาคาร ทางเดิน ลานจอดรถ' },
            { value: 'carport', label: 'หลังคาที่จอดรถ' },
            { value: 'outdoorLighting', label: 'ไฟสนามและกล้องวงจรปิดภายนอก' },
            { value: 'landscape', label: 'จัดสวน ปลูกต้นไม้ ปูหญ้า' }
        ]
    },
    {
        key: 'handover',
        section: 'การตรวจรับและส่งมอบ',
        label: 'งานส่งมอบเพิ่มเติม',
        description: 'ทุกโครงการมีการตรวจรับ แก้ไขรายการบกพร่อง สาธิตการใช้งาน และส่งมอบกุญแจอยู่แล้ว',
        type: 'multiple',
        default: ['asBuilt', 'buildingCert', 'houseNumber'],
        choices: [
            { value: 'asBuilt', label: 'แบบก่อสร้างจริง (As-built) และคู่มือบำรุงรักษา' },
            { value: 'homeInspection', label: 'ตรวจบ้านโดยบริษัทตรวจบ้านอิสระ', description: 'ลูกค้าจ้างผู้ตรวจภายนอกก่อนตรวจรับร่วม' },
            { value: 'buildingCert', label: 'แจ้งก่อสร้างแล้วเสร็จและขอใบรับรองอาคาร' },
            { value: 'houseNumber', label: 'ขอเลขที่บ้าน' }
        ]
    }
];

/** ขั้นตอนในแผนงานที่ตัวเลือกนี้มีผล (หาจาก `when` ของงานในแม่แบบ) */
const affectsPhases = (key: string) => CONSTRUCTION_PLAN_TEMPLATE.filter((phase) => phase.tasks.some((task) => task.when?.[key])).map((phase) => ({ code: phase.code, shortName: phase.shortName }));

export const CONSTRUCTION_OPTIONS: OptionGroup[] = OPTION_DEFINITIONS.map((group) => ({ ...group, affectsPhases: affectsPhases(group.key) }));

const isVisible = (group: OptionGroup, options: Options) => !group.visibleWhen || group.visibleWhen.values.includes(String(options[group.visibleWhen.key]));

/** ค่าเริ่มต้นของโครงการ: แบบจากคลังใช้จำนวนชั้นตามแบบ และปรับจากแบบมาตรฐานแทนการออกแบบใหม่ */
export function defaultOptions(housePlanCode?: string): Options {
    const options: Options = Object.fromEntries(CONSTRUCTION_OPTIONS.map((group) => [group.key, group.default]));
    const plan = HOUSE_PLANS.find((item) => item.code === housePlanCode);
    if (plan) {
        options['designScope'] = 'catalog';
        const floors = String(plan.floors.length);
        if (CONSTRUCTION_OPTIONS.find((group) => group.key === 'floors')!.choices.some((choice) => choice.value === floors)) options['floors'] = floors;
    }
    return options;
}

/** ตรวจค่าจากผู้ใช้ทีละตัวเลือก — ตัวเลือกที่ถูกซ่อนปรับเป็นค่าเริ่มต้น, key ที่ไม่รู้จักตัดทิ้ง */
export function normalizeOptions(input: Options | undefined): { options: Options; errors: Record<string, string> } {
    const options: Options = {};
    const errors: Record<string, string> = {};
    for (const group of CONSTRUCTION_OPTIONS) {
        const value = input?.[group.key] ?? group.default;
        const allowed = group.choices.map((choice) => choice.value);
        if (group.type === 'single' && !(typeof value === 'string' && allowed.includes(value))) errors[group.key] = `กรุณาเลือก${group.label}`;
        else if (group.type === 'single' && input) {
            // ตัวเลือกที่ใช้ได้เฉพาะบางกรณี เช่น 4-8 ชั้นเฉพาะอาคารพาณิชย์
            const choice = group.choices.find((item) => item.value === value);
            const when = choice?.visibleWhen;
            const other = when ? (input[when.key] ?? CONSTRUCTION_OPTIONS.find((item) => item.key === when.key)?.default) : undefined;
            if (when && !when.values.includes(String(other))) errors[group.key] = group.key === 'floors' ? 'บ้านพักอาศัยสูงได้ไม่เกิน 3 ชั้น (4-8 ชั้นเลือกได้เมื่อเป็นอาคารพาณิชย์)' : `${choice!.label} ใช้ไม่ได้กับตัวเลือกที่เลือกไว้`;
        }
        else if (group.type === 'multiple' && !(Array.isArray(value) && value.every((item) => allowed.includes(item)))) errors[group.key] = `${group.label}ไม่ถูกต้อง`;
        else if (group.type === 'boolean' && typeof value !== 'boolean') errors[group.key] = `${group.label}ต้องเป็นใช่/ไม่ใช่`;
        options[group.key] = Array.isArray(value) ? allowed.filter((item) => value.includes(item)) : value;
    }
    for (const group of CONSTRUCTION_OPTIONS) if (!isVisible(group, options)) options[group.key] = group.default;
    return { options, errors };
}

/** ชนิดที่ตัวสร้างแผนงานใช้ (เรียกหลัง normalizeOptions ผ่านแล้ว) */
export const toPlanOptions = (options: Options): SetupOptions => options;
