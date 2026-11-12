"use client";
/** Jeo Stone Studio website: what it does, pricing, FAQ, contact. */
import { useEffect, useState } from "react";
import "./site.css";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { PLANS, TRIAL_DAYS } from "@/lib/plans";
import { CONTACT } from "@/lib/site-config";

const TABS = [
  {
    id: "straighten",
    label: "Straighten",
    shots: [
      ["corners.webp", "Before: photo taken at an angle, corners detected"],
      ["straightened.webp", "After: the slab square-on, at its real size"],
    ],
    text: "Drag any corner that is hidden behind a clamp; a magnifier helps you place it exactly. The straightened photo becomes the slab, measured in millimetres.",
  },
  {
    id: "plan",
    label: "Plan",
    shots: [["layout.webp", "Pieces placed on the real stone"]],
    text: "Pieces sit on the real stone. Paint defects and the checks keep every piece clear of them, of the slab edge and of each other — always leaving the saw gap.",
  },
  {
    id: "assemble",
    label: "Assemble",
    shots: [
      ["assembly-3d.webp", "3D, with real mitred edges"],
      ["assembly-2d.webp", "2D, to follow the veins across joints"],
    ],
    text: "See how the veins run across the finished kitchen before cutting. Download the model as a 3D file, or open it in AR on an iPhone or iPad to show the client.",
  },
  {
    id: "shapes",
    label: "Shapes",
    shots: [
      ["shape-editor.webp", "Shapes with exact dimensions"],
      ["scanner.webp", "Scan templates from a photo"],
    ],
    text: "Rounded and chamfered corners (with an angle or 45° in one click), circles, arches, curved bands and free forms. Photograph cardboard templates and every shape becomes a piece.",
  },
  {
    id: "produce",
    label: "Produce",
    shots: [
      ["cutlist.png", "Cut list, ready to print or save as PDF"],
      ["quote.webp", "Quote from your own prices"],
    ],
    text: "One click gives the workshop every size, position, edge and opening, and the saw a DXF in millimetres. The quote is calculated from the real stone area, sawing length, mitres, edges and cut-outs.",
  },
] as const;

const FEATURES = [
  ["Photo straightening", "Automatic corner detection and perspective correction, or straighten and crop by hand."],
  ["Vein matching", "Move and rotate pieces over the photo to any angle; the assembly shows how the veins meet."],
  ["Real shapes", "Corners with radius or chamfer, circles, arches, curved bands, L-shapes and free forms."],
  ["Template scanner", "Trace shapes from a photo of templates or a drawing and add them as pieces in one go."],
  ["Openings", "Sinks, tap holes and hobs — square, rounded or round — placed by their distance from the edges."],
  ["Mitres and edges", "45° mitre below or above on each side, and finishes from polished to bullnose and ogee."],
  ["Placement checks", "Overlaps, the saw gap, the slab edge and painted defects are checked on the real outlines."],
  ["Auto-arrange", "Packs pieces onto the slabs to save stone, or fixes only the pieces with problems."],
  ["3D and AR", "A textured 3D preview, downloadable for Windows 3D Viewer, Blender, SketchUp or iPhone AR."],
  ["Cut list and DXF", "Per-slab drawings and tables for the workshop, and a millimetre DXF for CNC and bridge saws."],
  ["Quotes", "Your prices per m², per metre of sawing, mitre and edge, and per cut-out — with VAT."],
  ["Desktop and online", "Work offline on Windows or Mac, or in the browser — your projects sync between them."],
  ["Book-matched slabs", "Mirror a slab's photo to plan book-matched walls and floors."],
  ["Backups with photos", "Project backups carry their slab photos and open on any computer."],
  ["Private and secure", "Your own account, encrypted connections, and projects only you can see."],
] as const;

