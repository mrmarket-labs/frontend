import type { MetadataRoute } from "next";

/** Lets phones install Invest Like Buffett to the Home Screen, which is what iOS needs before it allows push. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Invest Like Buffett",
    short_name: "Invest Like Buffett",
    description: "The best crypto strategy is to hold. But are you holding the right assets?",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0b",
    theme_color: "#0b0b0b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
