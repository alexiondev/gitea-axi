import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";

export interface FixtureRoute {
  method: string;
  /** Exact pathname to match, e.g. "/api/v1/repos/o/r/issues". */
  path: string;
  /** Query params that must all be present with these exact values. */
  query?: Record<string, string>;
  status?: number;
  headers?: Record<string, string>;
  /** Inline JSON body; mutually exclusive with `fixture`. */
  body?: unknown;
  /** Name of a JSON file in test/fixtures to serve as the body. */
  fixture?: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  /** Parsed JSON request body; undefined when the request carried none. */
  body?: unknown;
}

export interface FixtureServer {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

function loadBody(route: FixtureRoute): unknown {
  if (route.fixture !== undefined) {
    return JSON.parse(
      readFileSync(new URL(`./fixtures/${route.fixture}`, import.meta.url), "utf8"),
    );
  }
  return route.body ?? {};
}

function matches(route: FixtureRoute, request: RecordedRequest): boolean {
  if (route.method !== request.method || route.path !== request.path) {
    return false;
  }
  for (const [key, value] of Object.entries(route.query ?? {})) {
    if (request.query[key] !== value) {
      return false;
    }
  }
  return true;
}

/** Collect the request stream, parsing it as JSON when it carried a payload. */
async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function startFixtureServer(routes: FixtureRoute[]): Promise<FixtureServer> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture");
    const recorded: RecordedRequest = {
      method: req.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v ?? "")]),
      ),
    };
    requests.push(recorded);
    void readRequestBody(req).then((body) => {
      recorded.body = body;
      const route = routes.find((candidate) => matches(candidate, recorded));
      if (!route) {
        res.writeHead(599, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            message: `no fixture route matched ${recorded.method} ${recorded.path} ${JSON.stringify(recorded.query)}`,
          }),
        );
        return;
      }
      res.writeHead(route.status ?? 200, {
        "content-type": "application/json",
        ...route.headers,
      });
      res.end(JSON.stringify(loadBody(route)));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fixture server has no address");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
