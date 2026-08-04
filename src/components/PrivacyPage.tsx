import {
  Activity,
  Database,
  EyeOff,
  HardDrive,
  LineChart,
  Radio,
  ShieldCheck,
  type LucideIcon
} from "lucide-react";
import { useLocale } from "../LocaleContext";

export function PrivacyPage() {
  const { copy } = useLocale();
  const sections: Array<{
    icon: LucideIcon;
    title: string;
    body: string;
    items: string[];
    links?: Array<{ href: string; label: string }>;
  }> = [
    {
      icon: HardDrive,
      title: copy.privacy.essentialTitle,
      body: copy.privacy.essentialBody,
      items: [
        copy.privacy.essentialLocale,
        copy.privacy.essentialConsent,
        copy.privacy.essentialSession,
        copy.privacy.essentialActor
      ]
    },
    {
      icon: Activity,
      title: copy.privacy.cloudflareTitle,
      body: copy.privacy.cloudflareBody,
      items: [copy.privacy.cloudflareStorage, copy.privacy.cloudflareLogs],
      links: [
        {
          href: "https://developers.cloudflare.com/speed/observatory/rum-beacon/",
          label: copy.privacy.cloudflareRumDocs
        },
        {
          href: "https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/",
          label: copy.privacy.cloudflareDataDocs
        }
      ]
    },
    {
      icon: LineChart,
      title: copy.privacy.gaTitle,
      body: copy.privacy.gaBody,
      items: [
        copy.privacy.gaPurpose,
        copy.privacy.gaEvents,
        copy.privacy.gaRetention,
        copy.privacy.gaConnection,
        copy.privacy.gaExcluded
      ],
      links: [
        {
          href: "https://policies.google.com/technologies/partner-sites",
          label: copy.privacy.gaPartnerDocs
        },
        {
          href: "https://support.google.com/analytics/answer/7318509?hl=en-uk",
          label: copy.privacy.gaRetentionDocs
        }
      ]
    },
    {
      icon: EyeOff,
      title: copy.privacy.clarityTitle,
      body: copy.privacy.clarityBody,
      items: [copy.privacy.clarityReplay, copy.privacy.clarityMasking]
    },
    {
      icon: Radio,
      title: copy.privacy.mixpanelTitle,
      body: copy.privacy.mixpanelBody,
      items: [copy.privacy.mixpanelLifecycle, copy.privacy.mixpanelBoundary]
    },
    {
      icon: Database,
      title: copy.privacy.serverTitle,
      body: copy.privacy.serverBody,
      items: [
        copy.privacy.serverTemporary,
        copy.privacy.serverPublished,
        copy.privacy.serverConsentBoundary
      ]
    }
  ];

  return (
    <main className="page-frame privacy-page">
      <header className="privacy-page-heading">
        <span className="privacy-heading-mark">
          <ShieldCheck size={20} aria-hidden="true" />
        </span>
        <div>
          <span className="eyebrow">{copy.privacy.pageEyebrow}</span>
          <h1>{copy.privacy.pageTitle}</h1>
          <p>{copy.privacy.pageIntro}</p>
          <small>{copy.privacy.updated}</small>
        </div>
      </header>

      <div className="privacy-ledger">
        {sections.map(({ icon: Icon, title, body, items, links }, index) => (
          <section className="privacy-ledger-row" key={title}>
            <div className="privacy-ledger-index">
              <span>0{index + 1}</span>
              <Icon size={18} aria-hidden="true" />
            </div>
            <div className="privacy-ledger-copy">
              <h2>{title}</h2>
              <p>{body}</p>
              <ul>
                {items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {links && (
                <div className="privacy-source-links">
                  {links.map((link) => (
                    <a href={link.href} rel="noopener noreferrer" target="_blank" key={link.href}>
                      {link.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      <section className="privacy-contact">
        <span className="eyebrow">{copy.privacy.contactEyebrow}</span>
        <h2>{copy.privacy.contactTitle}</h2>
        <p>{copy.privacy.contactBody}</p>
      </section>
    </main>
  );
}
