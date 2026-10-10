import { Component, input } from '@angular/core';
import { CompanyProfile } from '@/app/pages/service/procurement.service';

/** หัวกระดาษบริษัท (โลโก้ + ชื่อ ที่อยู่ เลขผู้เสียภาษี โทร อีเมล) สำหรับเอกสารพิมพ์ — ข้อมูลจาก /settings/company */
@Component({
    selector: 'app-company-letterhead',
    standalone: true,
    template: `
        @let co = company();
        <img class="logo" src="/pp-prime-logo.svg" [attr.alt]="'โลโก้ ' + (co?.name ?? '')" />
        <div class="details">
            <div class="name">{{ co?.name }}</div>
            @if (co?.address) {
                <div>{{ co!.address }}</div>
            }
            <div>
                @if (co?.taxId) {
                    <span>เลขประจำตัวผู้เสียภาษี {{ co!.taxId }}{{ co!.branch ? ' (' + co!.branch + ')' : '' }}</span>
                }
                @if (co?.phone) {
                    <span class="sep">โทร {{ co!.phone }}</span>
                }
                @if (co?.email) {
                    <span class="sep">อีเมล {{ co!.email }}</span>
                }
            </div>
        </div>
    `,
    styles: `
        :host {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            font-size: 12px;
            line-height: 1.45;
            color: #111;
        }
        .logo {
            flex: 0 0 auto;
            width: 64px;
            height: 45px;
            object-fit: contain;
        }
        .name {
            font-size: 16px;
            font-weight: 700;
        }
        .sep:not(:first-child)::before {
            content: '·';
            margin: 0 0.4rem;
            color: #777;
        }
    `
})
export class CompanyLetterhead {
    readonly company = input<CompanyProfile | undefined>();
}
