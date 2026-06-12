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

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} hr ${remainingMinutes} min`;
}

function App() {
  const mapRef = useRef(null);
  const routeLayerRef = useRef(null);
  const startMarkerRef = useRef(null);
  const endMarkerRef = useRef(null);
  const userMarkerRef = useRef(null);

  const [startQuery, setStartQuery] = useState("");
  const [endQuery, setEndQuery] = useState("");
  const [startPlace, setStartPlace] = useState(null);
  const [endPlace, setEndPlace] = useState(null);
  const [routeSummary, setRouteSummary] = useState(null);
  const [directions, setDirections] = useState([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [status, setStatus] = useState("Ready");

  useEffect(() => {
    const map = L.map("map").setView(WA_CENTER, 7);
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    let locationWatchId;

    if ("geolocation" in navigator) {
      locationWatchId = navigator.geolocation.watchPosition(
        (position) => {
          const latLng = [position.coords.latitude, position.coords.longitude];

          if (!userMarkerRef.current) {
            userMarkerRef.current = L.marker(latLng, { icon: carIcon })
              .addTo(map)
              .bindPopup("Your location");
          } else {
            userMarkerRef.current.setLatLng(latLng);
          }
        },
        () => {
          setStatus("Location access is off. The map still works without it.");
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
    }

    return () => {
      if (locationWatchId !== undefined) {
        navigator.geolocation.clearWatch(locationWatchId);
      }
      window.speechSynthesis?.cancel();
      map.remove();
    };
  }, []);

  function speak(text) {
    if (!("speechSynthesis" in window)) {
      setStatus("Voice directions are not supported by this browser.");
      return;
    }

    window.speechSynthesis.cancel();
    const message = new SpeechSynthesisUtterance(text);
    message.rate = 1;
    window.speechSynthesis.speak(message);
  }

  function toggleVoice() {
    const nextValue = !voiceEnabled;
    setVoiceEnabled(nextValue);

    if (nextValue) {
      speak("Voice directions enabled.");
    } else {
      window.speechSynthesis?.cancel();
      setStatus("Voice directions disabled.");
    }
  }

  function readDirections() {
    if (!directions.length) {
      setStatus("Calculate a route before reading directions.");
      return;
    }

    const routeIntro = routeSummary
      ? `Your route is ${formatDistance(routeSummary.distance)} and takes about ${formatDuration(routeSummary.duration)}.`
      : "Your route is ready.";
    const steps = directions.map((step) => step.instruction).join(". Then, ");
    speak(`${routeIntro} ${steps}`);
  }

  async function searchPlace(query) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", `${query}, Washington, USA`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "us");
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) throw new Error("Address search failed.");

    const data = await response.json();
    if (!data.length) throw new Error(`No result found for "${query}".`);

    return {
      label: data[0].display_name,
      lat: Number(data[0].lat),
      lon: Number(data[0].lon)
    };
  }

  function setMapMarker(markerRef, place, label) {
    const latLng = [place.lat, place.lon];

    if (!markerRef.current) {
      markerRef.current = L.marker(latLng).addTo(mapRef.current);
    } else {
      markerRef.current.setLatLng(latLng);
    }

    markerRef.current.bindPopup(`<strong>${label}</strong><br>${place.label}`);
  }

  async function handleSearch(type) {
    try {
      const query = type === "start" ? startQuery : endQuery;

      if (!query.trim()) {
        setStatus("Enter an address or place name first.");
        return;
      }

      setStatus("Searching address...");
      const place = await searchPlace(query);

      if (type === "start") {
        setStartPlace(place);
        setMapMarker(startMarkerRef, place, "Start");
      } else {
        setEndPlace(place);
        setMapMarker(endMarkerRef, place, "Destination");
      }

      mapRef.current.setView([place.lat, place.lon], 13);
      setStatus("Address found.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleRoute() {
    try {
      if (!startPlace || !endPlace) {
        setStatus("Search for both a start and destination first.");
        return;
      }

      setStatus("Calculating route...");
      const response = await fetch("/.netlify/functions/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coordinates: [
            [startPlace.lon, startPlace.lat],
            [endPlace.lon, endPlace.lat]
          ]
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Route request failed.");
      }

      const feature = data.features?.[0];
      if (!feature) throw new Error("No route was returned.");

      const latLngs = feature.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      routeLayerRef.current?.remove();
      routeLayerRef.current = L.polyline(latLngs, {
        color: "#7c3aed",
        weight: 7,
        opacity: 0.9
      }).addTo(mapRef.current);
      mapRef.current.fitBounds(routeLayerRef.current.getBounds(), {
        padding: [40, 40]
      });

      const segment = feature.properties.segments[0];
      const nextDirections = segment.steps.map((step, index) => ({
        id: index,
        instruction: step.instruction,
        distance: step.distance
      }));

      setRouteSummary({ distance: segment.distance, duration: segment.duration });
      setDirections(nextDirections);
      setStatus("Route ready.");

      if (voiceEnabled && nextDirections.length) {
        speak(`Route ready. ${nextDirections[0].instruction}`);
      }
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">WA</div>
          <div>
            <h1>WA Navigator</h1>
            <p>Washington-focused routing</p>
          </div>
        </div>

        <div className="card">
          <label>
            Start
            <div className="input-row">
              <input
                value={startQuery}
                onChange={(event) => setStartQuery(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleSearch("start")}
                placeholder="Example: Seattle Prep"
              />
              <button onClick={() => handleSearch("start")}>Find</button>
            </div>
          </label>

          <label>
            Destination
            <div className="input-row">
              <input
                value={endQuery}
                onChange={(event) => setEndQuery(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleSearch("end")}
                placeholder="Example: Pike Place Market"
              />
              <button onClick={() => handleSearch("end")}>Find</button>
            </div>
          </label>

          <button className="primary-button" onClick={handleRoute}>Get route</button>
          <p className="status" aria-live="polite">{status}</p>
        </div>

        <div className="card voice-card">
          <div>
            <h2>Voice directions</h2>
            <p className="muted">Uses your browser's built-in voice.</p>
          </div>
          <button
            className={voiceEnabled ? "toggle-button active" : "toggle-button"}
            onClick={toggleVoice}
            aria-pressed={voiceEnabled}
          >
            {voiceEnabled ? "On" : "Off"}
          </button>
          <button className="secondary-button" onClick={readDirections} disabled={!directions.length}>
            Read route
          </button>
        </div>

        {routeSummary && (
          <div className="card">
            <h2>Route summary</h2>
            <div className="summary-grid">
              <div><span>ETA</span><strong>{formatDuration(routeSummary.duration)}</strong></div>
              <div><span>Distance</span><strong>{formatDistance(routeSummary.distance)}</strong></div>
            </div>
          </div>
        )}

        <div className="card">
          <h2>Directions</h2>
          {directions.length === 0 ? (
            <p className="muted">Directions will appear after you calculate a route.</p>
          ) : (
            <ol>
              {directions.map((step) => (
                <li key={step.id}>
                  <span>{step.instruction}</span>
                  <small>{formatDistance(step.distance)}</small>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>

      <main className="map-wrap"><div id="map" /></main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
