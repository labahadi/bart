// Penn's campus, for meetup places. Keep these numbers in sync with on_campus() in
// supabase/migrations/0012_map_places.sql (the database checks them too).
export const CAMPUS = {
  // Roughly 30th St to 40th St (plus a block), Market St to Baltimore Ave
  south: 39.9460, north: 39.9585, west: -75.2060, east: -75.1815,
  // Walking times are measured from here
  center: { lat: 39.9516, lng: -75.1979, label: 'Locust Walk at 37th' },
};

export const onCampus = (lat: number, lng: number) =>
  lat >= CAMPUS.south && lat <= CAMPUS.north && lng >= CAMPUS.west && lng <= CAMPUS.east;

// Directions in the phone's own maps app (Apple Maps on iPhone, Google Maps elsewhere)
export function directionsUrl(place: { name: string; lat?: number | null; lng?: number | null }) {
  const isApple = typeof navigator !== 'undefined' && /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const q = place.lat != null && place.lng != null ? `${place.lat},${place.lng}` : `${place.name}, University of Pennsylvania, Philadelphia`;
  return isApple
    ? `https://maps.apple.com/?daddr=${encodeURIComponent(q)}&dirflg=w&q=${encodeURIComponent(place.name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}&travelmode=walking`;
}
