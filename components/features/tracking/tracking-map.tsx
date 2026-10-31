"use client";
// Carte sans dépendance (contrat UI §5, accord ROOT) : tuiles raster OSM 256 px visibles seulement, zoom borné,
// cache HTTP du navigateur uniquement (aucun préchargement, aucun cache SW), tracé et marqueurs en SVG à partir des
// seules données serveur. Attributions toujours visibles. Échec des tuiles : fond neutre déclaré, tracé libellé schéma.
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "../../app/icons";
import { MAX_ZOOM, MIN_ZOOM, clampZoom, fitView, project, unproject, visibleTiles } from "./model";
import styles from "./tracking.module.css";

export type MapPoint = { latitude: number; longitude: number };
export type TrackingMapProps = {
  position?: (MapPoint & { accuracyM: number }) | null;
  destination?: MapPoint | null;
  draft?: MapPoint | null;
  snappedEnd?: [number, number] | null;
  route?: [number, number][] | null;
  routeAttribution?: string | null;
  description: string;
  /** Sélection d’un point (destination manuelle). Absent = lecture seule : le clic carte est sans effet. */
  onPick?: (point: MapPoint) => void;
};

const OSM_CREDIT = "© OpenStreetMap contributors";
const DEFAULT_CENTER: [number, number] = [-61.07, 14.62]; // Martinique, utilisé seulement sans aucun point serveur

