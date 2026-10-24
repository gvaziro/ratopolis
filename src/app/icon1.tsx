import { ImageResponse } from "next/og";
import { MARK_URI, SOOT } from "./brand";

/** PNG app icons for the install manifest (SH-6): 192 and 512 px, served at /icon1/192 and /icon1/512. */
export function generateImageMetadata() {
  return [
    { id: "192", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "512", size: { width: 512, height: 512 }, contentType: "image/png" },
  ];
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const px = (await id) === "512" ? 512 : 192;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: SOOT }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MARK_URI} width={Math.round(px * 0.82)} height={Math.round(px * 0.82)} alt="" />
      </div>
    ),
    { width: px, height: px },
  );
}
