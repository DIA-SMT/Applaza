"use client";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { SpaceRecord } from "@/types/domain";
import { statusColors, statusLabels } from "./status-badge";
import { useEffect } from "react";

function Recenter({ selected }: { selected?: SpaceRecord }) { const map = useMap(); useEffect(() => { if (selected?.latitude != null && selected.longitude != null) map.flyTo([selected.latitude, selected.longitude], 15, { duration: .8 }); }, [selected, map]); return null; }
export default function SpaceMap({ spaces, selected, onSelect }: { spaces: SpaceRecord[]; selected?: SpaceRecord; onSelect: (space: SpaceRecord) => void }) {
  return <MapContainer center={[-26.8304, -65.2145]} zoom={13} className="map" zoomControl={false}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <Recenter selected={selected} />
    {spaces.filter((space) => space.latitude != null && space.longitude != null).map((space) => <CircleMarker key={space.id} center={[space.latitude!, space.longitude!]} radius={selected?.id === space.id ? 12 : 9} pathOptions={{ color: "white", weight: 3, fillColor: statusColors[space.status], fillOpacity: 1 }} eventHandlers={{ click: () => onSelect(space) }}>
      <Tooltip direction="top" offset={[0, -8]}><strong>{space.name}</strong><br />{statusLabels[space.status]}</Tooltip>
    </CircleMarker>)}
  </MapContainer>;
}
