/* Jeo Stone Studio website.
 *
 * ── Edit these settings ──────────────────────────────────────────────
 * downloads: where the Download buttons go. The GitHub "latest release"
 *            page lists the Windows .exe and both Mac .dmg files.
 * email / whatsapp / phone: shown in the Contact section (leave "" to hide).
 *            WhatsApp: international number, digits only, e.g. "355690000000".
 */
const SITE = {
  downloads: {
    windows: "https://github.com/Pukaboys/prela-stone-studio/releases/latest",
    mac: "https://github.com/Pukaboys/prela-stone-studio/releases/latest",
  },
  email: "",
  whatsapp: "",
  phone: "",
};

// Download buttons
document.querySelectorAll("[data-download]").forEach((a) => {
  const url = SITE.downloads[a.getAttribute("data-download")];
  if (url) {
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
  }
});

// Contact buttons from the settings above
const contact = document.querySelector("[data-contact]");
if (contact) {
  const items = [];
  if (SITE.email) items.push(`<a class="btn btn-primary" href="mailto:${SITE.email}">Email ${SITE.email}</a>`);
  if (SITE.whatsapp) items.push(`<a class="btn btn-ghost" href="https://wa.me/${SITE.whatsapp}" target="_blank" rel="noopener">WhatsApp</a>`);
  if (SITE.phone) items.push(`<a class="btn btn-ghost" href="tel:${SITE.phone.replace(/\s+/g, "")}">Call ${SITE.phone}</a>`);
  contact.innerHTML = items.length ? items.join("") : `<p class="muted">Contact details coming soon.</p>`;
}

// Screenshot tabs (arrow keys move between tabs)
const tabs = [...document.querySelectorAll('[role="tab"]')];
function select(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  });
}
tabs.forEach((t, i) => {
  t.tabIndex = i === 0 ? 0 : -1;
  t.addEventListener("click", () => select(t));
  t.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const next = tabs[(i + d + tabs.length) % tabs.length];
    select(next);
    next.focus();
  });
});

// Mobile menu
const toggle = document.querySelector(".menu-toggle");
const mobile = document.getElementById("mobile-nav");
toggle?.addEventListener("click", () => {
  const open = toggle.getAttribute("aria-expanded") === "true";
  toggle.setAttribute("aria-expanded", String(!open));
  mobile.hidden = open;
});
mobile?.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => {
    toggle.setAttribute("aria-expanded", "false");
    mobile.hidden = true;
  }),
);

document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = String(new Date().getFullYear())));
