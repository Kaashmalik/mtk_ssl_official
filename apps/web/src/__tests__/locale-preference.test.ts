import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/headers", () => ({ cookies: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const cookieStore = {
  set: vi.fn(),
  get: vi.fn(() => undefined),
}
const cookiesMock = vi.mocked((await import("next/headers")).cookies)
const revalidateMock = vi.mocked((await import("next/cache")).revalidatePath)

const { setLocalePreference } = await import("@/app/actions/locale")
const { LOCALE_COOKIE } = await import("@/i18n/config")

describe("UX-03 (Batch 139): the language preference action", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cookiesMock.mockResolvedValue(cookieStore as never)
  })

  it("sets the mtk-locale cookie with honest durability for a supported locale", async () => {
    const result = await setLocalePreference("bn")
    expect(result).toEqual({ success: true, locale: "bn" })
    expect(cookieStore.set).toHaveBeenCalledWith(LOCALE_COOKIE, "bn", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      httpOnly: false,
    })
    expect(revalidateMock).toHaveBeenCalledWith("/", "layout")
  })

  it("refuses an unsupported language instead of corrupting the preference", async () => {
    await expect(setLocalePreference("fr")).rejects.toThrow("Unsupported language")
    expect(cookieStore.set).not.toHaveBeenCalled()
  })

  it("refuses locale-code-shaped junk", async () => {
    await expect(setLocalePreference("en-US; Path=/admin")).rejects.toThrow("Unsupported language")
    expect(cookieStore.set).not.toHaveBeenCalled()
  })
})
