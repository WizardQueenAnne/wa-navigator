import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";

const WA_CENTER = [47.4009, -120.7401];

const carIcon = L.divIcon({
  className: "car-marker",
  html: "➤",
  iconSize: [34, 34],
  iconAnchor: [17, 17]
});

function formatDistance(meters) {
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function placeFromResult(result) {
  return {
    label: result.display_name,
    lat: Number(result.lat),
    lon: Number(result.lon)
  };
}

function App() {
  const mapRef = useRef(null);
  const routeLayerRef = useRef(null);
  const startMarkerRef = useRef(null);
  const endMarkerRef = useRef(null);
  const userMarkerRef = useRef(null);
  const searchTimerRef = useRef(null);

  const [startQuery, setStartQuery] = useState("My location");
  const [endQuery, setEndQuery] = useState("");
  const [startPlace, setStartPlace] = useState(null);
  const [endPlace, setEndPlace] = useState(null);
  const [suggestions, setSuggestions] = useState({ start: [], end: [] });
  const [openSuggestions, setOpenSuggestions] = useState(null);
  const [routeSummary, setRouteSummary] = useState(null);
  const [directions, setDirections] = useState([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [status, setStatus] = useState("Allow location access to use My location.");

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
          const place = {
            label: "My location",
            lat: position.coords.latitude,
            lon: position.coords.longitude
          };
          const latLng = [place.lat, place.lon];

          setStartPlace((current) => (startQuery === "My location" ? place : current));
          setStatus((current) =>
            current === "Allow location access to use My location." ? "My location is ready." : current
          );

          if (!userMarkerRef.current) {
            userMarkerRef.current = L.marker(latLng, { icon: carIcon })
              .addTo(map)
              .bindPopup("Your location");
          } else {
            userMarkerRef.current.setLatLng(latLng);
          }
        },
        () => setStatus("Location access is off. Enter a starting address instead."),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
    }

    return () => {
      if (locationWatchId !== undefined) navigator.geolocation.clearWatch(locationWatchId);
      clearTimeout(searchTimerRef.current);
      window.speechSynthesis?.cancel();
      map.remove();
    };
  }, [startQuery]);

  function speak(text) {
    if (!("speechSynthesis" in window)) {
      setStatus("Voice directions are not supported by this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  function toggleVoice() {
    const nextValue = !voiceEnabled;
    setVoiceEnabled(nextValue);
    if (nextValue) speak("Voice directions enabled.");
    else window.speechSynthesis?.cancel();
  }

  function readDirections() {
    if (!directions.length) {
      setStatus("Calculate a route before reading directions.");
      return;
    }
    const intro = `Your route is ${formatDistance(routeSummary.distance)} and takes about ${formatDuration(routeSummary.duration)}.`;
    speak(`${intro} ${directions.map((step) => step.instruction).join(". Then, ")}`);
  }

  async function searchPlaces(query, limit = 5) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("countrycodes", "us");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("viewbox", "-124.85,49.05,-116.85,45.5");
    url.searchParams.set("bounded", "1");

    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Address search failed.");
    return response.json();
  }

  function requestSuggestions(type, value) {
    if (type === "start") setStartQuery(value);
    else setEndQuery(value);

    if (type === "start" && value === "My location") return;
    clearTimeout(searchTimerRef.current);

    if (value.trim().length < 3) {
      setSuggestions((current) => ({ ...current, [type]: [] }));
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchPlaces(value.trim());
        setSuggestions((current) => ({ ...current, [type]: results.map(placeFromResult) }));
        setOpenSuggestions(type);
      } catch {
        setSuggestions((current) => ({ ...current, [type]: [] }));
      }
    }, 450);
  }

  function setMapMarker(markerRef, place, label) {
    const latLng = [place.lat, place.lon];
    if (!markerRef.current) markerRef.current = L.marker(latLng).addTo(mapRef.current);
    else markerRef.current.setLatLng(latLng);
    markerRef.current.bindPopup(`<strong>${label}</strong><br>${place.label}`);
  }

  function choosePlace(type, place) {
    if (type === "start") {
      setStartQuery(place.label);
      setStartPlace(place);
      setMapMarker(startMarkerRef, place, "Start");
    } else {
      setEndQuery(place.label);
      setEndPlace(place);
      setMapMarker(endMarkerRef, place, "Destination");
    }
    setOpenSuggestions(null);
    setSuggestions((current) => ({ ...current, [type]: [] }));
    mapRef.current.setView([place.lat, place.lon], 13);
    setStatus("Place selected.");
  }

  function useMyLocation() {
    if (!userMarkerRef.current) {
      setStatus("Allow location access in your browser, then try again.");
      return;
    }
    const location = userMarkerRef.current.getLatLng();
    setStartQuery("My location");
    setStartPlace({ label: "My location", lat: location.lat, lon: location.lng });
    startMarkerRef.current?.remove();
    startMarkerRef.current = null;
    setOpenSuggestions(null);
    setStatus("Using My location as the starting point.");
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

  async function handleRoute() {
    try {
      if (!startPlace || !endPlace) {
        setStatus("Select both a start and destination first.");
        return;
      }

      setStatus("Calculating route...");
      const response = await fetch("/.netlify/functions/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: [[startPlace.lon, startPlace.lat], [endPlace.lon, endPlace.lat]] })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Route request failed.");

      const feature = data.features?.[0];
      if (!feature) throw new Error("No route was returned.");
      const latLngs = feature.geometry.coordinates.map(([lon, lat]) => [lat, lon]);

      routeLayerRef.current?.remove();
      routeLayerRef.current = L.polyline(latLngs, { color: "#7c3aed", weight: 7, opacity: 0.9 }).addTo(mapRef.current);
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

  function SearchField({ type, label, value, placeholder }) {
    return (
      <label className="search-field">
        {label}
        <div className="input-row">
          <input
            value={value}
            onChange={(event) => requestSuggestions(type, event.target.value)}
            onFocus={() => setOpenSuggestions(type)}
            onKeyDown={(event) => event.key === "Enter" && handleSearch(type)}
            placeholder={placeholder}
            autoComplete="off"
          />
          <button onClick={() => handleSearch(type)}>Find</button>
        </div>
        {openSuggestions === type && (
          <div className="suggestions">
            {type === "start" && value !== "My location" && (
              <button type="button" onClick={useMyLocation}><strong>My location</strong><small>Use your device location</small></button>
            )}
            {suggestions[type].map((place) => (
              <button type="button" key={`${place.lat}-${place.lon}`} onClick={() => choosePlace(type, place)}>
                <strong>{place.label.split(",")[0]}</strong><small>{place.label}</small>
              </button>
            ))}
          </div>
        )}
      </label>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">WA</div><div><h1>WA Navigator</h1><p>Washington-focused routing</p></div></div>

        <div className="card route-card">
          <SearchField type="start" label="Start" value={startQuery} placeholder="My location or a place" />
          <SearchField type="end" label="Destination" value={endQuery} placeholder="Search a place or address" />
          <button className="primary-button" onClick={handleRoute}>Get route</button>
          <p className="status" aria-live="polite">{status}</p>
        </div>

        <div className="card voice-card">
          <div><h2>Voice directions</h2><p className="muted">Uses your browser's built-in voice.</p></div>
          <button className={voiceEnabled ? "toggle-button active" : "toggle-button"} onClick={toggleVoice} aria-pressed={voiceEnabled}>{voiceEnabled ? "On" : "Off"}</button>
          <button className="secondary-button" onClick={readDirections} disabled={!directions.length}>Read route</button>
        </div>

        {routeSummary && <div className="card"><h2>Route summary</h2><div className="summary-grid"><div><span>ETA</span><strong>{formatDuration(routeSummary.duration)}</strong></div><div><span>Distance</span><strong>{formatDistance(routeSummary.distance)}</strong></div></div></div>}

        <div className="card"><h2>Directions</h2>{directions.length === 0 ? <p className="muted">Directions will appear after you calculate a route.</p> : <ol>{directions.map((step) => <li key={step.id}><span>{step.instruction}</span><small>{formatDistance(step.distance)}</small></li>)}</ol>}</div>
      </aside>
      <main className="map-wrap"><div id="map" /></main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
