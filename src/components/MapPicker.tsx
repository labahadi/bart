'use client';

// "Pick on map" for meetups: a campus map where you tap to drop a pin.
// Outside campus is greyed out and you can't pan far past it. A pin on campus snaps to the
// nearest real place; a pin off campus turns pink and can't be picked.
// The map is Leaflet with CARTO/OpenStreetMap tiles (no key needed), loaded only when opened.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { CAMPUS, onCampus } from '@/lib/campus';
import { Icon } from './Icon';

export type MapPlace = { placeId: string; name: string; detail: string };

const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet';
let leafletLoading: Promise<any> | null = null;
function loadLeaflet(): Promise<any> {
  if ((window as any).L) return Promise.resolve((window as any).L);
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = `${LEAFLET}.css`;
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = `${LEAFLET}.js`; js.async = true;
    js.onload = () => resolve((window as any).L);
    js.onerror = () => { leafletLoading = null; reject(new Error('map')); };
    document.head.appendChild(js);
  });
  return leafletLoading;
}

const pinHtml = (color: string) => `
  <svg width="40" height="50" viewBox="-20 -46 40 50" style="overflow:visible">
    <ellipse cx="0" cy="2" rx="9" ry="3.5" fill="rgba(0,0,0,.2)"/>
    <path d="M0 0 C-4 -12 -17 -20 -17 -33 A17 17 0 1 1 17 -33 C17 -20 4 -12 0 0Z" fill="${color}" stroke="#fff" stroke-width="3"/>
    <circle cx="0" cy="-33" r="6.5" fill="#fff"/>
  </svg>`;

type State =
  | { kind: 'idle' }
  | { kind: 'looking' }
  | { kind: 'found'; place: MapPlace }
  | { kind: 'off' }
  | { kind: 'error'; message: string };

export function MapPicker({ onPick, onClose }: { onPick: (p: MapPlace) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const pin = useRef<any>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [failed, setFailed] = useState(false);
  const tap = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !box.current || map.current) return;
      const campus = L.latLngBounds([CAMPUS.south, CAMPUS.west], [CAMPUS.north, CAMPUS.east]);
      const m = L.map(box.current, {
        zoomControl: false, attributionControl: true,
        maxBounds: campus.pad(0.35), maxBoundsViscosity: 1, minZoom: 15, maxZoom: 19,
      }).setView([CAMPUS.center.lat, CAMPUS.center.lng], 16);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd', maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      }).addTo(m);
      // Grey out everything that isn't campus, and outline campus
      const world = [[-90, -180], [-90, 180], [90, 180], [90, -180]];
      const hole = [[CAMPUS.south, CAMPUS.west], [CAMPUS.north, CAMPUS.west], [CAMPUS.north, CAMPUS.east], [CAMPUS.south, CAMPUS.east]];
      L.polygon([world, hole], { stroke: false, fillColor: '#1B2A8C', fillOpacity: 0.28, interactive: false }).addTo(m);
      L.rectangle(campus, { color: '#1B2A8C', weight: 2.5, dashArray: '8 6', fill: false, interactive: false }).addTo(m);
      m.on('click', (e: any) => drop(L, e.latlng.lat, e.latlng.lng));
      map.current = m;
    }).catch(() => setFailed(true));
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function drop(L: any, lat: number, lng: number) {
    const id = (tap.current ?? 0) + 1;
    tap.current = id;
    const good = onCampus(lat, lng);
    const icon = L.divIcon({ html: pinHtml(good ? '#3355FF' : '#FF2E92'), className: 'map-pin', iconSize: [40, 50], iconAnchor: [20, 46] });
    if (pin.current) pin.current.setLatLng([lat, lng]).setIcon(icon);
    else pin.current = L.marker([lat, lng], { icon, interactive: false }).addTo(map.current);
    if (!good) { setState({ kind: 'off' }); return; }

    setState({ kind: 'looking' });
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(`/api/places/nearby?lat=${lat}&lng=${lng}`, {
      headers: { authorization: `Bearer ${sess.session?.access_token ?? ''}` },
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (id !== tap.current) return; // a newer tap already won
    if (!res?.ok) { setState(json.offCampus ? { kind: 'off' } : { kind: 'error', message: json.error ?? "Couldn't look up that spot." }); return; }
    // Snap the pin onto the place we found
    if (json.lat != null) pin.current?.setLatLng([json.lat, json.lng]);
    setState({ kind: 'found', place: { placeId: json.placeId, name: json.name, detail: json.detail } });
  }

  const off = state.kind === 'off';
  return (
    <div className="map-picker" role="dialog" aria-label="Pick a spot on the map">
      <div className="map-picker-top">
        <button className="icon-btn" onClick={onClose} aria-label="Back"><Icon name="back" size={20} /></button>
        <b style={{ fontSize: 20 }}>Pick a spot</b>
      </div>
      <div ref={box} className="map-picker-map" />
      {state.kind === 'idle' && !failed && <div className="map-picker-hint">Tap anywhere inside the dashed line</div>}

      <div className="map-picker-sheet">
        <span className="map-picker-grab" />
        {failed ? (
          <p className="body" style={{ margin: 0 }}>The map didn&apos;t load. Check your connection, or search for a place instead.</p>
        ) : state.kind === 'idle' ? (
          <p className="body" style={{ margin: 0 }}>Drop a pin on a building, cafe or landmark on campus.</p>
        ) : (
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <span className={`map-picker-badge${off || state.kind === 'error' ? ' bad' : ''}`}>
              {off || state.kind === 'error' ? <b>!</b> : <Icon name="pin" size={20} />}
            </span>
            <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
              <b style={{ fontSize: 17 }}>
                {state.kind === 'looking' ? 'Finding that spot…' : state.kind === 'found' ? state.place.name
                  : off ? "That's off campus" : 'Try another spot'}
              </b>
              <span className="meta" style={{ fontSize: 13 }}>
                {state.kind === 'found' ? state.place.detail
                  : off ? 'Pick somewhere between 30th & 40th, Market & Baltimore'
                  : state.kind === 'error' ? state.message : 'One sec'}
              </span>
            </span>
          </div>
        )}
        <button className="btn pink" disabled={state.kind !== 'found'}
          onClick={() => state.kind === 'found' && onPick(state.place)}>
          {off ? 'Pick a spot on campus' : 'Meet here'}
        </button>
      </div>
    </div>
  );
}
