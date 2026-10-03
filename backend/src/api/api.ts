import type { components } from './schema.js';

/** Type ของ API สร้างจาก ../api/openapi.yaml ด้วย `npm run api:types` — ห้ามแก้ schema.ts ด้วยมือ */
export type ApiSchemas = components['schemas'];
export type ApiProblem = ApiSchemas['Problem'];
