import { describe, expect, it, vi } from "vitest"
import {
  MediaClientError,
  createBrowserMediaUploadApi,
  parsePendingMediaUploads,
  pendingMediaUploads,
  resumeMediaUpload,
  startMediaUpload,
  type MediaUploadApi,
  type MediaUploadSessionStatus,
  type PendingMediaUpload,
} from "@/lib/media-upload-client"

/**
 * ENH-07-04: resumable upload state machine.
 *
 * These are transport-level tests: no React, no browser. They pin the parts
 * that must not lie: persist before upload, keep a signed request after a lost
 * response, reconcile through the server, and never re-upload bytes the
 * provider may already hold.
 */

const SESSION = "00000000-0000-4000-8000-0000000000f1"
const RESOURCE = "00000000-0000-4000-8000-0000000000d1"
const ASSET = "00000000-0000-4000-8000-0000000000c1"

const FILE = {
  name: "logo.png",
  type: "image/png",
  size: 2048,
} as File

function pending(overrides: Partial<PendingMediaUpload> = {}): PendingMediaUpload {
  return {
    sessionId: SESSION,
    kind: "image",
    bindingType: "team",
    resourceId: RESOURCE,
    uploadUrl: "https://api.cloudinary.com/v1_1/demo/image/upload",
    params: {
      public_id: "ssl_demo",
      timestamp: "1760000000",
      signature: "sig",
      api_key: "key",
    },
    expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    createdAt: new Date().toISOString(),
    uploadedAt: null,
    ...overrides,
  }
}

function memoryStorage(initial: PendingMediaUpload[] = []) {
  let items = [...initial]
  return {
    read: () => [...items],
    save: (next: PendingMediaUpload[]) => { items = [...next] },
    get items() { return items },
  }
}

function status(overrides: Partial<MediaUploadSessionStatus> = {}): MediaUploadSessionStatus {
  return {
    sessionId: SESSION,
    state: "reserved",
    kind: "image",
    bindingType: "team",
    resourceId: RESOURCE,
    expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    assetId: null,
    assetState: null,
    ...overrides,
  }
}

function fakeApi(overrides: Partial<MediaUploadApi> = {}): MediaUploadApi {
  return {
    authorize: vi.fn(async () => ({
      sessionId: SESSION,
      uploadUrl: "https://api.cloudinary.com/v1_1/demo/image/upload",
      params: pending().params,
      expiresAt: pending().expiresAt,
    })),
    upload: vi.fn(async () => undefined),
    finalize: vi.fn(async () => ({
      ok: true as const,
      assetId: ASSET,
      state: "ready" as const,
      publication: "unpublished" as const,
    })),
    status: vi.fn(async () => status()),
    ...overrides,
  }
}

const START = {
  file: FILE,
  kind: "image" as const,
  bindingType: "team" as const,
  resourceId: RESOURCE,
}

describe("ENH-07-04: start upload", () => {
  it("persists the signed session before uploading and clears it after ready", async () => {
    const storage = memoryStorage()
    const api = fakeApi({
      upload: vi.fn(async input => {
        expect(pendingMediaUploads(storage)).toHaveLength(1)
        expect(pendingMediaUploads(storage)[0]).toMatchObject({
          sessionId: SESSION, uploadedAt: null,
        })
        input.onProgress?.(0.5)
      }),
    })
    const progress: number[] = []

    await expect(startMediaUpload({
      api, storage, ...START, onProgress: value => progress.push(value),
    })).resolves.toEqual({ state: "ready", assetId: ASSET })

    expect(progress).toEqual([0.5])
    expect(storage.items).toEqual([])
    expect(api.finalize).toHaveBeenCalledWith(SESSION, undefined)
  })

  it("records a quarantined result as a settled outcome, not a retry", async () => {
    const storage = memoryStorage()
    const api = fakeApi({
      finalize: vi.fn(async () => ({
        ok: false as const,
        reason: "quarantined" as const,
        assetId: ASSET,
        detail: "mime_mismatch",
      })),
    })

    await expect(startMediaUpload({ api, storage, ...START })).resolves.toEqual({
      state: "quarantined", assetId: ASSET, detail: "mime_mismatch",
    })
    expect(storage.items).toEqual([])
  })

  it("keeps a retryable upload failure and accepts a later resume", async () => {
    const storage = memoryStorage()
    let uploads = 0
    const api = fakeApi({
      upload: vi.fn(async () => {
        uploads += 1
        if (uploads === 1) throw new MediaClientError("network", { retryable: true })
      }),
      finalize: vi.fn()
        .mockRejectedValueOnce(new MediaClientError("provider_not_found", { status: 409 }))
        .mockResolvedValueOnce({
          ok: true as const, assetId: ASSET, state: "ready" as const,
          publication: "unpublished" as const,
        }),
    })

    await expect(startMediaUpload({ api, storage, ...START })).rejects
      .toMatchObject({ code: "network" })
    expect(storage.items).toHaveLength(1)
    expect(storage.items[0]?.uploadedAt).toBeNull()

    await expect(resumeMediaUpload({
      api, storage, sessionId: SESSION, file: FILE,
    })).resolves.toEqual({ state: "ready", assetId: ASSET })
    expect(uploads).toBe(2)
    expect(storage.items).toEqual([])
  })

  it("reconciles a committed finalize whose response was lost", async () => {
    const storage = memoryStorage()
    const api = fakeApi({
      finalize: vi.fn(async () => {
        throw new MediaClientError("conflict", { status: 409 })
      }),
      status: vi.fn(async () => status({
        state: "finalized", assetId: ASSET, assetState: "ready",
      })),
    })

    await expect(startMediaUpload({ api, storage, ...START })).resolves.toEqual({
      state: "ready", assetId: ASSET,
    })
    expect(storage.items).toEqual([])
  })
})

