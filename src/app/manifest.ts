import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "nomly",
    short_name: "nomly",
    description: "Kochbuch, Wochenplan, Einkaufsliste",
    start_url: "/start",
    scope: "/",
    display: "standalone",
    background_color: "#13110F",
    theme_color: "#E1721F",
    lang: "de",
    dir: "ltr",
    orientation: "portrait",
    icons: [
      { src: "/icons/icon-192.png",          sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-384.png",          sizes: "384x384", type: "image/png" },
      { src: "/icons/icon-512.png",          sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg",              sizes: "any",     type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: "Start",        short_name: "Start",   url: "/",            icons: [{ src: "/icons/shortcut-start-96.png",    sizes: "96x96", type: "image/png" }] },
      { name: "Einkauf",      short_name: "Einkauf", url: "/einkauf",     icons: [{ src: "/icons/shortcut-einkauf-96.png", sizes: "96x96", type: "image/png" }] },
      { name: "Planer",       short_name: "Planer",  url: "/plan",        icons: [{ src: "/icons/shortcut-plan-96.png",     sizes: "96x96", type: "image/png" }] },
      { name: "Rezepte",      short_name: "Rezepte", url: "/rezepte",     icons: [{ src: "/icons/shortcut-rezepte-96.png",  sizes: "96x96", type: "image/png" }] },
      { name: "Neues Rezept", short_name: "Neu",     url: "/rezepte/neu", icons: [{ src: "/icons/shortcut-neu-96.png",      sizes: "96x96", type: "image/png" }] },
    ],
  };
}
