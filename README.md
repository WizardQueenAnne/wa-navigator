# WA Navigator

WA Navigator is a Washington-focused navigation web app built with React, Leaflet, OpenStreetMap, OpenRouteService, and Netlify Functions.

## Current Features

- Map centered on Washington State
- Moving user-location marker when location permission is allowed
- Washington-focused address search using Nominatim
- Point-to-point routing through a protected OpenRouteService serverless function
- Purple route line, ETA, distance, and turn-by-turn directions
- Optional browser voice directions
- Responsive desktop and mobile layout

## Repository Files

```text
wa-navigator/
  functions/
    route.js
  .env.example
  .gitignore
  index.html
  main.jsx
  styles.css
  netlify.toml
  package.json
  README.md
```

Your local `.env` file is intentionally not shown on GitHub because it contains private API keys.

## Run Locally

1. Install the current LTS version of Node.js from https://nodejs.org/.
2. Download or clone this repository.
3. Open a terminal inside the `wa-navigator` folder.
4. Run:

```bash
npm install
```

5. Create a file named `.env` in the repository root and add:

```text
ORS_API_KEY=your_real_openrouteservice_key
WSDOT_ACCESS_CODE=your_real_wsdot_access_code
```

6. Start the local Netlify development server:

```bash
npm run dev
```

7. Open the address shown in the terminal, normally `http://localhost:8888`.

Use `npm run dev`, not `npm run vite`, when testing routes. The Netlify development server makes the protected routing function available locally.

## Deploy With Netlify

1. Sign in at https://app.netlify.com/.
2. Choose **Add new site**, then **Import an existing project**.
3. Select this GitHub repository.
4. Netlify reads `netlify.toml` automatically.
5. Open **Site configuration**, then **Environment variables**.
6. Add `ORS_API_KEY` and `WSDOT_ACCESS_CODE` with their real values.
7. Deploy the site.

Never put real API keys in `.env.example`, `main.jsx`, or any other GitHub file.

## Build Progress

- [x] 1. Project scaffold and Washington-centered map
- [x] 2. User location detection and marker
- [x] 3. Address search with Nominatim
- [x] 4. Basic ORS routing through a Netlify Function
- [x] 5. Turn-by-turn directions and ETA
- [x] 6. Voice directions
- [ ] 7. Avoid tolls, highways, and dirt roads
- [ ] 8. Remaining routing filters
- [ ] 9. WSDOT integration, beginning with ferries
- [ ] 10. Save/share routes, dark mode, satellite view, and avoid zones
- [ ] 11. Route comparison and MPG cost calculator
- [ ] 12. Leave-by calculator, multi-stop routing, and round trips

## Important API Notes

- OpenStreetMap map tiles require visible attribution. The app includes it automatically.
- Nominatim is suitable for light development use. Avoid sending many automated requests.
- The OpenRouteService key is only read inside `functions/route.js`; it is never sent directly to the browser.
- WSDOT integration will begin with ferry information because it is WA Navigator's main differentiator.
