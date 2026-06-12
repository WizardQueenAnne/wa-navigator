import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";

const WA_CENTER = [47.4009, -120.7401];

const userLocationIcon = L.divIcon({
  className: "location-marker-wrapper",
  html: '<span class="location-marker"><span></span></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14]
});

function pointIcon(type) {
  return L.divIcon({
    className: "route-point-wrapper",
    html: `<span class="route-point ${type}"></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
}

function formatDistance(meters) {
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function placeFromResult(result) {
  return { label: result.display_name, lat: Number(result.lat), lon: Number(result.lon) };
}

function SearchField({ type, label, value, placeholder, places, isOpen, onChange, onFocus, onSearch, onSelect, onMyLocation }) {
  return (
    <label className="search-field">
      {label}
      <div className="input-row">
        <input
          value={value}
          onChange={(event) => onChange(type, event.target.value)}
          onFocus={() => onFocus(type)}
          onKeyDown={(event) => event.key === "Enter" && onSearch(type)}
          placeholder={placeholder}
          autoComplete="off"
        />
        <button type="button" onClick={() => onSearch(type)}>Find</button>
      </div>
      {isOpen && (
        <div className="suggestions">
          {type === "start" && value !== "My location" && (
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onMyLocation}>
              <strong>My location</strong><small>Use your device location</small>
            </button>
          )}
          {places.map((place) => (
            <button type="button" key={`${place.lat}-${place.lon}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(type, place)}>
              <strong>{place.label.split(",")[0]}</strong><small>{place.label}</small>
            </button>
          ))}
        </div>
      )}
    </label>
  );
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

  const [startQuery, setStartQuery] = useState("My location");
  const [endQuery, setEndQuery] = useState("");
  const [startPlace, setStartPlace] = useState(null);
  const [endPlace, setEndPlace] = useState(null);
  const [suggestions, setSuggestions] = useState({ start: [], end: [] });
  const [openSuggestions, setOpenSuggestions] = useState(null);
  const [routeSummary, setRouteSummary] = useState(null);
  const [directions, setDirections] = useState([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [status, setStatus] = useState("Searching for your location...");

  useEffect(() => {
    const map = L.map("map").setView(WA_CENTER, 7);
    mapRef.current = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    let locationWatchId;
    if ("geolocation" in navigator) {
      locationWatchId = navigator.geolocation.watchPosition(
        (position) => {
          const place = { label: "My location", lat: position.coords.latitude, lon: position.coords.longitude };
          userPlaceRef.current = place;
          if (useLocationAsStartRef.current) setStartPlace(place);

          if (!userMarkerRef.current) {
            userMarkerRef.current = L.marker([place.lat, place.lon], { icon: userLocationIcon, zIndexOffset: 1000 }).addTo(map).bindPopup("Your location");
          } else {
            userMarkerRef.current.setLatLng([place.lat, place.lon]);
          }
          setStatus((current) => current === "Searching for your location..." ? "Your location is ready." : current);
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) setStatus("Location permission is blocked. You can enter a starting place instead.");
          else setStatus("Your location is unavailable right now. You can still enter a starting place.");
        },
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
      );
    } else {
      setStatus("This browser does not support location. Enter a starting place instead.");
    }

    return () => {
      if (locationWatchId !== undefined) navigator.geolocation.clearWatch(locationWatchId);
      clearTimeout(searchTimerRef.current);
      window.speechSynthesis?.cancel();
      map.remove();
    };
  }, []);

  async function searchPlaces(query, limit = 6) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", `${query}, Washington`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("countrycodes", "us");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("viewbox", "-124.85,49.05,-116.85,45.5");
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Place search is unavailable right now.");
    return response.json();
  }

  function requestSuggestions(type, value) {
    if (type === "start") {
      setStartQuery(value);
      if (value !== "My location") useLocationAsStartRef.current = false;
    } else setEndQuery(value);
    setOpenSuggestions(type);
    clearTimeout(searchTimerRef.current);

    if (value.trim().length < 2 || value === "My location") {
      setSuggestions((current) => ({ ...current, [type]: [] }));
      return;
    }

    const requestId = ++searchRequestRef.current;
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchPlaces(value.trim());
        if (requestId === searchRequestRef.current) {
          setSuggestions((current) => ({ ...current, [type]: results.map(placeFromResult) }));
        }
      } catch (error) {
        if (requestId === searchRequestRef.current) setStatus(error.message);
      }
    }, 500);
  }

  function setMapMarker(markerRef, place, label, type) {
    if (!markerRef.current) markerRef.current = L.marker([place.lat, place.lon], { icon: pointIcon(type) }).addTo(mapRef.current);
    else markerRef.current.setLatLng([place.lat, place.lon]);
    markerRef.current.bindPopup(`<strong>${label}</strong><br>${place.label}`).openPopup();
  }

  function choosePlace(type, place) {
    if (type === "start") {
      useLocationAsStartRef.current = false;
      setStartQuery(place.label);
      setStartPlace(place);
      setMapMarker(startMarkerRef, place, "Start", "start");
    } else {
      setEndQuery(place.label);
      setEndPlace(place);
      setMapMarker(endMarkerRef, place, "Destination", "end");
    }
    setOpenSuggestions(null);
    setSuggestions((current) => ({ ...current, [type]: [] }));
    mapRef.current.setView([place.lat, place.lon], 14);
    setStatus("Place selected.");
  }

  function useMyLocation() {
    if (!userPlaceRef.current) {
      setStatus("Allow location access in your browser, then try My location again.");
      return;
    }
    useLocationAsStartRef.current = true;
    setStartQuery("My location");
    setStartPlace(userPlaceRef.current);
    startMarkerRef.current?.remove();
    startMarkerRef.current = null;
    setOpenSuggestions(null);
    mapRef.current.setView([userPlaceRef.current.lat, userPlaceRef.current.lon], 14);
    userMarkerRef.current?.openPopup();
    setStatus("Using your location as the starting point.");
  }

  async function handleSearch(type) {
    try {
      const query = type === "start" ? startQuery : endQuery;
      if (type === "start" && query === "My location") return useMyLocation();
      if (!query.trim()) return setStatus("Enter an address or place name first.");
      setStatus("Searching...");
      const results = await searchPlaces(query.trim(), 1);
      if (!results.length) throw new Error(`No Washington result found for "${query}".`);
      choosePlace(type, placeFromResult(results[0]));
    } catch (error) {
      setStatus(error.message);
    }
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) return setStatus("Voice directions are not supported by this browser.");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  async function handleRoute() {
    try {
      if (!startPlace || !endPlace) return setStatus("Select both a start and destination first.");
      setStatus("Calculating route...");
      const response = await fetch("/.netlify/functions/route", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: [[startPlace.lon, startPlace.lat], [endPlace.lon, endPlace.lat]] })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Route request failed.");
      const feature = data.features?.[0];
      if (!feature) throw new Error("No route was returned.");

      routeLayerRef.current?.remove();
      routeLayerRef.current = L.polyline(feature.geometry.coordinates.map(([lon, lat]) => [lat, lon]), { color: "#7c3aed", weight: 7, opacity: 0.9 }).addTo(mapRef.current);
      mapRef.current.fitBounds(routeLayerRef.current.getBounds(), { padding: [40, 40] });
      const segment = feature.properties.segments[0];
      const nextDirections = segment.steps.map((step, index) => ({ id: index, instruction: step.instruction, distance: step.distance }));
      setRouteSummary({ distance: segment.distance, duration: segment.duration });
      setDirections(nextDirections);
      setStatus("Route ready.");
      if (voiceEnabled && nextDirections.length) speak(`Route ready. ${nextDirections[0].instruction}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">WA</div><div><h1>WA Navigator</h1><p>Washington-focused routing</p></div></div>
        <div className="card route-card">
          <SearchField type="start" label="Start" value={startQuery} placeholder="My location or a place" places={suggestions.start} isOpen={openSuggestions === "start"} onChange={requestSuggestions} onFocus={setOpenSuggestions} onSearch={handleSearch} onSelect={choosePlace} onMyLocation={useMyLocation} />
          <SearchField type="end" label="Destination" value={endQuery} placeholder="Search a place or address" places={suggestions.end} isOpen={openSuggestions === "end"} onChange={requestSuggestions} onFocus={setOpenSuggestions} onSearch={handleSearch} onSelect={choosePlace} onMyLocation={useMyLocation} />
          <button className="primary-button" onClick={handleRoute}>Get route</button>
          <p className="status" aria-live="polite">{status}</p>
        </div>
        <div className="card voice-card"><div><h2>Voice directions</h2><p className="muted">Uses your browser's built-in voice.</p></div><button className={voiceEnabled ? "toggle-button active" : "toggle-button"} onClick={() => { setVoiceEnabled(!voiceEnabled); if (!voiceEnabled) speak("Voice directions enabled."); }} aria-pressed={voiceEnabled}>{voiceEnabled ? "On" : "Off"}</button><button className="secondary-button" onClick={() => directions.length ? speak(directions.map((step) => step.instruction).join(". Then, ")) : setStatus("Calculate a route before reading directions.")} disabled={!directions.length}>Read route</button></div>
        {routeSummary && <div className="card"><h2>Route summary</h2><div className="summary-grid"><div><span>ETA</span><strong>{formatDuration(routeSummary.duration)}</strong></div><div><span>Distance</span><strong>{formatDistance(routeSummary.distance)}</strong></div></div></div>}
        <div className="card"><h2>Directions</h2>{directions.length === 0 ? <p className="muted">Directions will appear after you calculate a route.</p> : <ol>{directions.map((step) => <li key={step.id}><span>{step.instruction}</span><small>{formatDistance(step.distance)}</small></li>)}</ol>}</div>
      </aside>
      <main className="map-wrap"><div id="map" /></main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
