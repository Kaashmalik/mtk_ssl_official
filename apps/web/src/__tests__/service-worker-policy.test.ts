import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { observedUserId, purgeDecision } from "@/lib/sw-purge-policy"

/**
 * ENH-01-02 protected-caching contract for the service worker, evaluated
 * BEHAVIORALLY: the real apps/web/public/sw.js source runs in a fake worker
 * realm (Node globals + injected self/caches/fetch), so the fetch, activate
 * and message handlers are exercised, not pattern-matched. Contract:
 *
 *  - NO successful HTML navigation is ever written to any cache. The old
 *    worker cached every type:"basic" navigation, so protected pages
 *    (dashboard, settings) survived in the shell cache and could be served
 *    offline to whoever used the browser next.
 *  - Offline navigation fallback is the pre-cached /offline shell.
 *  - The shell cache generation is bumped (v2) so activation deletes
 *    ssl-shell-v1 - purging protected HTML already stored for existing
 *    clients by the old worker.
 *  - The PURGE_NAVIGATION_CACHE message (sent on sign-out/account switch)
 *    deletes the shell cache and re-primes /offline.
 *  - Immutable public build assets stay cache-first.
 */

const SW_PATH = join(import.meta.dirname, "..", "..", "public", "sw.js")
const ORIGIN = "https://app.test"

type Handler = (event: any) => unknown

function buildWorkerRealm() {
  const stores = new Map<string, Map<string, Response>>()
  const currentStore = (name: string): Map<string, Response> => {
    let store = stores.get(name)
    if (!store) {
      store = new Map()
      stores.set(name, store)
    }
    return store
  }
  const opened = new Map<string, {
    put: ReturnType<typeof vi.fn>
    match: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    addAll: ReturnType<typeof vi.fn>
    puts: Array<{ key: string }>
  }>()
  const openCache = (name: string) => {
    let entry = opened.get(name)
    if (!entry) {
      const created = {
        puts: [] as Array<{ key: string }>,
        put: vi.fn(async (request: Request | string, response: Response) => {
          const key = typeof request === "string" ? request : request.url
          currentStore(name).set(key, response)
          created.puts.push({ key })
        }),
        match: vi.fn(async (request: Request | string) => {
          const hit = currentStore(name).get(typeof request === "string" ? request : request.url)
          // Real cache.match() hands back a fresh body per call.
          return hit ? hit.clone() : undefined
        }),
        delete: vi.fn(async () => {
          stores.delete(name)
          return true
        }),
        addAll: vi.fn(async (urls: string[]) => {
          for (const u of urls) {
            const abs = new URL(u, self.location.origin).toString()
            const response = await (globalThis as any).__swFetch!(abs)
            if (!response || !response.ok) throw new TypeError(`addAll failed for ${u}`)
            currentStore(name).set(abs, response)
            created.puts.push({ key: abs })
          }
        }),
      }
      entry = created
      opened.set(name, entry)
    }
    return entry
  }

  const listeners: Record<string, Handler[]> = {}
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => {
      listeners[type] ??= []
      listeners[type].push(handler)
    },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve([]) },
  }

  const globalMatch = async (request: Request | string) => {
    const key = typeof request === "string" ? request : request.url
    for (const store of stores.values()) {
      const hit = store.get(key)
      // Real Cache Storage hands back a fresh body per match.
      if (hit) return hit.clone()
    }
    return undefined
  }

  const evaluate = () => {
    const source = readFileSync(SW_PATH, "utf8")
    const dispatchFetch = (...args: unknown[]) => (globalThis as any).__swFetch!(...args)
    new Function("self", "caches", "Response", "fetch", source)(self, { open: (name: string) => Promise.resolve(openCache(name)), keys: () => Promise.resolve([...stores.keys(), "ssl-shell-legacy-unknown"]), match: globalMatch, delete: (name: string) => {
      stores.delete(name)
      return Promise.resolve(true)
    } }, Response, dispatchFetch)
  }

  return { evaluate, listeners, opened, stores, currentStore, globalMatch }
}

/**
 * Events capture waitUntil() chains; dispatch settles them, mirroring the
 * worker lifetime the browser provides. Without this, install/activate/
 * message work races the assertions.
 */
type WorkerEvent = {
  request: unknown
  data?: unknown
  responded: { value?: unknown }
  waiters: Promise<unknown>[]
  waitUntil: (p: Promise<unknown>) => void
  respondWith: (promise: Promise<Response>) => void
}

