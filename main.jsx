import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";

const WA_CENTER = [47.4009, -120.7401];
const FEET_PER_METER = 3.28084;

const userLocationIcon = L.divIcon({
  className: "location-marker-wrapper",
  html: '<span class="location-marker"><span class="location-heading"></span><span class="location-dot"></span></span>',
  iconSize: [34, 34], iconAnchor: [17, 17]
});

function pointIcon(type) {
  return L.divIcon({ className: "route-point-wrapper", html: `<span class="route-point ${type}"></span>`, iconSize: [24, 24], iconAnchor: [12, 12] });
}

function formatDistance(meters) {
  if (meters < 304.8) return `${Math.max(25, Math.round((meters * FEET_PER_METER) / 25) * 25)} ft`;
  return `${(meters / 1609.344).toFixed(meters < 1609.344 ? 1 : 0)} mi`;
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function distanceMeters(a, b) {
  return L.latLng(a.lat, a.lon).distanceTo(L.latLng(b.lat, b.lon));
}

function placeFromResult(result) {
  const address = result.address || {};
  const street = [address.house_number, address.road || address.pedestrian].filter(Boolean).join(" ");
  const area = address.city || address.town || address.village || address.hamlet || address.county;
  const title = result.name || street || result.display_name.split(",").slice(0, 2).join(",");
  const detailParts = [street && street !== title ? street : null, area, address.state, address.postcode].filter(Boolean);
  return { label: result.display_name, title, detail: [...new Set(detailParts)].join(", "), lat: Number(result.lat), lon: Number(result.lon) };
}

function SearchField({ type, label, value, placeholder, places, isOpen, onChange, onFocus, onSearch, onSelect, onMyLocation }) {
  return <label className="search-field">{label}<div className="input-row"><input value={value} onChange={(event) => onChange(type, event.target.value)} onFocus={() => onFocus(type)} onKeyDown={(event) => event.key === "Enter" && onSearch(type)} placeholder={placeholder} autoComplete="off"/><button type="button" onClick={() => onSearch(type)}>Find</button></div>{isOpen && <div className="suggestions">{type === "start" && value !== "My location" && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onMyLocation}><strong>My location</strong><small>Use your device location</small></button>}{places.map((place) => <button type="button" key={`${place.lat}-${place.lon}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(type, place)}><strong>{place.title}</strong><small>{place.detail || place.label}</small></button>)}</div>}</label>;
}

function App() {
  const mapRef = useRef(null);
  const routeLayerRef = useRef(null);
  const startMarkerRef = useRef(null);
  const endMarkerRef = useRef(null);
  const userMarkerRef = useRef(null);
  const userPlaceRef = useRef(null);
  const useLocationAsStartRef = useRef(true);
  const searchTimerRef = useRef(null);
  const searchRequestRef = useRef(0);
  const navigationRef = useRef({ active: false, following: false, route: [], steps: [], announced: new Set(), currentStep: 0 });
  const overviewTimerRef = useRef(null);

  const [startQuery, setStartQuery] = useState("My location");
  const [endQuery, setEndQuery] = useState("");
  const [startPlace, setStartPlace] = useState(null);
  const [endPlace, setEndPlace] = useState(null);
  const [suggestions, setSuggestions] = useState({ start: [], end: [] });
  const [openSuggestions, setOpenSuggestions] = useState(null);
  const [routeSummary, setRouteSummary] = useState(null);
  const [directions, setDirections] = useState([]);
  const [nextTurn, setNextTurn] = useState(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [navigating, setNavigating] = useState(false);
  const [followMode, setFollowMode] = useState(false);
  const [status, setStatus] = useState("Searching for your location...");

  function speak(text) {
    if (!voiceEnabled || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  function updateNavigation(place, heading) {
    const nav = navigationRef.current;
    if (!nav.active || !nav.route.length || !nav.steps.length) return;

    let nearestIndex = 0;
    let nearestDistance = Infinity;
    nav.route.forEach((point, index) => {
      const distance = distanceMeters(place, point);
      if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
    });

    let stepIndex = nav.steps.findIndex((step, index) => index > 0 && step.waypointIndex > nearestIndex + 1);
    if (stepIndex < 0) stepIndex = nav.steps.length - 1;
    const step = nav.steps[stepIndex];
    const metersToTurn = distanceMeters(place, step.target);
    nav.currentStep = stepIndex;
    setNextTurn({ instruction: step.instruction, distance: metersToTurn });

    const earlyThreshold = Math.max(300, Math.min(800, (heading == null ? 500 : 550)));
    const promptKey = metersToTurn <= 55 ? `${stepIndex}-close` : metersToTurn <= earlyThreshold ? `${stepIndex}-early` : null;
    if (promptKey && !nav.announced.has(promptKey)) {
      nav.announced.add(promptKey);
      speak(`${metersToTurn <= 55 ? "In" : "In about"} ${formatDistance(metersToTurn)}, ${step.instruction}`);
    }

    if (nav.following && mapRef.current) mapRef.current.setView([place.lat, place.lon], 18, { animate: true });
    if (heading != null && userMarkerRef.current) {
      const element = userMarkerRef.current.getElement()?.querySelector(".location-heading");
      if (element) element.style.transform = `translate(-50%, -80%) rotate(${heading}deg)`;
    }
  }

  useEffect(() => {
    const map = L.map("map").setView(WA_CENTER, 7);
    mapRef.current = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    map.on("dragstart zoomstart", () => { if (navigationRef.current.active) { navigationRef.current.following = false; setFollowMode(false); } });

    let locationWatchId;
    if ("geolocation" in navigator) locationWatchId = navigator.geolocation.watchPosition((position) => {
      const place = { label: "My location", title: "My location", detail: "Current device location", lat: position.coords.latitude, lon: position.coords.longitude };
      userPlaceRef.current = place;
      if (useLocationAsStartRef.current) setStartPlace(place);
      if (!userMarkerRef.current) userMarkerRef.current = L.marker([place.lat, place.lon], { icon: userLocationIcon, zIndexOffset: 1000 }).addTo(map).bindPopup("Your location");
      else userMarkerRef.current.setLatLng([place.lat, place.lon]);
      updateNavigation(place, position.coords.heading);
      setStatus((current) => current === "Searching for your location..." ? "Your location is ready." : current);
    }, (error) => setStatus(error.code === error.PERMISSION_DENIED ? "Location permission is blocked. Enter a starting place or allow location in browser settings." : "Your location is unavailable right now."), { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    else setStatus("This browser does not support location.");

    return () => { if (locationWatchId !== undefined) navigator.geolocation.clearWatch(locationWatchId); clearTimeout(searchTimerRef.current); clearTimeout(overviewTimerRef.current); window.speechSynthesis?.cancel(); map.remove(); };
  }, []);

  async function searchPlaces(query, limit = 6) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", `${query}, Washington`); url.searchParams.set("format", "jsonv2"); url.searchParams.set("limit", String(limit)); url.searchParams.set("countrycodes", "us"); url.searchParams.set("addressdetails", "1"); url.searchParams.set("namedetails", "1"); url.searchParams.set("viewbox", "-124.85,49.05,-116.85,45.5");
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Place search is unavailable right now.");
    return response.json();
  }

  function requestSuggestions(type, value) {
    if (type === "start") { setStartQuery(value); if (value !== "My location") useLocationAsStartRef.current = false; } else setEndQuery(value);
    setOpenSuggestions(type); clearTimeout(searchTimerRef.current);
    if (value.trim().length < 2 || value === "My location") return setSuggestions((current) => ({ ...current, [type]: [] }));
    const requestId = ++searchRequestRef.current;
    searchTimerRef.current = setTimeout(async () => { try { const results = await searchPlaces(value.trim()); if (requestId === searchRequestRef.current) setSuggestions((current) => ({ ...current, [type]: results.map(placeFromResult) })); } catch (error) { setStatus(error.message); } }, 500);
  }

  function setMapMarker(markerRef, place, label, type) {
    if (!markerRef.current) markerRef.current = L.marker([place.lat, place.lon], { icon: pointIcon(type) }).addTo(mapRef.current); else markerRef.current.setLatLng([place.lat, place.lon]);
    markerRef.current.bindPopup(`<strong>${label}</strong><br>${place.label}`).openPopup();
  }

  function choosePlace(type, place) {
    if (type === "start") { useLocationAsStartRef.current = false; setStartQuery(place.label); setStartPlace(place); setMapMarker(startMarkerRef, place, "Start", "start"); }
    else { setEndQuery(place.label); setEndPlace(place); setMapMarker(endMarkerRef, place, "Destination", "end"); }
    setOpenSuggestions(null); setSuggestions((current) => ({ ...current, [type]: [] })); mapRef.current.setView([place.lat, place.lon], 14); setStatus("Place selected.");
  }

  function useMyLocation() {
    if (!userPlaceRef.current) return setStatus("Allow location access, then try My location again.");
    useLocationAsStartRef.current = true; setStartQuery("My location"); setStartPlace(userPlaceRef.current); startMarkerRef.current?.remove(); startMarkerRef.current = null; setOpenSuggestions(null); mapRef.current.setView([userPlaceRef.current.lat, userPlaceRef.current.lon], 14); setStatus("Using your location as the starting point.");
  }

  async function handleSearch(type) {
    try { const query = type === "start" ? startQuery : endQuery; if (type === "start" && query === "My location") return useMyLocation(); if (!query.trim()) return setStatus("Enter a place first."); setStatus("Searching..."); const results = await searchPlaces(query.trim(), 1); if (!results.length) throw new Error(`No Washington result found for "${query}".`); choosePlace(type, placeFromResult(results[0])); } catch (error) { setStatus(error.message); }
  }

  function startNavigation() {
    if (!navigationRef.current.route.length) return;
    navigationRef.current.active = true; navigationRef.current.following = true; navigationRef.current.announced = new Set(); setNavigating(true); setFollowMode(true);
    const place = userPlaceRef.current || startPlace; if (place) { mapRef.current.setView([place.lat, place.lon], 18, { animate: true }); updateNavigation(place, null); }
    setStatus("Navigation started. Voice guidance will announce upcoming turns.");
  }

  function recenter() {
    navigationRef.current.following = true; setFollowMode(true); const place = userPlaceRef.current || startPlace; if (place) mapRef.current.setView([place.lat, place.lon], 18, { animate: true });
  }

  async function handleRoute() {
    try {
      if (!startPlace || !endPlace) return setStatus("Select both a start and destination first.");
      setStatus("Calculating route...");
      const response = await fetch("/.netlify/functions/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coordinates: [[startPlace.lon, startPlace.lat], [endPlace.lon, endPlace.lat]] }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Route request failed.");
      const feature = data.features?.[0]; if (!feature) throw new Error("No route was returned.");
      const route = feature.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
      routeLayerRef.current?.remove(); routeLayerRef.current = L.polyline(route.map((point) => [point.lat, point.lon]), { color: "#7c3aed", weight: 7, opacity: 0.9 }).addTo(mapRef.current); mapRef.current.fitBounds(routeLayerRef.current.getBounds(), { padding: [40, 40] });
      const segment = feature.properties.segments[0];
      const steps = segment.steps.map((step, index) => ({ id: index, instruction: step.instruction, distance: step.distance, waypointIndex: step.way_points?.[0] || 0, target: route[step.way_points?.[0] || 0] }));
      navigationRef.current = { active: false, following: false, route, steps, announced: new Set(), currentStep: 0 };
      setDirections(steps); setRouteSummary({ distance: segment.distance, duration: segment.duration }); setNextTurn(null); setNavigating(false); setFollowMode(false); setStatus("Route ready. Showing the full route for 5 seconds.");
      clearTimeout(overviewTimerRef.current); overviewTimerRef.current = setTimeout(startNavigation, 5000);
    } catch (error) { setStatus(error.message); }
  }

  return <div className={`app-shell ${navigating ? "is-navigating" : ""}`}>
    <aside className="sidebar"><div className="brand"><div className="brand-mark">WA</div><div><h1>WA Navigator</h1><p>Washington-focused routing</p></div></div>
      <div className="card route-card"><SearchField type="start" label="Start" value={startQuery} placeholder="My location or a place" places={suggestions.start} isOpen={openSuggestions === "start"} onChange={requestSuggestions} onFocus={setOpenSuggestions} onSearch={handleSearch} onSelect={choosePlace} onMyLocation={useMyLocation}/><SearchField type="end" label="Destination" value={endQuery} placeholder="Search a place or address" places={suggestions.end} isOpen={openSuggestions === "end"} onChange={requestSuggestions} onFocus={setOpenSuggestions} onSearch={handleSearch} onSelect={choosePlace} onMyLocation={useMyLocation}/><button className="primary-button" onClick={handleRoute}>Get route</button>{routeSummary && <button className="start-button" onClick={startNavigation}>Start route</button>}<p className="status" aria-live="polite">{status}</p></div>
      <div className="card voice-card"><div><h2>Voice guidance</h2><p className="muted">Announces turns as you approach them.</p></div><button className={voiceEnabled ? "toggle-button active" : "toggle-button"} onClick={() => setVoiceEnabled(!voiceEnabled)}>{voiceEnabled ? "On" : "Off"}</button></div>
      {routeSummary && <div className="card route-summary"><h2>Route summary</h2><div className="summary-grid"><div><span>ETA</span><strong>{formatDuration(routeSummary.duration)}</strong></div><div><span>Distance</span><strong>{formatDistance(routeSummary.distance)}</strong></div></div></div>}
      <div className="card directions-card"><h2>Directions</h2>{directions.length === 0 ? <p className="muted">Directions will appear after you calculate a route.</p> : <ol>{directions.map((step) => <li key={step.id}><span>{step.instruction}</span><small>{formatDistance(step.distance)}</small></li>)}</ol>}</div>
    </aside>
    <main className="map-wrap"><div id="map"/>{navigating && nextTurn && <div className="next-turn-card"><strong>{formatDistance(nextTurn.distance)}</strong><span>{nextTurn.instruction}</span></div>}{navigating && <button className={`recenter-button ${followMode ? "following" : ""}`} onClick={recenter} aria-label="Recenter on your location">◎</button>}</main>
  </div>;
}

createRoot(document.getElementById("root")).render(<App/>);
