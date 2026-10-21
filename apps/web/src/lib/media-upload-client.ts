/**
 * ENH-07-04: resumable client for the signed upload flow.
 *
 * The server owns authorization, provider signing and verification; this module
 * owns only the browser-side state machine. It persists the signed request
 * before the provider call so a dropped response, refresh or tab close can be
 * reconciled through the owner-scoped session status endpoint. A durable entry
 * never claims the asset is ready - only finalize does.
 *
 * No React and no Node imports: the same reducer is testable and can be reused
 * by another web surface without pulling server code into the client bundle.
 */

export const MEDIA_UPLOAD_STORAGE_KEY = "ssl.media.pending.v1"
export const MEDIA_UPLOAD_STORAGE_LIMIT = 10

export type MediaClientKind = "image" | "video" | "audio"
export type MediaClientBindingType =
  | "branding"
  | "tournament"
  | "venue"
  | "team"
  | "player"
  | "match"

const KINDS: readonly MediaClientKind[] = ["image", "video", "audio"]
const BINDING_TYPES: readonly MediaClientBindingType[] = [
  "branding",
  "tournament",
  "venue",
  "team",
  "player",
  "match",
]

export interface MediaUploadFile {
  readonly name: string
  readonly type: string
  readonly size: number
}

export interface AuthorizeMediaUploadResponse {
  sessionId: string
  uploadUrl: string
  params: Record<string, string>
  expiresAt: string
}

export type FinalizeMediaUploadResponse =
  | { ok: true; assetId: string; state: "ready"; publication: "unpublished" }
  | { ok: false; reason: "quarantined"; assetId: string; detail: string }

export interface MediaUploadSessionStatus {
  sessionId: string
  state: "reserved" | "finalized" | "expired" | "cancelled"
  kind: string
  bindingType: string | null
  resourceId: string | null
  expiresAt: string
  assetId: string | null
  assetState: string | null
}

export interface MediaUploadRequest {
  uploadUrl: string
  params: Record<string, string>
  file: MediaUploadFile
  onProgress?: (fraction: number) => void
}

export interface MediaUploadApi {
  authorize(
    input: {
      kind: MediaClientKind
      mimeType: string
      bytes: number
      durationSeconds?: number
      bindingType: MediaClientBindingType
      resourceId: string
    },
    signal?: AbortSignal,
  ): Promise<AuthorizeMediaUploadResponse>
  upload(input: MediaUploadRequest, signal?: AbortSignal): Promise<void>
  finalize(sessionId: string, signal?: AbortSignal): Promise<FinalizeMediaUploadResponse>
  status(sessionId: string, signal?: AbortSignal): Promise<MediaUploadSessionStatus>
}

export interface PendingMediaUpload {
  sessionId: string
  kind: MediaClientKind
  bindingType: MediaClientBindingType
  resourceId: string
  uploadUrl: string
  params: Record<string, string>
  expiresAt: string
  createdAt: string
  /** Set only after the provider accepted the bytes; never after a lost call. */
  uploadedAt: string | null
}

export interface MediaUploadStorage {
  read(): PendingMediaUpload[]
  save(items: PendingMediaUpload[]): void
}

export type MediaUploadOutcome =
  | { state: "ready"; assetId: string }
  | { state: "quarantined"; assetId: string; detail: string }
  | { state: "needs_file"; sessionId: string }
  | { state: "expired"; sessionId: string }
  | { state: "not_found"; sessionId: string }

export type MediaClientErrorCode =
  | "invalid_declaration"
  | "network"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "expired"
  | "conflict"
  | "quota_exceeded"
  | "limits_unconfigured"
  | "quota_unconfigured"
  | "provider_unconfigured"
  | "provider_unavailable"
  | "provider_not_found"
  | "cancelled"
  | "unknown"

export class MediaClientError extends Error {
  readonly code: MediaClientErrorCode
  readonly status: number | null
  readonly retryable: boolean
  readonly detail: string | null

