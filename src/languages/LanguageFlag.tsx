import type { Locale } from "./locale";

/**
 * Flags drawn inline instead of pulling emoji bitmaps from a CDN.
 * The desktop build and the APK have to work without network access on first
 * paint, and a remote image used to leave a broken-image icon in the selector.
 */
const FLAGS: Record<Locale, React.ReactNode> = {
  en: (
    <>
      <rect width="60" height="40" fill="#012169" />
      <path d="M0 0 60 40M60 0 0 40" stroke="#fff" strokeWidth="9" />
      <path d="M0 0 60 40M60 0 0 40" stroke="#C8102E" strokeWidth="4" />
      <path d="M30 0v40M0 20h60" stroke="#fff" strokeWidth="14" />
      <path d="M30 0v40M0 20h60" stroke="#C8102E" strokeWidth="8" />
    </>
  ),
  es: (
    <>
      <rect width="60" height="40" fill="#AA151B" />
      <rect y="10" width="60" height="20" fill="#F1BF00" />
    </>
  ),
  ru: (
    <>
      <rect width="60" height="13.3" fill="#fff" />
      <rect y="13.3" width="60" height="13.3" fill="#0039A6" />
      <rect y="26.6" width="60" height="13.4" fill="#D52B1E" />
    </>
  ),
  uk: (
    <>
      <rect width="60" height="40" fill="#005BBB" />
      <rect y="20" width="60" height="20" fill="#FFD500" />
    </>
  ),
  de: (
    <>
      <rect width="60" height="13.3" fill="#000" />
      <rect y="13.3" width="60" height="13.3" fill="#DD0000" />
      <rect y="26.6" width="60" height="13.4" fill="#FFCE00" />
    </>
  ),
  it: (
    <>
      <rect width="20" height="40" fill="#009246" />
      <rect x="20" width="20" height="40" fill="#fff" />
      <rect x="40" width="20" height="40" fill="#CE2B37" />
    </>
  ),
  fr: (
    <>
      <rect width="20" height="40" fill="#002395" />
      <rect x="20" width="20" height="40" fill="#fff" />
      <rect x="40" width="20" height="40" fill="#ED2939" />
    </>
  ),
  pl: (
    <>
      <rect width="60" height="20" fill="#fff" />
      <rect y="20" width="60" height="20" fill="#DC143C" />
    </>
  ),
  tr: (
    <>
      <rect width="60" height="40" fill="#E30A17" />
      <circle cx="24" cy="20" r="10" fill="#fff" />
      <circle cx="28" cy="20" r="8" fill="#E30A17" />
      <path d="M38 20l-7 2.6 4.3 5.4-.1-7 4.4 5.4z" fill="#fff" />
    </>
  ),
  pt: (
    <>
      <rect width="60" height="40" fill="#009B3A" />
      <path d="M30 5l22 15-22 15L8 20z" fill="#FEDF00" />
      <circle cx="30" cy="20" r="7" fill="#002776" />
    </>
  ),
};

export function LanguageFlag({
  locale,
  className = "",
  size = 16,
}: {
  locale: Locale;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 60 40"
      width={size}
      height={(size * 2) / 3}
      role="presentation"
      aria-hidden="true"
      className={`shrink-0 overflow-hidden rounded-[2px] ring-1 ring-black/10 ${className}`}
      style={{ display: "block" }}
    >
      {FLAGS[locale]}
    </svg>
  );
}

export default LanguageFlag;
