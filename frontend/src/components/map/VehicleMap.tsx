'use client';

import { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Vehicle, Route } from '@/lib/api-client';

// Fix default Leaflet marker icon broken by Webpack
const markerIcon = L.divIcon({
  className: '',
  html: '<div style="width:12px;height:12px;background:#DA291C;border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.5)"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
  popupAnchor: [0, -8],
});

interface VehicleMapProps {
  vehicles: Vehicle[];
  routes?: Route[];
  error?: string | null;
  centerLat?: number;
  centerLon?: number;
  zoom?: number;
}

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function VehicleMap({
  vehicles,
  routes = [],
  error,
  centerLat = 42.3601,
  centerLon = -71.0589,
  zoom = 13,
}: VehicleMapProps) {
  const routeLines = useMemo(() => {
    return routes
      .filter((r) => r.shape?.coordinates && r.shape.coordinates.length > 1)
      .map((r) => ({
        id: r.routeId,
        color: r.color ? `#${r.color}` : '#DA291C',
        positions: r.shape!.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]),
      }));
  }, [routes]);

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      {error && (
        <Alert
          severity="warning"
          sx={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, maxWidth: 400 }}
        >
          Live tracking temporarily unavailable
        </Alert>
      )}

      <MapContainer
        center={[centerLat, centerLon]}
        zoom={zoom}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />

        {routeLines.map((line) => (
          <Polyline key={line.id} positions={line.positions} color={line.color} weight={3} opacity={0.6} />
        ))}

        {vehicles.map((v) => (
          <Marker key={v.vehicleId} position={[v.latitude, v.longitude]} icon={markerIcon}>
            <Popup>
              <Typography variant="body2" fontWeight={700}>
                {v.label ?? v.vehicleId}
              </Typography>
              {v.routeId && (
                <Typography variant="caption" display="block">
                  Route {v.routeId}
                </Typography>
              )}
              <Typography variant="caption" display="block" color="text.secondary">
                Updated {formatUpdatedAt(v.updatedAt)}
              </Typography>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </Box>
  );
}
