function getEnvironmentVariable(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name];
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed. Use POST." },
      { status: 405 }
    );
  }

  try {
    const body = await request.json();
    const { coordinates } = body;

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return Response.json(
        { error: "A route requires at least two coordinates." },
        { status: 400 }
      );
    }

    const apiKey = getEnvironmentVariable("ORS_API_KEY")?.trim();

    if (!apiKey) {
      return Response.json(
        {
          error:
            "ORS_API_KEY is not available to this Netlify Function. Add it in Netlify Environment Variables, then trigger a new deploy."
        },
        { status: 500 }
      );
    }

    const orsResponse = await fetch(
      "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
      {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
          Accept: "application/json, application/geo+json"
        },
        body: JSON.stringify({ coordinates, instructions: true })
      }
    );

    const data = await orsResponse.json();

    if (!orsResponse.ok) {
      return Response.json(
        { error: data?.error?.message || "OpenRouteService request failed." },
        { status: orsResponse.status }
      );
    }

    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error.message || "Route function failed." },
      { status: 500 }
    );
  }
}
