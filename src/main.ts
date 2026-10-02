import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app.config';
import { AppComponent } from './app.component';
import { environment } from './environments/environment';

/** เปิด API จำลองก่อนแอปเริ่มส่งคำขอ (โหลดเฉพาะเมื่อ useMock เปิดอยู่) */
async function startMockApi() {
    if (!environment.useMock) return;
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
}

startMockApi()
    .then(() => bootstrapApplication(AppComponent, appConfig))
    .catch((err) => console.error(err));
