function getEnvironmentVariable(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name];
}

export default async function handler() {
  try {
    const accessCode = getEnvironmentVariable("WSDOT_ACCESS_CODE")?.trim();
    if (!accessCode) {
      return Response.json(
        { error: "WSDOT_ACCESS_CODE is not available to this Netlify Function." },
        { status: 500 }
      );
    }

    const url = new URL("https://www.wsdot.wa.gov/ferries/api/terminals/rest/terminalwaittimes");
    url.searchParams.set("apiaccesscode", accessCode);

    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await response.json();

    if (!response.ok) {
      return Response.json({ error: "WSDOT ferry wait information is unavailable." }, { status: response.status });
    }

    return Response.json(data, {
      headers: { "Cache-Control": "public, max-age=60" }
    });
  } catch (error) {
    return Response.json({ error: error.message || "Ferry wait request failed." }, { status: 500 });
  }
}