const FAQ = [
  ["How does the free trial work?", `Create an account and you get ${TRIAL_DAYS} days with every feature, in the browser and on one computer. No card is needed. When the trial ends, choose a plan to keep working — your projects are kept.`],
  ["Do I need an internet connection?", "The desktop app works offline. It checks your licence online about once a day and keeps working offline for up to 30 days."],
  ["On how many computers can I use it?", `Each plan includes ${PLANS[0].devices} computers plus the online studio. You can move a licence to another computer from your account page at any time.`],
  ["How do I pay?", "Securely with PayPal (PayPal balance or card). Your licence is extended as soon as the payment is confirmed."],
  ["What kind of photo do I need?", "A normal phone photo showing the whole slab. It does not have to be taken straight on: the corners are found automatically and the photo is straightened. Then enter the slab's measured width, height and thickness."],
  ["Is it a CNC program?", "It is a planning studio. It exports a DXF in millimetres and printable cut lists for your CNC, bridge saw or operator. Always confirm measurements on site before cutting."],
  ["Which file types can I export?", "Cut lists as PDF, DXF for CAD and saws, 3D models (GLB for Windows/Blender/SketchUp, USDZ for iPhone AR), an SVG of the assembly, and project backups with the slab photos."],
] as const;

export default function Home() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("straighten");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ desktop: boolean; account: unknown }>)
      .then((me) => {
        // The desktop app opens straight into the studio.
        if (me.desktop) window.location.replace("/studio");
        else setSignedIn(!!me.account);
      })
      .catch(() => setSignedIn(false));
  }, []);
  const current = TABS.find((t) => t.id === tab)!;
  const trialHref = signedIn ? "/account" : "/login?mode=signup";
  const contacts = [
    CONTACT.email && { href: `mailto:${CONTACT.email}`, label: `Email ${CONTACT.email}`, primary: true },
    CONTACT.whatsapp && { href: `https://wa.me/${CONTACT.whatsapp}`, label: "WhatsApp", primary: false },
    CONTACT.phone && { href: `tel:${CONTACT.phone.replace(/\s+/g, "")}`, label: `Call ${CONTACT.phone}`, primary: false },
  ].filter(Boolean) as { href: string; label: string; primary: boolean }[];

  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteHeader signedIn={signedIn} />
      <main id="main">
        <section className="hero" id="top">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">Slab planning for stone fabricators</p>
              <h1>Cut the right piece from the right part of the slab.</h1>
              <p className="lead">
                Jeo Stone Studio turns a phone photo of a slab into a true-to-scale layout. Place every countertop, sink and apron on the real stone, match the veins across
                the joints, check the saw gap — and hand the workshop a cut list, a DXF and a price before the first cut.
              </p>
              <div className="cta-row">
                <a className="btn btn-primary" href={trialHref}>
                  Start your {TRIAL_DAYS}-day free trial
                </a>
                <a className="btn btn-ghost" href="#pricing">
                  See pricing
                </a>
              </div>
              <p className="trust">No card needed for the trial · Windows, macOS and browser · works offline</p>
            </div>
            <div className="hero-shot">
              <figure className="frame frame-main">
                <img src="/site/layout.webp" alt="Jeo Stone Studio slab layout: pieces placed on a marble slab with a marked defect" width={1440} height={900} />
              </figure>
              <figure className="frame frame-float">
                <img src="/site/corners.webp" alt="A slab photographed at an angle with its four corners detected automatically" width={1440} height={900} loading="lazy" />
                <figcaption>Corners found automatically</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section className="facts" aria-label="At a glance">
          <div className="wrap facts-grid">
            <div><b>4 mm</b><span>saw gap checked on the real outlines</span></div>
            <div><b>0.2 mm</b><span>accuracy on circles and curves</span></div>
            <div><b>2D + 3D</b><span>preview of the finished kitchen</span></div>
            <div><b>PDF · DXF</b><span>cut lists for the workshop and the saw</span></div>
          </div>
        </section>

        <section className="section" id="how">
          <div className="wrap">
            <p className="eyebrow">How it works</p>
            <h2>From slab photo to cut list in four steps</h2>
            <ol className="steps">
              <li><span className="step-no">1</span><h3>Photograph the slab</h3><p>Any phone photo, even taken at an angle. The four slab corners are found automatically and the photo is straightened to the slab&apos;s measured size.</p></li>
              <li><span className="step-no">2</span><h3>Enter the pieces</h3><p>Countertops, backsplashes, aprons and tables: rectangles, circles, arches, curved bands, free forms or scanned templates — with sinks, tap holes, hobs, 45° mitres and edge finishes.</p></li>
              <li><span className="step-no">3</span><h3>Plan the cuts</h3><p>Drag pieces over the stone to follow the veins, turn them with the mouse wheel, or let Auto-arrange pack them. Overlaps, slab edges and defects are checked as you go.</p></li>
              <li><span className="step-no">4</span><h3>Send it to the workshop</h3><p>Print the cut list or save it as PDF, export a DXF for the CNC or bridge saw, give the client a quote and a 3D view of the finished surface.</p></li>
            </ol>
          </div>
        </section>

        <section className="section section-alt" id="tour">
          <div className="wrap">
            <p className="eyebrow">See it before you try it</p>
            <h2>A tour of the studio</h2>
            <div className="tabs" role="tablist" aria-label="Screens">
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="panel" role="tabpanel">
              <div className={current.shots.length > 1 ? "panel-pair" : undefined}>
                {current.shots.map(([src, caption]) => (
                  <figure key={src} className={"frame" + (src.endsWith(".png") ? " frame-paper" : "")}>
                    <img src={`/site/${src}`} alt={caption} loading="lazy" />
                    <figcaption>{caption}</figcaption>
                  </figure>
                ))}
              </div>
              <p className="panel-text">{current.text}</p>
            </div>
          </div>
        </section>

        <section className="section" id="features">
          <div className="wrap">
            <p className="eyebrow">Everything in the studio</p>
            <h2>Made for the workshop and the showroom</h2>
            <div className="feature-grid">
              {FEATURES.map(([title, text]) => (
                <article key={title}>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-alt" id="pricing">
          <div className="wrap">
            <p className="eyebrow">Pricing</p>
            <h2>One studio, every feature</h2>
            <div className="pricing">
              <article className="price-card trial">
                <h3>Free trial</h3>
                <p className="price">
                  €0 <small>for {TRIAL_DAYS} days</small>
                </p>
                <ul>
                  <li>Every feature</li>
                  <li>Online studio + 1 computer</li>
                  <li>No card needed</li>
                </ul>
                <a className="btn btn-ghost" href={trialHref}>
                  Start free trial
                </a>
              </article>
              {PLANS.map((p) => (
                <article key={p.id} className={"price-card" + (p.id === "yearly" ? " featured" : "")}>
                  {p.note && <span className="badge">{p.note}</span>}
                  <h3>{p.name}</h3>
                  <p className="price">
                    €{p.price} <small>{p.per}</small>
                  </p>
                  <ul>
                    <li>Every feature, all updates</li>
                    <li>Online studio + {p.devices} computers</li>
                    <li>Windows, macOS and browser</li>
                  </ul>
                  <a className={"btn " + (p.id === "yearly" ? "btn-primary" : "btn-ghost")} href={signedIn ? "/account#plans" : "/login?mode=signup&next=/account%23plans"}>
                    Choose {p.name.toLowerCase()}
                  </a>
                </article>
              ))}
            </div>
            <p className="price-note">Prices in euro. Paid securely with PayPal; your licence is extended as soon as the payment is confirmed. Plans do not renew automatically — we remind you before the end.</p>
          </div>
        </section>

        <section className="section" id="faq">
          <div className="wrap narrow">
            <p className="eyebrow">Questions</p>
            <h2>Frequently asked</h2>
            <div className="faq">
              {FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-alt" id="contact">
          <div className="wrap narrow contact">
            <p className="eyebrow">Contact</p>
            <h2>Talk to us</h2>
            <p className="lead">Questions about the studio, licences for a larger team, or help with a tricky slab — send us a message.</p>
            <div className="contact-actions">
              {contacts.length ? (
                contacts.map((c) => (
                  <a key={c.href} className={"btn " + (c.primary ? "btn-primary" : "btn-ghost")} href={c.href}>
                    {c.label}
                  </a>
                ))
              ) : (
                <p className="muted">Contact details coming soon.</p>
              )}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
