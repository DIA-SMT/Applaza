"use client";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { Circle, CircleMarker, MapContainer, Marker, ScaleControl, TileLayer, Tooltip, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import type { SpaceRecord } from "@/types/domain";

const CLUSTER_MAX_ZOOM = 14;
const CLUSTER_MIN_SIZE = 3;

function Recenter({ selected }: { selected?: SpaceRecord }) { const map = useMap(); useEffect(() => { if (selected?.latitude != null && selected.longitude != null) map.flyTo([selected.latitude, selected.longitude], 15, { duration: .8 }); }, [selected, map]); return null; }
function FitVisibleSpaces({ spaces }: { spaces: SpaceRecord[] }) { const map = useMap(); const signature = spaces.map((space) => space.id).join("|"); useEffect(() => { const points = spaces.filter((space) => space.latitude != null && space.longitude != null).map((space) => [space.latitude!, space.longitude!] as [number, number]); if (points.length > 1) map.fitBounds(points, { padding: [48, 48], maxZoom: 14 }); else if (points.length === 1) map.flyTo(points[0], 15, { duration: .5 }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, map]); return null; }
function LocationPicker({ enabled, onPick }: { enabled: boolean; onPick?: (lat: number, lng: number) => void }) { useMapEvents({ click: (event) => { if (enabled) onPick?.(event.latlng.lat, event.latlng.lng); } }); return null; }
function FlyToUser({ location }: { location?: { latitude: number; longitude: number; accuracy: number } }) { const map = useMap(); useEffect(() => { if (location) map.flyTo([location.latitude, location.longitude], Math.max(map.getZoom(), 16), { duration: .8 }); }, [location, map]); return null; }
function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) { const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) }); return null; }

function ClusterLayer({ clusters, markerColors }: { clusters: SpaceRecord[][]; markerColors?: Record<string, string> }) {
  const map = useMap();
  return <>{clusters.map((group) => {
    const latitude = group.reduce((sum, space) => sum + space.latitude!, 0) / group.length;
    const longitude = group.reduce((sum, space) => sum + space.longitude!, 0) / group.length;
    const counts = new Map<string, number>();
    for (const space of group) { const color = markerColors?.[space.id] ?? "#64748b"; counts.set(color, (counts.get(color) ?? 0) + 1); }
    const dominant = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
    const size = group.length >= 30 ? 46 : group.length >= 10 ? 40 : 34;
    const icon = L.divIcon({ className: "map-cluster", html: `<span style="background:${dominant}">${group.length}</span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    return <Marker key={`${group[0].id}-${group.length}`} position={[latitude, longitude]} icon={icon} eventHandlers={{ click: () => map.flyTo([latitude, longitude], Math.min(map.getZoom() + 2, 16), { duration: .6 }) }} />;
  })}</>;
}

export default function SpaceMap({ spaces, selected, onSelect, locationMode = false, draftLocation, onLocationPick, markerColors, userLocation }: { spaces: SpaceRecord[]; selected?: SpaceRecord; onSelect: (space: SpaceRecord) => void; locationMode?: boolean; draftLocation?: { latitude: number; longitude: number }; onLocationPick?: (lat: number, lng: number) => void; markerColors?: Record<string, string>; userLocation?: { latitude: number; longitude: number; accuracy: number } }) {
  const [zoom, setZoom] = useState(13);
  const draftIcon = useMemo(() => L.divIcon({ className: "map-draft-marker", html: "<i></i>", iconSize: [22, 22], iconAnchor: [11, 11] }), []);
  const { clusters, singles } = useMemo(() => {
    const mapped = spaces.filter((space) => space.latitude != null && space.longitude != null);
    if (zoom >= CLUSTER_MAX_ZOOM) return { clusters: [] as SpaceRecord[][], singles: mapped };
    const cell = (80 / 256) * (360 / Math.pow(2, zoom));
    const buckets = new Map<string, SpaceRecord[]>();
    for (const space of mapped) { const key = `${Math.floor(space.latitude! / cell)}|${Math.floor(space.longitude! / cell)}`; const bucket = buckets.get(key); if (bucket) bucket.push(space); else buckets.set(key, [space]); }
    const clusters: SpaceRecord[][] = []; const singles: SpaceRecord[] = [];
    for (const group of buckets.values()) { if (group.length >= CLUSTER_MIN_SIZE) clusters.push(group); else singles.push(...group); }
    return { clusters, singles };
  }, [spaces, zoom]);
  return <MapContainer center={[-26.8304, -65.2145]} zoom={13} className="map" zoomControl={false}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
    <Recenter selected={selected} />
    <FitVisibleSpaces spaces={spaces} />
    <ZoomControl position="bottomright" />
    <ScaleControl position="bottomleft" imperial={false} />
    <LocationPicker enabled={locationMode} onPick={onLocationPick} />
    <FlyToUser location={userLocation} />
    <ZoomWatcher onZoom={setZoom} />
    {userLocation && <Circle center={[userLocation.latitude, userLocation.longitude]} radius={Math.max(userLocation.accuracy, 15)} pathOptions={{ color: "#0166ff", weight: 1, fillColor: "#0166ff", fillOpacity: .08 }} />}
    {userLocation && <CircleMarker center={[userLocation.latitude, userLocation.longitude]} radius={7} pathOptions={{ color: "white", weight: 3, fillColor: "#0166ff", fillOpacity: 1 }}><Tooltip direction="top" offset={[0, -8]}>Tu ubicación</Tooltip></CircleMarker>}
    <ClusterLayer clusters={clusters} markerColors={markerColors} />
    {singles.map((space) => <CircleMarker key={space.id} center={[space.latitude!, space.longitude!]} radius={selected?.id === space.id ? 12 : 9} pathOptions={{ color: "white", weight: 3, fillColor: markerColors?.[space.id] ?? "#64748b", fillOpacity: 1 }} eventHandlers={{ click: () => onSelect(space) }}>
      <Tooltip direction="top" offset={[0, -8]}><strong>{space.name}</strong><br />{space.source_type || space.type}</Tooltip>
    </CircleMarker>)}
    {draftLocation && <Marker position={[draftLocation.latitude, draftLocation.longitude]} icon={draftIcon} draggable eventHandlers={{ dragend: (event) => { const point = (event.target as L.Marker).getLatLng(); onLocationPick?.(point.lat, point.lng); } }}><Tooltip permanent direction="top" offset={[0, -14]}>Nueva ubicación · arrastrá para ajustar</Tooltip></Marker>}
  </MapContainer>;
}