  constructor(
    code: MediaClientErrorCode,
    options: { status?: number; retryable?: boolean; detail?: string } = {},
  ) {
    super(code)
    this.name = "MediaClientError"
    this.code = code
    this.status = options.status ?? null
    this.retryable = options.retryable ?? RETRYABLE.has(code)
    this.detail = options.detail ?? null
  }
}

const RETRYABLE = new Set<MediaClientErrorCode>([
  "network",
  "provider_unavailable",
])

/** Definitive failures: keeping the signed request would only confuse a resume. */
const DROP_ON_FAILURE = new Set<MediaClientErrorCode>([
  "invalid_declaration",
  "unauthorized",
  "forbidden",
  "not_found",
  "expired",
  "quota_exceeded",
  "limits_unconfigured",
  "quota_unconfigured",
  "provider_unconfigured",
  "cancelled",
])

function fail(
  code: MediaClientErrorCode,
  options: { status?: number; retryable?: boolean; detail?: string } = {},
): never {
  throw new MediaClientError(code, options)
}

function assertDeclaration(input: {
  file: MediaUploadFile
  kind: MediaClientKind
  bindingType: MediaClientBindingType
  resourceId: string
  durationSeconds?: number
}): void {
  if (!KINDS.includes(input.kind)) fail("invalid_declaration")
  if (!BINDING_TYPES.includes(input.bindingType)) fail("invalid_declaration")
  if (!input.resourceId) fail("invalid_declaration")
  if (!Number.isSafeInteger(input.file.size) || input.file.size <= 0) fail("invalid_declaration")
  if (!input.file.type.toLowerCase().startsWith(`${input.kind}/`)) fail("invalid_declaration")
  if (
    input.durationSeconds != null
    && (!Number.isSafeInteger(input.durationSeconds) || input.durationSeconds <= 0)
  ) {
    fail("invalid_declaration")
  }
}

function parsePending(value: unknown): PendingMediaUpload | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  if (
    typeof row.sessionId !== "string"
    || !KINDS.includes(row.kind as MediaClientKind)
    || !BINDING_TYPES.includes(row.bindingType as MediaClientBindingType)
    || typeof row.resourceId !== "string"
    || typeof row.uploadUrl !== "string"
    || !/^https:\/\/api\.cloudinary\.com\//.test(row.uploadUrl)
    || typeof row.expiresAt !== "string"
    || typeof row.createdAt !== "string"
    || (row.uploadedAt !== null && typeof row.uploadedAt !== "string")
    || !row.params
    || typeof row.params !== "object"
  ) {
    return null
  }
  const params: Record<string, string> = {}
  for (const [key, entry] of Object.entries(row.params as Record<string, unknown>)) {
    if (typeof entry !== "string") return null
    params[key] = entry
  }
  if (!params.signature || !params.api_key || !params.public_id || !params.timestamp) return null
  return {
    sessionId: row.sessionId,
    kind: row.kind as MediaClientKind,
    bindingType: row.bindingType as MediaClientBindingType,
    resourceId: row.resourceId,
    uploadUrl: row.uploadUrl,
    params,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    uploadedAt: (row.uploadedAt as string | null | undefined) ?? null,
  }
}

/**
 * Defensive parse of local storage. Unknown or partially-written entries are
 * dropped, not trusted; the last N sessions are kept, newest last.
 */
export function parsePendingMediaUploads(raw: string | null): PendingMediaUpload[] {
  if (!raw) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const parsed: PendingMediaUpload[] = []
  for (const item of value) {
    const row = parsePending(item)
    if (!row || seen.has(row.sessionId)) continue
    seen.add(row.sessionId)
    parsed.push(row)
  }
  return parsed.slice(-MEDIA_UPLOAD_STORAGE_LIMIT)
}

export function createBrowserMediaUploadStorage(): MediaUploadStorage {
  return {
    read() {
      if (typeof window === "undefined") return []
      try {
        return parsePendingMediaUploads(window.localStorage.getItem(MEDIA_UPLOAD_STORAGE_KEY))
      } catch {
        return []
      }
    },
    save(items) {
      if (typeof window === "undefined") return
      try {
        window.localStorage.setItem(
          MEDIA_UPLOAD_STORAGE_KEY,
          JSON.stringify(items.slice(-MEDIA_UPLOAD_STORAGE_LIMIT)),
        )
      } catch {
        // Private mode/quota: resumability is best-effort, the upload itself
        // still proceeds and finalize still records the server-side result.
      }
    },
  }
}

