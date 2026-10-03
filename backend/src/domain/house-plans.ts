import type { ApiSchemas } from '../api/api.js';

/** แบบบ้านในคลัง (ข้อมูลตั้งต้น) */
export const HOUSE_PLANS: ApiSchemas['HousePlan'][] = [
    {
        code: 'ARUN',
        name: 'ARUN (อรุณ)',
        description: 'บ้านเดี่ยว 2 ชั้น โถงนั่งเล่นเพดานสูง (Double Volume) ห้องนอนผู้สูงอายุชั้นล่าง และโรงจอดรถในตัวบ้าน',
        width: 14,
        depth: 11,
        floorHeight: 3,
        parking: 2,
        floors: [
            {
                label: 'ชั้น 1',
                rooms: [
                    { name: 'ห้องครัว', kind: 'kitchen', x: 0, y: 0, w: 4, h: 5 },
                    { name: 'รับประทานอาหาร', kind: 'dining', x: 4, y: 0, w: 5, h: 5 },
                    { name: 'ห้องนอนผู้สูงอายุ', kind: 'bedroom', x: 9, y: 0, w: 5, h: 3 },
                    { name: 'ห้องน้ำ', kind: 'bathroom', x: 9, y: 3, w: 2, h: 2 },
                    { name: 'บันได', kind: 'stair', x: 11, y: 3, w: 3, h: 2 },
                    { name: 'จอดรถ 2 คัน', kind: 'garage', x: 0, y: 5, w: 6, h: 6 },
                    { name: 'ห้องนั่งเล่น', kind: 'living', x: 6, y: 5, w: 8, h: 6 }
                ]
            },
            {
                label: 'ชั้น 2',
                rooms: [
                    { name: 'ห้องนอน 2', kind: 'bedroom', x: 0, y: 0, w: 4, h: 5 },
                    { name: 'ห้องน้ำ', kind: 'bathroom', x: 4, y: 0, w: 2, h: 2.5 },
                    { name: 'ห้องน้ำ', kind: 'bathroom', x: 4, y: 2.5, w: 2, h: 2.5 },
                    { name: 'ห้องนอน 3', kind: 'bedroom', x: 6, y: 0, w: 5, h: 3 },
                    { name: 'ห้องซักรีด', kind: 'other', x: 11, y: 0, w: 3, h: 3 },
                    { name: 'โถงพักผ่อน', kind: 'living', x: 6, y: 3, w: 5, h: 2 },
                    { name: 'บันได', kind: 'stair', x: 11, y: 3, w: 3, h: 2 },
                    { name: 'ห้องนอนใหญ่', kind: 'bedroom', x: 0, y: 5, w: 4, h: 6 },
                    { name: 'ห้องน้ำ', kind: 'bathroom', x: 4, y: 5, w: 2, h: 3 },
                    { name: 'ห้องแต่งตัว', kind: 'other', x: 4, y: 8, w: 2, h: 3 },
                    { name: 'โถงสูง', kind: 'void', x: 6, y: 5, w: 8, h: 6 }
                ]
            }
        ]
    },
    {
        code: 'RAWEE',
        name: 'RAWEE (รวี)',
        description: 'บ้านเดี่ยว 2 ชั้นขนาดกะทัดรัด ห้องนอนแขกชั้นล่าง ห้องนั่งเล่นเชื่อมต่อพื้นที่รับประทานอาหาร',
        width: 10,
        depth: 9,
        floorHeight: 3,
        parking: 2,
        floors: [
            {
                label: 'ชั้น 1',
                rooms: [
                    { name: 'รับประทานอาหาร', kind: 'dining', x: 0, y: 0, w: 4, h: 4 },
                    { name: 'ห้องครัว', kind: 'kitchen', x: 4, y: 0, w: 3, h: 4 },
                    { name: 'ห้องน้ำ', kind: 'bathroom', x: 7, y: 0, w: 3, h: 2 },
                    { name: 'บันได', kind: 'stair', x: 7, y: 2, w: 3, h: 2 },
                    { name: 'ห้องนั่งเล่น', kind: 'living', x: 0, y: 4, w: 6, h: 5 },
                    { name: 'ห้องนอนแขก', kind: 'bedroom', x: 6, y: 4, w: 4, h: 5 }
                ]
            },
            {
                label: 'ชั้น 2',
                rooms: [
                    { name: 'ห้องนอน 2', kind: 'bedroom', x: 0, y: 0, w: 4, h: 4 },
                    { name: 'ห้องน้ำ', kind: 'bathroom', x: 4, y: 0, w: 3, h: 2 },
                    { name: 'ห้องน้ำ', kind: 'bathroom', x: 7, y: 0, w: 3, h: 2 },
                    { name: 'โถง', kind: 'other', x: 4, y: 2, w: 3, h: 2 },
                    { name: 'บันได', kind: 'stair', x: 7, y: 2, w: 3, h: 2 },
                    { name: 'ห้องนอนใหญ่', kind: 'bedroom', x: 0, y: 4, w: 6, h: 5 },
                    { name: 'ห้องนอน 3', kind: 'bedroom', x: 6, y: 4, w: 4, h: 5 }
                ]
            }
        ]
    }
];
