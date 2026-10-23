import { BotGuardClient } from "bgutils-js/botguard";
import type { WebPoSignalOutput } from "bgutils-js/shared-types";
import { GOOG_API_KEY, USER_AGENT, buildURL } from "bgutils-js/utils";
import { WebPoMinter, createColdStartToken } from "bgutils-js/webpo";
import { JSDOM } from "jsdom";
import { Innertube, Log, Platform, UniversalCache } from "youtubei.js";
import type { Types } from "youtubei.js";

Log.setLevel(Log.Level.NONE);

// Configure JS decipher evaluator for youtubei.js
Platform.shim.eval = async (data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) => {
  const properties: string[] = [];
  if (env.n) properties.push(`n: exportedVars.nFunction("${String(env.n)}")`);
  if (env.sig) properties.push(`sig: exportedVars.sigFunction("${String(env.sig)}")`);
  const code = `${data.output}\nreturn { ${properties.join(", ")} };`;
  return new Function(code)();
};

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // Refresh every 6 hours

interface PotSessionState {
  minter: WebPoMinter;
  visitorData: string;
  sessionPoToken: string;
  expiresAt: number;
  cleanup: () => void;
}

const globalForPot = globalThis as typeof globalThis & {
  __yoPotState?: PotSessionState | null;
  __yoPotInFlight?: Promise<PotSessionState> | null;
};

async function createPotSession(): Promise<PotSessionState> {
  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
    url: "https://www.youtube.com/",
    referrer: "https://www.youtube.com/",
  });

  // Prevent JSDOM noisy canvas unimplemented warnings while running BotGuard VM
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    origin: dom.window.origin,
  });
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", {
      value: dom.window.navigator,
      configurable: true,
    });
  }

  const bare = await Innertube.create({
    retrieve_player: false,
    cache: new UniversalCache(false),
  });
  const visitorData = bare.session.context.client.visitorData || "";
  const challenge = await bare.getAttestationChallenge("ENGAGEMENT_TYPE_UNBOUND");
  const bg = challenge.bg_challenge;
  if (!bg) {
    dom.window.close();
    throw new Error("BotGuard challenge unavailable");
  }

  const scriptPath = (
    bg.interpreter_url as unknown as {
      private_do_not_access_or_else_trusted_resource_url_wrapped_value?: string;
    }
  )?.private_do_not_access_or_else_trusted_resource_url_wrapped_value;

  if (!scriptPath) {
    dom.window.close();
    throw new Error("BotGuard script URL missing");
  }

  const scriptUrl = scriptPath.startsWith("http") ? scriptPath : `https:${scriptPath}`;
  const interpreterJs = await fetch(scriptUrl, {
    headers: { "user-agent": USER_AGENT },
  }).then((res) => res.text());

  new Function(interpreterJs)();

  const bgClient = await BotGuardClient.create({
    program: bg.program,
    globalName: bg.global_name,
    globalObject: globalThis,
  });

  const webPoSignalOutput: WebPoSignalOutput = [];
  const botguardResponse = await bgClient.snapshot({ webPoSignalOutput });

  const integrityRes = await fetch(buildURL("GenerateIT", false), {
    method: "POST",
    headers: {
      "Content-Type": "application/json+protobuf",
      "x-goog-api-key": GOOG_API_KEY,
      "x-user-agent": "grpc-web-javascript/0.1",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
  });

  if (!integrityRes.ok) {
    void bgClient.shutdown().catch(() => undefined);
    dom.window.close();
    throw new Error(`GenerateIT failed with HTTP ${integrityRes.status}`);
  }

  const integrityJson = (await integrityRes.json()) as [string, number?];
  const [integrityToken, ttlSecs = 21600] = integrityJson;
  if (!integrityToken) {
    void bgClient.shutdown().catch(() => undefined);
    dom.window.close();
    throw new Error("Empty integrity token");
  }

  const minter = await WebPoMinter.create(
    { integrityToken, estimatedTtlSecs: ttlSecs },
    webPoSignalOutput,
  );
  const sessionPoToken = await minter.mintAsWebsafeString(visitorData || "youtube");

  const ttlMs = Math.min(DEFAULT_TTL_MS, Math.max(10 * 60 * 1000, ttlSecs * 800));
  return {
    minter,
    visitorData,
    sessionPoToken,
    expiresAt: Date.now() + ttlMs,
    cleanup: () => {
      void bgClient.shutdown().catch(() => undefined);
      try {
        dom.window.close();
      } catch {
        /* ignore */
      }
    },
  };
}

export async function getPotSession(): Promise<PotSessionState | null> {
  const existing = globalForPot.__yoPotState;
  if (existing && existing.expiresAt > Date.now()) {
    return existing;
  }

  if (!globalForPot.__yoPotInFlight) {
    const previous = existing;
    globalForPot.__yoPotInFlight = createPotSession()
      .then((next) => {
        if (previous) previous.cleanup();
        globalForPot.__yoPotState = next;
        return next;
      })
      .finally(() => {
        globalForPot.__yoPotInFlight = null;
      });
  }

  try {
    return await globalForPot.__yoPotInFlight;
  } catch {
    return null;
  }
}

export async function mintPoTokenForBinding(contentBinding: string): Promise<{ poToken: string; expiresAt: number }> {
  const binding = contentBinding.trim() || "youtube";
  const session = await getPotSession();
  if (session) {
    try {
      const poToken = await session.minter.mintAsWebsafeString(binding);
      return { poToken, expiresAt: Math.floor(session.expiresAt / 1000) };
    } catch {
      /* Fall back to cold-start token below if VM snapshot rotated. */
    }
  }
  return {
    poToken: createColdStartToken(binding),
    expiresAt: Math.floor((Date.now() + 15 * 60 * 1000) / 1000),
  };
}

export async function createConfiguredInnertube(): Promise<Innertube> {
  const pot = await getPotSession();
  return Innertube.create({
    po_token: pot?.sessionPoToken,
    visitor_data: pot?.visitorData || undefined,
    cache: new UniversalCache(false),
  });
}