function remember(storage: MediaUploadStorage, pending: PendingMediaUpload): void {
  const items = storage.read().filter(item => item.sessionId !== pending.sessionId)
  items.push(pending)
  storage.save(items)
}

function forget(storage: MediaUploadStorage, sessionId: string): void {
  storage.save(storage.read().filter(item => item.sessionId !== sessionId))
}

function outcomeOf(
  finalized: FinalizeMediaUploadResponse,
): Extract<MediaUploadOutcome, { state: "ready" | "quarantined" }> {
  return finalized.ok
    ? { state: "ready", assetId: finalized.assetId }
    : { state: "quarantined", assetId: finalized.assetId, detail: finalized.detail }
}

async function reconcileFinalized(
  api: MediaUploadApi,
  storage: MediaUploadStorage,
  sessionId: string,
  signal?: AbortSignal,
): Promise<MediaUploadOutcome> {
  const session = await api.status(sessionId, signal)
  if (session.state !== "finalized" || !session.assetId) {
    forget(storage, sessionId)
    return session.state === "finalized"
      ? { state: "not_found", sessionId }
      : { state: "expired", sessionId }
  }
  forget(storage, sessionId)
  if (session.assetState === "ready") {
    return { state: "ready", assetId: session.assetId }
  }
  return {
    state: "quarantined",
    assetId: session.assetId,
    detail: session.assetState ?? "quarantined",
  }
}

export async function startMediaUpload(input: {
  api: MediaUploadApi
  storage: MediaUploadStorage
  file: MediaUploadFile
  kind: MediaClientKind
  bindingType: MediaClientBindingType
  resourceId: string
  durationSeconds?: number
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}): Promise<Extract<MediaUploadOutcome, { state: "ready" | "quarantined" }>> {
  assertDeclaration(input)

  let authorized: AuthorizeMediaUploadResponse
  try {
    authorized = await input.api.authorize({
      kind: input.kind,
      mimeType: input.file.type.toLowerCase(),
      bytes: input.file.size,
      ...(input.durationSeconds != null ? { durationSeconds: input.durationSeconds } : {}),
      bindingType: input.bindingType,
      resourceId: input.resourceId,
    }, input.signal)
  } catch (error) {
    throw error instanceof MediaClientError ? error : new MediaClientError("unknown")
  }

  const pending: PendingMediaUpload = {
    sessionId: authorized.sessionId,
    kind: input.kind,
    bindingType: input.bindingType,
    resourceId: input.resourceId,
    uploadUrl: authorized.uploadUrl,
    params: authorized.params,
    expiresAt: authorized.expiresAt,
    createdAt: new Date().toISOString(),
    uploadedAt: null,
  }
  remember(input.storage, pending)

  try {
    await input.api.upload({
      uploadUrl: pending.uploadUrl,
      params: pending.params,
      file: input.file,
      onProgress: input.onProgress,
    }, input.signal)
  } catch (error) {
    const failure = error instanceof MediaClientError
      ? error
      : new MediaClientError("network", { retryable: true })
    if (!failure.retryable) forget(input.storage, pending.sessionId)
    throw failure
  }

  pending.uploadedAt = new Date().toISOString()
  remember(input.storage, pending)
  return finishPending(input.api, input.storage, pending, input.signal)
}

