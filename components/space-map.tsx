"use client";
import { CircleMarker, MapContainer, ScaleControl, TileLayer, Tooltip, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import type { SpaceRecord } from "@/types/domain";
import { useEffect } from "react";

function Recenter({ selected }: { selected?: SpaceRecord }) { const map = useMap(); useEffect(() => { if (selected?.latitude != null && selected.longitude != null) map.flyTo([selected.latitude, selected.longitude], 15, { duration: .8 }); }, [selected, map]); return null; }
function FitVisibleSpaces({ spaces }: { spaces: SpaceRecord[] }) { const map = useMap(); const signature = spaces.map((space) => space.id).join("|"); useEffect(() => { const points = spaces.filter((space) => space.latitude != null && space.longitude != null).map((space) => [space.latitude!, space.longitude!] as [number, number]); if (points.length > 1) map.fitBounds(points, { padding: [48, 48], maxZoom: 14 }); else if (points.length === 1) map.flyTo(points[0], 15, { duration: .5 }); }, [signature, map, spaces]); return null; }
function LocationPicker({ enabled, onPick }: { enabled: boolean; onPick?: (lat: number, lng: number) => void }) { useMapEvents({ click: (event) => { if (enabled) onPick?.(event.latlng.lat, event.latlng.lng); } }); return null; }
export default function SpaceMap({ spaces, selected, onSelect, locationMode = false, draftLocation, onLocationPick, markerColors }: { spaces: SpaceRecord[]; selected?: SpaceRecord; onSelect: (space: SpaceRecord) => void; locationMode?: boolean; draftLocation?: { latitude: number; longitude: number }; onLocationPick?: (lat: number, lng: number) => void; markerColors?: Record<string, string> }) {
  return <MapContainer center={[-26.8304, -65.2145]} zoom={13} className="map" zoomControl={false}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <Recenter selected={selected} />
    <FitVisibleSpaces spaces={spaces} />
    <ZoomControl position="bottomright" />
    <ScaleControl position="bottomleft" imperial={false} />
    <LocationPicker enabled={locationMode} onPick={onLocationPick} />
    {draftLocation && <CircleMarker center={[draftLocation.latitude, draftLocation.longitude]} radius={11} pathOptions={{ color: "#12263f", weight: 3, fillColor: "#facc15", fillOpacity: 1 }}><Tooltip permanent direction="top">Nueva ubicación</Tooltip></CircleMarker>}
    {spaces.filter((space) => space.latitude != null && space.longitude != null).map((space) => <CircleMarker key={space.id} center={[space.latitude!, space.longitude!]} radius={selected?.id === space.id ? 12 : 9} pathOptions={{ color: "white", weight: 3, fillColor: markerColors?.[space.id] ?? "#64748b", fillOpacity: 1 }} eventHandlers={{ click: () => onSelect(space) }}>
      <Tooltip direction="top" offset={[0, -8]}><strong>{space.name}</strong><br />{space.source_type || space.type}</Tooltip>
    </CircleMarker>)}
  </MapContainer>;
}
