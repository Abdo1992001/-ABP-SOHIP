function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requiredUrl(flag) {
  const value = valueAfter(flag);
  if (value === undefined) throw new Error(flag + "_REQUIRED");
  return new URL(value);
}

async function get(url) {
  const response = await globalThis.fetch(url, {
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(
      "HTTP_" + response.status.toString() + "_" + url.toString(),
    );
  return { status: response.status, body };
}

const web = requiredUrl("--web");
const api = requiredUrl("--api");
const apiReadiness = new URL("/api/v1/health/ready", api);
const webResult = await get(web);
if (webResult.body.trim().length === 0) throw new Error("WEB_EMPTY_RESPONSE");

const apiResult = await get(apiReadiness);
const health = JSON.parse(apiResult.body);
if (health.ready !== true) throw new Error("API_NOT_DATABASE_READY");

console.log(
  JSON.stringify({
    result: "PASS",
    environment: "STAGING",
    web: { url: web.toString(), status: webResult.status },
    api: {
      url: apiReadiness.toString(),
      status: apiResult.status,
      ready: health.ready,
    },
  }),
);
