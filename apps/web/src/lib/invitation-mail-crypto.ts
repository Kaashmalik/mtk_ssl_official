import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

function key(): Buffer {
  const raw = process.env.INVITATION_EMAIL_ENCRYPTION_KEY ?? ""
  const bytes = Buffer.from(raw, "base64")
  if (bytes.length !== 32 || bytes.toString("base64") !== raw) throw new Error("Invitation queue requires a canonical base64 32-byte encryption key")
  return bytes
}

export function invitationQueueKeyId(): string {
  key()
  const id = process.env.INVITATION_EMAIL_KEY_ID ?? "v1"
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) throw new Error("Invalid invitation queue key id")
  return id
}

export function encryptInvitationMail(message: unknown, binding: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  cipher.setAAD(Buffer.from(binding))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(message), "utf8"), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map(value => value.toString("base64")).join(".")
}

export function decryptInvitationMail(encrypted: string, binding: string): unknown {
  const parts = encrypted.split(".")
  if (parts.length !== 3) throw new Error("Invalid encrypted invitation message")
  const [iv, tag, ciphertext] = parts.map(value => Buffer.from(value, "base64"))
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted invitation message")
  const cipher = createDecipheriv("aes-256-gcm", key(), iv)
  cipher.setAAD(Buffer.from(binding))
  cipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString("utf8"))
}