async function finishPending(
  api: MediaUploadApi,
  storage: MediaUploadStorage,
  pending: PendingMediaUpload,
  signal?: AbortSignal,
): Promise<Extract<MediaUploadOutcome, { state: "ready" | "quarantined" }>> {
  try {
    const finalized = await api.finalize(pending.sessionId, signal)
    forget(storage, pending.sessionId)
    return outcomeOf(finalized)
  } catch (error) {
    const failure = error instanceof MediaClientError
      ? error
      : new MediaClientError("unknown")
    if (failure.code === "conflict") {
      // A lost finalize response is the common case here: the server may have
      // committed an asset while the browser saw a dropped connection.
      const reconciled = await reconcileFinalized(api, storage, pending.sessionId, signal)
      if (reconciled.state === "ready" || reconciled.state === "quarantined") {
        return reconciled
      }
      throw failure
    }
    if (DROP_ON_FAILURE.has(failure.code)) forget(storage, pending.sessionId)
    // provider_not_found immediately after an accepted upload is transient
    // provider eventual consistency; keep the pending entry and let resume
    // ask the provider again instead of uploading a second object.
    throw failure
  }
}

/**
 * Reconcile one interrupted session. The file is optional: if the provider
 * already has the bytes, finalize succeeds without it.
 */
export async function resumeMediaUpload(input: {
  api: MediaUploadApi
  storage: MediaUploadStorage
  sessionId: string
  file?: MediaUploadFile
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}): Promise<MediaUploadOutcome> {
  const pending = input.storage.read().find(item => item.sessionId === input.sessionId)
  if (!pending) return { state: "not_found", sessionId: input.sessionId }

  let session: MediaUploadSessionStatus
  try {
    session = await input.api.status(pending.sessionId, input.signal)
  } catch (error) {
    const failure = error instanceof MediaClientError ? error : new MediaClientError("unknown")
    if (failure.code === "not_found") forget(input.storage, pending.sessionId)
    throw failure
  }

  if (session.state === "finalized") {
    return reconcileFinalized(input.api, input.storage, pending.sessionId, input.signal)
  }
  if (session.state === "expired" || session.state === "cancelled") {
    forget(input.storage, pending.sessionId)
    return { state: "expired", sessionId: pending.sessionId }
  }

  try {
    return await finishPending(input.api, input.storage, pending, input.signal)
  } catch (error) {
    const failure = error instanceof MediaClientError ? error : new MediaClientError("unknown")
    if (failure.code !== "provider_not_found") throw failure

    // The signature is single-use and the provider does not see the object.
    // Retry the transfer only if it was never acknowledged to us; otherwise
    // this is provider consistency lag and must not create a second upload.
    if (pending.uploadedAt) throw failure
    if (!input.file) return { state: "needs_file", sessionId: pending.sessionId }

    await input.api.upload({
      uploadUrl: pending.uploadUrl,
      params: pending.params,
      file: input.file,
      onProgress: input.onProgress,
    }, input.signal)
    pending.uploadedAt = new Date().toISOString()
    remember(input.storage, pending)
    return finishPending(input.api, input.storage, pending, input.signal)
  }
}

export function pendingMediaUploads(storage: MediaUploadStorage): PendingMediaUpload[] {
  return storage.read()
}

function errorFor(status: number, body: unknown): MediaClientError {
  const serverCode = (
    body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : ""
  )
  const detail = (
    body && typeof body === "object" && typeof (body as { detail?: unknown }).detail === "string"
      ? (body as { detail: string }).detail
      : undefined
  )
  switch (serverCode) {
    case "unauthorized":
      return new MediaClientError("unauthorized", { status, detail })
    case "permission_denied":
    case "session_not_owner":
      return new MediaClientError("forbidden", { status, detail })
    case "session_not_found":
    case "resource_not_found":
    case "tenant_not_found":
      return new MediaClientError("not_found", { status, detail })
    case "session_expired":
      return new MediaClientError("expired", { status, detail })
    case "session_cancelled":
      return new MediaClientError("cancelled", { status, detail })
    case "already_finalized":
      return new MediaClientError("conflict", { status, detail })
    case "quota_exceeded":
      return new MediaClientError("quota_exceeded", { status, detail })
    case "limits_unconfigured":
      return new MediaClientError("limits_unconfigured", { status, detail })
    case "quota_unconfigured":
      return new MediaClientError("quota_unconfigured", { status, detail })
    case "provider_unconfigured":
      return new MediaClientError("provider_unconfigured", { status, detail })
    case "provider_unavailable":
      return new MediaClientError("provider_unavailable", { status, detail })
    case "provider_not_found":
      return new MediaClientError("provider_not_found", { status, detail })
    case "invalid_request":
      return new MediaClientError("invalid_declaration", { status, detail })
    default:
      break
  }
  if (status === 401) return new MediaClientError("unauthorized", { status, detail })
  if (status === 403) return new MediaClientError("forbidden", { status, detail })
  if (status === 404) return new MediaClientError("not_found", { status, detail })
  if (status === 409) return new MediaClientError("conflict", { status, detail })
  if (status === 413 || status === 400) {
    return new MediaClientError("invalid_declaration", { status, detail })
  }
  if (status === 503 || status >= 500) {
    return new MediaClientError("provider_unavailable", { status, detail })
  }
  return new MediaClientError("unknown", { status, detail })
}

