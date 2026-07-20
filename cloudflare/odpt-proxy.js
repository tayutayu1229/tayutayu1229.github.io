/**
 * Cloudflare Worker for the ODPT APIs.
 *
 * Route this Worker to: tayunet-traininfo.com/api/odpt/*
 * Required Worker secrets:
 *   ODPT_STANDARD_TOKEN   (api.odpt.org)
 *   ODPT_CHALLENGE_TOKEN  (api-challenge.odpt.org)
 */

const SOURCES = {
  standard: "https://api.odpt.org/api/v4/",
  challenge: "https://api-challenge.odpt.org/api/v4/"
};

function response(message, status) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}

function allowedPath(path) {
  return (
    path.startsWith("odpt:") ||
    path.startsWith("gtfs/") ||
    path.startsWith("files/")
  ) && !path.includes("..") && !path.includes("\\");
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return response("Method not allowed", 405);
    }

    const incoming = new URL(request.url);
    const [, , , source, ...pathParts] = incoming.pathname.split("/");
    const path = pathParts.join("/");
    if (!SOURCES[source] || !allowedPath(path)) {
      return response("Not found", 404);
    }

    const token = source === "standard" ? env.ODPT_STANDARD_TOKEN : env.ODPT_CHALLENGE_TOKEN;
    if (!token) return response("Upstream credentials are not configured", 503);

    // `odpt:Train` is an API resource name, not a URL scheme.  Concatenating
    // it to the trusted source avoids URL treating `odpt:` as a new scheme.
    const upstream = new URL(`${SOURCES[source]}${path}`);
    for (const [key, value] of incoming.searchParams) {
      if (key !== "acl:consumerKey") upstream.searchParams.append(key, value);
    }
    upstream.searchParams.set("acl:consumerKey", token);

    const upstreamResponse = await fetch(upstream, {
      method: request.method,
      headers: { accept: request.headers.get("accept") || "application/json" },
      cf: { cacheTtl: 60, cacheEverything: request.method === "GET" }
    });

    const headers = new Headers(upstreamResponse.headers);
    headers.delete("set-cookie");
    headers.set("cache-control", "public, max-age=60, s-maxage=60");
    headers.set("x-content-type-options", "nosniff");
    return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers });
  }
};
