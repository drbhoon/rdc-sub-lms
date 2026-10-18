import type { MetadataRoute } from "next";
import { BASE_PATH } from "@/lib/base-path";

/**
 * Lets a phone "Add to home screen" and open the LMS full-screen like an app.
 * Everything is relative to where the LMS is mounted (/lms on hr.rdcc.ai, the
 * root locally), so the start page and icons resolve in both places.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RDC Learning",
    short_name: "RDC Learning",
    description: "Learning portal for RDC subsidiary companies",
    start_url: `${BASE_PATH}/dashboard`,
    scope: `${BASE_PATH}/`,
    display: "standalone",
    background_color: "#f4f6fa",
    theme_color: "#12233f",
    icons: [
      { src: `${BASE_PATH}/brand/icon-192.png`, sizes: "192x192", type: "image/png" },
      { src: `${BASE_PATH}/brand/icon-512.png`, sizes: "512x512", type: "image/png" },
    ],
  };
}