async function jsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function uploadWithProgress(
  input: MediaUploadRequest,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof XMLHttpRequest === "undefined") {
      reject(new MediaClientError("unknown", { detail: "XMLHttpRequest unavailable" }))
      return
    }
    if (signal?.aborted) {
      reject(new MediaClientError("cancelled"))
      return
    }

    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    xhr.open("POST", input.uploadUrl)
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) {
        input.onProgress?.(Math.min(1, event.loaded / event.total))
      }
    }
    xhr.onload = () => {
      signal?.removeEventListener("abort", abort)
      if (xhr.status >= 200 && xhr.status < 300) {
        input.onProgress?.(1)
        resolve()
        return
      }
      reject(errorFor(xhr.status, safeJson(xhr.responseText)))
    }
    xhr.onerror = () => {
      signal?.removeEventListener("abort", abort)
      reject(new MediaClientError("network", { retryable: true }))
    }
    xhr.onabort = () => {
      signal?.removeEventListener("abort", abort)
      reject(new MediaClientError("cancelled"))
    }
    signal?.addEventListener("abort", abort, { once: true })

    const form = new FormData()
    for (const [key, value] of Object.entries(input.params)) form.append(key, value)
    form.append("file", input.file as unknown as Blob, input.file.name)
    xhr.send(form)
  })
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Browser transport. The signed params are held in memory and, for recovery,
 * in localStorage until finalize. They authorize one public id under the
 * server's byte/format ceiling and expire with the session, so a leaked copy is
 * not a general upload credential.
 */
export function createBrowserMediaUploadApi(
  fetchImpl: typeof fetch = fetch,
): MediaUploadApi {
  return {
    async authorize(input, signal) {
      const response = await fetchImpl("/api/media/uploads/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        credentials: "same-origin",
        signal,
      })
      const body = await jsonBody(response)
      if (!response.ok) throw errorFor(response.status, body)
      return body as AuthorizeMediaUploadResponse
    },

    upload(input, signal) {
      return uploadWithProgress(input, signal)
    },

    async finalize(sessionId, signal) {
      const response = await fetchImpl(
        `/api/media/uploads/${encodeURIComponent(sessionId)}/finalize`,
        {
          method: "POST",
          credentials: "same-origin",
          signal,
        },
      )
      const body = await jsonBody(response)
      if (response.status === 422) {
        const failure = body as { error?: unknown; assetId?: unknown; detail?: unknown } | null
        if (failure?.error === "quarantined" && typeof failure.assetId === "string") {
          return {
            ok: false,
            reason: "quarantined",
            assetId: failure.assetId,
            detail: typeof failure.detail === "string" ? failure.detail : "quarantined",
          }
        }
      }
      if (!response.ok) throw errorFor(response.status, body)
      return body as FinalizeMediaUploadResponse
    },

    async status(sessionId, signal) {
      const response = await fetchImpl(
        `/api/media/uploads/${encodeURIComponent(sessionId)}`,
        { method: "GET", credentials: "same-origin", signal },
      )
      const body = await jsonBody(response)
      if (!response.ok) throw errorFor(response.status, body)
      return body as MediaUploadSessionStatus
    },
  }
}