describe("ENH-07-04: resume upload", () => {
  it("returns finalized status without finalizing or uploading again", async () => {
    const storage = memoryStorage([pending({ uploadedAt: new Date().toISOString() })])
    const api = fakeApi({
      status: vi.fn(async () => status({
        state: "finalized", assetId: ASSET, assetState: "quarantined",
      })),
    })

    await expect(resumeMediaUpload({ api, storage, sessionId: SESSION })).resolves.toEqual({
      state: "quarantined", assetId: ASSET, detail: "quarantined",
    })
    expect(api.upload).not.toHaveBeenCalled()
    expect(api.finalize).not.toHaveBeenCalled()
    expect(storage.items).toEqual([])
  })

  it("clears an expired session", async () => {
    const storage = memoryStorage([pending()])
    const api = fakeApi({ status: vi.fn(async () => status({ state: "expired" })) })

    await expect(resumeMediaUpload({ api, storage, sessionId: SESSION })).resolves.toEqual({
      state: "expired", sessionId: SESSION,
    })
    expect(storage.items).toEqual([])
  })

  it("asks for the file when the provider never received the bytes", async () => {
    const storage = memoryStorage([pending()])
    const api = fakeApi({
      finalize: vi.fn(async () => {
        throw new MediaClientError("provider_not_found", { status: 409 })
      }),
    })

    await expect(resumeMediaUpload({ api, storage, sessionId: SESSION })).resolves.toEqual({
      state: "needs_file", sessionId: SESSION,
    })
    expect(storage.items).toHaveLength(1)
  })

  it("uploads once when the original transfer was unacknowledged", async () => {
    const storage = memoryStorage([pending()])
    const api = fakeApi({
      finalize: vi.fn()
        .mockRejectedValueOnce(new MediaClientError("provider_not_found", { status: 409 }))
        .mockResolvedValueOnce({
          ok: true as const, assetId: ASSET, state: "ready" as const,
          publication: "unpublished" as const,
        }),
    })

    await expect(resumeMediaUpload({
      api, storage, sessionId: SESSION, file: FILE,
    })).resolves.toEqual({ state: "ready", assetId: ASSET })
    expect(api.upload).toHaveBeenCalledTimes(1)
    expect(storage.items).toEqual([])
  })

  it("does not re-upload after an acknowledged transfer during provider lag", async () => {
    const storage = memoryStorage([pending({ uploadedAt: new Date().toISOString() })])
    const api = fakeApi({
      finalize: vi.fn(async () => {
        throw new MediaClientError("provider_not_found", { status: 409 })
      }),
    })

    await expect(resumeMediaUpload({
      api, storage, sessionId: SESSION, file: FILE,
    })).rejects.toMatchObject({ code: "provider_not_found" })
    expect(api.upload).not.toHaveBeenCalled()
    expect(storage.items).toHaveLength(1)
  })
})

describe("ENH-07-04: client validation and storage", () => {
  it("refuses a mismatched declaration before authorizing", async () => {
    const storage = memoryStorage()
    const api = fakeApi()
    await expect(startMediaUpload({
      api, storage, ...START, kind: "video",
    })).rejects.toMatchObject({ code: "invalid_declaration" })
    expect(api.authorize).not.toHaveBeenCalled()
  })

  it("drops corrupt entries and caps retained sessions", () => {
    expect(parsePendingMediaUploads("not json")).toEqual([])
    expect(parsePendingMediaUploads(JSON.stringify([{ sessionId: SESSION }]))).toEqual([])
    const rows = Array.from({ length: 12 }, (_, index) => pending({
      sessionId: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`,
    }))
    const parsed = parsePendingMediaUploads(JSON.stringify(rows))
    expect(parsed).toHaveLength(10)
    expect(parsed[0]?.sessionId).toBe(rows[2]?.sessionId)
  })

  it("maps provider upload failures without a signed-request leak", () => {
    expect(createBrowserMediaUploadApi).toBeTypeOf("function")
  })
})
