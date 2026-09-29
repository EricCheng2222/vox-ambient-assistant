"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";

export type MapPoint = {
  id: string;
  label: string;
  /** Second line in the popup, e.g. "十全一路, Kaohsiung · 5 minutes ago". */
  detail?: string;
  lat: number;
  lon: number;
  /** Meters; drawn as a faint circle. */
  accuracy?: number;
  /** Older positions are drawn dimmer. */
  stale?: boolean;
};

// OpenStreetMap's own tiles: no key, and local street names. The dark look is a
// CSS filter over them (.vox-tiles-dark). OSM's tile policy asks for
// attribution and a referrer, which the page otherwise never sends.
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/**
 * A small map of points, such as where each device last was. Leaflet with
 * OpenStreetMap tiles, loaded in the browser only.
 */
export function DeviceMap({
  points,
  theme = "dark",
  className,
  label = "Map",
}: {
  points: MapPoint[];
  theme?: "dark" | "light";
  className?: string;
  label?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const pointsKey = JSON.stringify(points.map((point) => [point.id, point.lat, point.lon, point.accuracy, point.stale, point.label, point.detail]));

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !containerRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, { zoomControl: true, attributionControl: true, worldCopyJump: true });
        L.tileLayer(TILES, {
          attribution: ATTRIBUTION,
          maxZoom: 19,
          referrerPolicy: "strict-origin-when-cross-origin",
          className: theme === "dark" ? "vox-tiles-dark" : "",
        }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
        mapRef.current.setView([23.7, 121], 3);
      }
      const map = mapRef.current;
      const layer = layerRef.current!;
      layer.clearLayers();
      const shown = JSON.parse(pointsKey) as Array<[string, number, number, number | undefined, boolean | undefined, string, string | undefined]>;
      for (const [, lat, lon, accuracy, stale, pointLabel, detail] of shown) {
        if (accuracy && accuracy > 30) {
          L.circle([lat, lon], {
            radius: accuracy,
            color: "#78ebff",
            weight: 1,
            opacity: stale ? 0.25 : 0.5,
            fillOpacity: stale ? 0.04 : 0.1,
          }).addTo(layer);
        }
        const icon = L.divIcon({
          className: `vox-map-marker${stale ? " is-stale" : ""}`,
          html: `<span class="vox-map-dot"></span><span class="vox-map-label">${escapeHtml(pointLabel)}</span>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });
        L.marker([lat, lon], { icon, keyboard: true, title: pointLabel })
          .bindPopup(`<strong>${escapeHtml(pointLabel)}</strong>${detail ? `<br>${escapeHtml(detail)}` : ""}`)
          .addTo(layer);
      }
      if (shown.length === 1) map.setView([shown[0][1], shown[0][2]], 15);
      else if (shown.length > 1) map.fitBounds(L.latLngBounds(shown.map(([, lat, lon]) => [lat, lon] as [number, number])), { padding: [40, 40], maxZoom: 15 });
      // The container may have been sized after the map was created.
      requestAnimationFrame(() => map.invalidateSize());
    });
    return () => {
      cancelled = true;
    };
  }, [pointsKey, theme]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  return <div ref={containerRef} className={`vox-map ${className ?? ""}`} role="region" aria-label={label} />;
}
