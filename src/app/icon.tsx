import { ImageResponse } from "next/og";
import { brand } from "@/lib/brand";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: 64,
        height: 64,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 16,
        background: brand.accent,
        color: "#ffffff",
        fontFamily: "Arial, sans-serif",
        fontSize: 40,
        fontWeight: 750,
        letterSpacing: "-0.07em",
      }}
    >
      {brand.name.charAt(0).toLocaleUpperCase()}
    </div>,
    size,
  );
}
