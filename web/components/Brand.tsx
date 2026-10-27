"use client";

import Link from "next/link";

const NAME = process.env.NEXT_PUBLIC_APP_NAME || "E-Book Agent";

/**
 * Logo files live in web/public:  logo.png (full logo with the name)  and  logo-icon.png (robot + book only).
 *  variant "icon" (default): small icon + the name as text (nav bar, sidebar)
 *  variant "full":           the complete logo picture, centred (login / sign-up cards)
 * onDark puts the icon on a white rounded chip so it stays readable on the navy sidebar.
 * If a picture file is missing the browser hides it and the name still shows.
 */
export default function Brand({ variant = "icon", onDark = false, height = 56 }: { variant?: "icon" | "full"; onDark?: boolean; height?: number }) {
  const hide = (e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = "none";
  };

  if (variant === "full") {
    return (
      <Link href="/" aria-label={NAME} style={{ display: "block", textAlign: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt={NAME} onError={hide} style={{ width: 150, height: "auto" }} />
      </Link>
    );
  }

  return (
    <Link href="/" className="logo" style={{ display: "inline-flex", alignItems: "center", gap: 10 }} aria-label={NAME}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          background: onDark ? "#fff" : "transparent",
          borderRadius: 10,
          padding: onDark ? "3px 6px" : 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-icon.png"
          alt=""
          onError={hide}
          style={{ height, width: "auto", display: "block" }}
        />
      </span>
      <span>{NAME}</span>
    </Link>
  );
}
