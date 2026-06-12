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

    if (!process.env.ORS_API_KEY) {
      return Response.json(
        { error: "Missing ORS_API_KEY environment variable." },
        { status: 500 }
      );
    }

    const orsResponse = await fetch(
      "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
      {
        method: "POST",
        headers: {
          Authorization: process.env.ORS_API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json, application/geo+json"
        },
        body: JSON.stringify({
          coordinates,
          instructions: true
        })
      }
    );

    const data = await orsResponse.json();

    if (!orsResponse.ok) {
      return Response.json(
        {
          error: data?.error?.message || "OpenRouteService request failed."
        },
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
