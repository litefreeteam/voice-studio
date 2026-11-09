export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    // Only extensionless client-side routes may use the SPA fallback. A missing
    // installer, API or asset must stay a 404, even during browser navigation.
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url).pathname); }
    catch { return response; }
    const resourcePath = /^\/(?:downloads|assets|api)(?:\/|$)/i.test(pathname)
      || pathname.split("/").some((segment) => segment.includes("."));

    if (response.status !== 404 || !acceptsHtml || resourcePath || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