function makeEvent(request?: unknown, data?: unknown): WorkerEvent {
  const event: WorkerEvent = {
    request,
    data,
    responded: { value: undefined },
    waiters: [],
    waitUntil: (p) => {
      event.waiters.push(p)
    },
    respondWith: (promise) => {
      event.waiters.push(promise.then((value) => (event.responded.value = value)))
    },
  }
  return event
}

function navigateRequest(url: string) {
  // Browsers never expose a constructable navigate-mode Request, so the
  // worker contract is pinned against the subset of Request it may read:
  // method, mode, url, headers.get (undici would reject { mode: "navigate" }).
  return { url, method: "GET", mode: "navigate", headers: { get: () => null } } as unknown as Request
}

async function dispatchListeners(realm: ReturnType<typeof buildWorkerRealm>, type: "install" | "activate" | "message" | "fetch", event: WorkerEvent) {
  await Promise.all((realm.listeners[type] ?? []).map((h) => h(event)))
  // A dispatch is done only when every waitUntil() chain has settled.
  await Promise.all(event.waiters)
}

async function dispatchFetch(realm: ReturnType<typeof buildWorkerRealm>, event: WorkerEvent) {
  await dispatchListeners(realm, "fetch", event)
}

/**
 * Evaluates the worker AND settles install, so the shell cache starts in its
 * legitimate primed state (/offline + icons, from the default stub) before a
 * scenario overrides the network for its own path.
 */
async function bootRealm() {
  const built = buildWorkerRealm()
  ;(globalThis as any).__swFetch = vi.fn(async (input: Request | URL | string) => {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url
    return new Response(url.endsWith("/offline") ? "<html>OFFLINE-SHELL</html>" : "ASSET", { headers: { "content-type": "text/html" } })
  })
  built.evaluate()
  await dispatchListeners(built, "install", makeEvent())
  return built
}

const putKeys = (realm: ReturnType<typeof buildWorkerRealm>) =>
  [...realm.opened.values()].flatMap((c) => c.puts.map((p) => p.key))

