"use client";
/** Website header and footer (shared by the home, sign-in and account pages). */
import { useState } from "react";

const LINKS = [
  ["/#how", "How it works"],
  ["/#features", "Features"],
  ["/#pricing", "Pricing"],
  ["/#faq", "FAQ"],
  ["/#contact", "Contact"],
] as const;

export function SiteHeader({ signedIn }: { signedIn?: boolean | null }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="wrap header-row">
        <a className="brand" href="/" aria-label="Jeo Stone Studio home">
          <img src="/favicon.svg" alt="" width={34} height={34} />
          <span>
            <b>JEO</b> STONE STUDIO
          </span>
        </a>
        <nav className="nav" aria-label="Main">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
        </nav>
        {signedIn ? (
          <a className="btn btn-primary btn-sm" href="/account">
            My account
          </a>
        ) : (
          <span className="header-auth">
            <a className="header-signin" href="/login">
              Sign in
            </a>
            <a className="btn btn-primary btn-sm" href="/login?mode=signup">
              Free trial
            </a>
          </span>
        )}
        <button className="menu-toggle" aria-expanded={open} aria-controls="mobile-nav" aria-label="Menu" onClick={() => setOpen(!open)}>
          <span></span>
          <span></span>
        </button>
      </div>
      <nav id="mobile-nav" className="mobile-nav" aria-label="Main" hidden={!open}>
        {LINKS.map(([href, label]) => (
          <a key={href} href={href} onClick={() => setOpen(false)}>
            {label}
          </a>
        ))}
        <a href={signedIn ? "/account" : "/login"}>{signedIn ? "My account" : "Sign in"}</a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-row">
        <a className="brand" href="/">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>
            <b>JEO</b> STONE STUDIO
          </span>
        </a>
        <nav aria-label="Footer">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
          <a href="/login">Sign in</a>
        </nav>
        <p>© {new Date().getFullYear()} Jeo Stone Studio. Planning documents; confirm measurements on site before cutting.</p>
      </div>
    </footer>
  );
}