export function TrackingMap({ position, destination, draft, snappedEnd, route, routeAttribution, description, onPick }: TrackingMapProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<{ zoom: number; center: { x: number; y: number } } | null>(null);
  const [failed, setFailed] = useState(0);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const titleId = useId();

  const points = useMemo(() => {
    const list: [number, number][] = [];
    if (position) list.push([position.longitude, position.latitude]);
    if (destination) list.push([destination.longitude, destination.latitude]);
    if (route) list.push(...route);
    return list;
  }, [position, destination, route]);
  const fitKey = points.map((p) => p.join(",")).join("|");

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Recadrage sur les données serveur (position / destination / tracé) ; jamais sur une donnée effacée.
  useEffect(() => {
    if (!size.width || !size.height) return;
    const fit = fitView(points.length ? points : [DEFAULT_CENTER], size.width, size.height);
    // Un seul point (ou points confondus) : zoom de quartier, pas le maximum.
    const single = points.length > 0 && points.every((p) => p[0] === points[0][0] && p[1] === points[0][1]);
    if (fit && single) {
      const z = 15;
      setView({ zoom: z, center: project(points[0][0], points[0][1], z) });
    } else if (fit) setView({ zoom: points.length ? fit.zoom : 12, center: points.length ? fit.center : project(DEFAULT_CENTER[0], DEFAULT_CENTER[1], 12) });
    setFailed(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, size.width, size.height]);

  const tiles = view && size.width ? visibleTiles(view.center, view.zoom, size.width, size.height) : [];
  const toScreen = (lon: number, lat: number) => {
    if (!view) return { x: 0, y: 0 };
    const p = project(lon, lat, view.zoom);
    return { x: p.x - view.center.x + size.width / 2, y: p.y - view.center.y + size.height / 2 };
  };
  const zoomBy = (delta: number) =>
    setView((v) => {
      if (!v) return v;
      const z = clampZoom(v.zoom + delta);
      if (z === v.zoom) return v;
      const c = unproject(v.center.x, v.center.y, v.zoom);
      return { zoom: z, center: project(c.lon, c.lat, z) };
    });
  const recenter = () => {
    const fit = fitView(points.length ? points : [DEFAULT_CENTER], size.width, size.height);
    if (fit) setView(fit);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!view || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, cx: view.center.x, cy: view.center.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    setView((v) => (v ? { zoom: v.zoom, center: { x: d.cx - dx, y: d.cy - dy } } : v));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || !onPick || !view) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = view.center.x + (e.clientX - rect.left - size.width / 2);
    const y = view.center.y + (e.clientY - rect.top - size.height / 2);
    const p = unproject(x, y, view.zoom);
    onPick({ latitude: Math.round(p.lat * 1e6) / 1e6, longitude: Math.round(p.lon * 1e6) / 1e6 });
  };

  const metersPerPixel = view && position ? (156543.03392 * Math.cos((position.latitude * Math.PI) / 180)) / 2 ** view.zoom : 0;
  const routePath =
    route && view ? route.map(([lon, lat], i) => `${i ? "L" : "M"}${toScreen(lon, lat).x.toFixed(1)},${toScreen(lon, lat).y.toFixed(1)}`).join(" ") : "";
  const tilesDown = tiles.length > 0 && failed >= tiles.length;

  return (
    <figure className={styles.map} aria-labelledby={titleId}>
      <div
        ref={frame}
        className={`${styles.mapFrame} ${onPick ? styles.mapPickable : ""}`}
        role="img"
        aria-label={description}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
      >
        <div className={styles.tiles} aria-hidden="true">
          {tiles.map((t) => (
            <img
              key={`${t.z}/${t.x}/${t.y}/${t.left}`}
              src={t.url}
              alt=""
              width={256}
              height={256}
              loading="lazy"
              decoding="async"
              referrerPolicy="strict-origin-when-cross-origin"
              draggable={false}
              style={{ left: t.left, top: t.top }}
              onError={() => setFailed((n) => n + 1)}
            />
          ))}
        </div>
        {view && (
          <svg className={styles.overlay} width={size.width} height={size.height} aria-hidden="true">
            {routePath && (
              <>
                <path d={routePath} className={styles.routeCasing} />
                <path d={routePath} className={styles.routeLine} />
              </>
            )}
            {snappedEnd && destination && (
              <circle cx={toScreen(snappedEnd[0], snappedEnd[1]).x} cy={toScreen(snappedEnd[0], snappedEnd[1]).y} r={5} className={styles.snapMarker} />
            )}
            {destination && (
              <g transform={`translate(${toScreen(destination.longitude, destination.latitude).x},${toScreen(destination.longitude, destination.latitude).y})`}>
                <path d="M0,0 C-9,-12 -9,-24 0,-26 C9,-24 9,-12 0,0 Z" className={styles.destMarker} />
                <circle cy={-17} r={3.5} fill="#fff" />
              </g>
            )}
            {draft && (
              <g transform={`translate(${toScreen(draft.longitude, draft.latitude).x},${toScreen(draft.longitude, draft.latitude).y})`}>
                <path d="M0,0 C-9,-12 -9,-24 0,-26 C9,-24 9,-12 0,0 Z" className={styles.draftMarker} />
              </g>
            )}
            {position && (
              <>
                <circle
                  cx={toScreen(position.longitude, position.latitude).x}
                  cy={toScreen(position.longitude, position.latitude).y}
                  r={Math.max(8, metersPerPixel ? position.accuracyM / metersPerPixel : 8)}
                  className={styles.accuracyHalo}
                />
                <circle cx={toScreen(position.longitude, position.latitude).x} cy={toScreen(position.longitude, position.latitude).y} r={7} className={styles.positionMarker} />
              </>
            )}
          </svg>
        )}
        {tilesDown && <p className={styles.mapNotice}>Fond de carte indisponible — tracé affiché comme schéma.</p>}
      </div>
      <div className={styles.mapControls}>
        <button type="button" onClick={() => zoomBy(1)} disabled={!view || view.zoom >= MAX_ZOOM} aria-label="Zoomer">
          <Icon name="plus" size={18} />
        </button>
        <button type="button" onClick={() => zoomBy(-1)} disabled={!view || view.zoom <= MIN_ZOOM} aria-label="Dézoomer">
          <span aria-hidden="true" className={styles.minus}>−</span>
        </button>
        <button type="button" onClick={recenter} disabled={!view} aria-label="Recentrer la carte">
          <Icon name="navigate" size={18} />
        </button>
      </div>
      <figcaption id={titleId} className={styles.attribution}>
        Fond :{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          {OSM_CREDIT}
        </a>
        {routeAttribution ? <> · Itinéraire : {routeAttribution}</> : null}
      </figcaption>
    </figure>
  );
}