describe("service worker protected-caching contract (ENH-01-02)", () => {
  let realm: ReturnType<typeof buildWorkerRealm>

  beforeEach(async () => {
    realm = await bootRealm()
  })

  afterEach(() => {
    delete (globalThis as any).__swFetch
  })

  it("never writes a successful HTML navigation into any cache", async () => {
    ;(globalThis as any).__swFetch = vi.fn(async () => new Response("<html>PROTECTED-HTML</html>", { headers: { "content-type": "text/html" } }))
    const event = makeEvent(navigateRequest(`${ORIGIN}/dashboard`))
    await dispatchFetch(realm, event)
    const served = event.responded.value as Response
    expect(await served.clone().text()).toBe("<html>PROTECTED-HTML</html>")
    // Install legitimately primed /offline + icons; nothing else (not the
    // protected navigation) may appear in any cache.
    const keys = putKeys(realm)
    expect(keys).toHaveLength(3)
    expect(keys).not.toContain(`${ORIGIN}/dashboard`)
  })

  it("falls back offline to the pre-cached offline shell", async () => {
    ;(globalThis as any).__swFetch = vi.fn(async () => {
      throw new TypeError("network down")
    })
    // Navigate offline (install already primed /offline).
    const event = makeEvent(navigateRequest(`${ORIGIN}/dashboard`))
    await dispatchFetch(realm, event)
    const served = event.responded.value as Response
    expect(await served.text()).toBe("<html>OFFLINE-SHELL</html>")
    // A SECOND offline navigation to another page also lands on the shell.
    const second = makeEvent(navigateRequest(`${ORIGIN}/settings`))
    await dispatchFetch(realm, second)
    expect(await (second.responded.value as Response).text()).toBe("<html>OFFLINE-SHELL</html>")
  })

  it("keeps immutable public build assets cache-first", async () => {
    const swFetchOriginal = (globalThis as any).__swFetch as ReturnType<typeof vi.fn>
    const event = makeEvent(new Request(`${ORIGIN}/_next/static/chunk-abc.js`))
    await dispatchFetch(realm, event)
    const assets = realm.opened.get("ssl-assets-v1")!
    // /icons and /offline were primed at install; the chunk is cached too.
    expect(assets.puts.map((p) => p.key)).toContain(`${ORIGIN}/_next/static/chunk-abc.js`)
    // Second read is served from the cache: no new network call for the chunk.
    await dispatchFetch(realm, makeEvent(new Request(`${ORIGIN}/_next/static/chunk-abc.js`)))
    const chunkCalls = swFetchOriginal.mock.calls.filter(([input]) => (input as { url?: string }).url?.includes("chunk-abc")).length
    expect(chunkCalls).toBe(1)
  })

  it("activation retires every previous shell cache generation", async () => {
    realm.currentStore("ssl-shell-v1").set(`${ORIGIN}/dashboard`, new Response("<html>STALE-PROTECTED</html>"))
    realm.currentStore("unknown-generation")
    // The asset-cache generation exists on any client that already fetched assets.
    realm.currentStore("ssl-assets-v1")
    await dispatchListeners(realm, "activate", makeEvent())
    expect(realm.stores.has("ssl-shell-v1")).toBe(false)
    expect(realm.stores.has("unknown-generation")).toBe(false)
    // The current generations survive activation.
    expect(realm.stores.has("ssl-shell-v2")).toBe(true)
    expect(realm.stores.has("ssl-assets-v1")).toBe(true)
    expect(await realm.globalMatch(new Request(`${ORIGIN}/dashboard`))).toBeUndefined()
  })

  it("purges the shell cache on the account-transition message and re-primes /offline", async () => {
    // Reproduce the contaminated state: protected HTML inside the shell cache.
    realm.currentStore("ssl-shell-v2").set(`${ORIGIN}/dashboard`, new Response("<html>LEAK</html>"))
    ;(globalThis as any).__swFetch = vi.fn(async () => new Response("<html>OFFLINE-REPRIMED</html>", { headers: { "content-type": "text/html" } }))

    expect(realm.listeners.message).toHaveLength(1)
    await dispatchListeners(realm, "message", makeEvent(undefined, { type: "PURGE_NAVIGATION_CACHE" }))

    expect(await realm.globalMatch(new Request(`${ORIGIN}/dashboard`))).toBeUndefined()
    const offline = (await realm.globalMatch(new Request(`${ORIGIN}/offline`))) as Response | undefined
    expect(offline).toBeDefined()
    expect(await offline!.text()).toBe("<html>OFFLINE-REPRIMED</html>")
  })

  it("leaves API traffic and unknown messages alone", async () => {
    const api = makeEvent(navigateRequest(`${ORIGIN}/api/live`))
    const swFetchAtStart = (globalThis as any).__swFetch as ReturnType<typeof vi.fn>
    const callsBefore = swFetchAtStart.mock.calls.length
    await dispatchFetch(realm, api)
    // The worker returns without respondWith: traffic falls through untouched.
    expect(api.responded.value).toBeUndefined()
    expect(swFetchAtStart.mock.calls.length).toBe(callsBefore)

    const storesBefore = realm.stores.size
    await dispatchListeners(realm, "message", makeEvent(undefined, { type: "OTHER" }))
    expect(realm.stores.size).toBe(storesBefore)
  })
})

describe("account-transition purge decisions (ENH-01-02)", () => {
  const signedIn = (userId: string) => ({ isLoaded: true, isSignedIn: true, userId })
  const signedOut = () => ({ isLoaded: true, isSignedIn: false, userId: undefined })

  it("records the first observation without purging", () => {
    expect(purgeDecision(undefined, signedIn("user-a"))).toBe("observe")
    expect(purgeDecision(undefined, signedOut())).toBe("observe")
    // The observed identity follows the same loaded gate.
    expect(observedUserId({ isLoaded: false, isSignedIn: true, userId: "user-a" })).toBeUndefined()
    expect(observedUserId(signedIn("user-a"))).toBe("user-a")
    expect(observedUserId(signedOut())).toBeNull()
  })

  it("purges when a signed-in identity is observed to disappear", () => {
    expect(purgeDecision("user-a", signedOut())).toBe("purge")
  })

  it("purges when a DIFFERENT user appears without an observed sign-out", () => {
    expect(purgeDecision("user-a", signedIn("user-b"))).toBe("purge")
  })

  it("never purges a stable state", () => {
    expect(purgeDecision(null, signedOut())).toBe("none")
    expect(purgeDecision("user-a", signedIn("user-a"))).toBe("none")
    // A fresh sign-in after an observed signed-out state is not a transition.
    expect(purgeDecision(null, signedIn("user-b"))).toBe("none")
    // Session still loading: no observation, no decision.
    expect(purgeDecision("user-a", { isLoaded: false, isSignedIn: true, userId: "user-b" })).toBe("none")
  })
})
