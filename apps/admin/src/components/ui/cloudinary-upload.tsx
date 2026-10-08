"use client";

import { useState, useRef } from "react";
import { Upload, X, Loader2, ImageIcon } from "lucide-react";
import Image from "next/image";

interface CloudinaryUploadProps {
  value?: string;
  onChange: (url: string) => void;
  onClear?: () => void;
  folder?: string;
  label?: string;
  accept?: "image" | "video" | "auto";
  aspectRatio?: string;
}

export function CloudinaryUpload({
  value,
  onChange,
  onClear,
  folder = "ssl-admin",
  label = "Upload image",
  accept = "image",
  aspectRatio = "aspect-video",
}: CloudinaryUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME!;
  const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET!;

  async function handleFile(file: File) {
    if (!file) return;

    const maxMB = accept === "video" ? 100 : 10;
    if (file.size > maxMB * 1024 * 1024) {
      setError(`File must be under ${maxMB}MB`);
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", UPLOAD_PRESET);
      formData.append("folder", folder);

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${accept}/upload`,
        { method: "POST", body: formData }
      );

      if (!res.ok) throw new Error("Upload failed");

      const data = await res.json();
      onChange(data.secure_url);
    } catch (err) {
      setError("Upload failed. Please try again.");
      console.error("Cloudinary upload error:", err);
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  if (value) {
    return (
      <div className="relative group rounded-xl overflow-hidden border border-border/50 bg-muted/20">
        <div className={`relative w-full ${aspectRatio}`}>
          {accept === "video" ? (
            <video src={value} controls className="w-full h-full object-cover" />
          ) : (
            <Image
              src={value}
              alt="Uploaded"
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          )}
        </div>
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-white transition-colors"
          >
            <Upload className="h-3 w-3" />
            Replace
          </button>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 transition-colors"
            >
              <X className="h-3 w-3" />
              Remove
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept === "video" ? "video/*" : "image/*"}
          className="hidden"
          onChange={handleInputChange}
        />
      </div>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => !uploading && inputRef.current?.click()}
      className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border/50 bg-muted/20 p-8 text-center transition-all cursor-pointer hover:border-primary/50 hover:bg-primary/5 ${uploading ? "pointer-events-none" : ""}`}
    >
      {uploading ? (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground">Uploading…</p>
        </>
      ) : (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ImageIcon className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Drag & drop or click to browse
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground/60">
              {accept === "video" ? "MP4, WebM up to 100MB" : "PNG, JPG, WebP up to 10MB"}
            </p>
          </div>
        </>
      )}

      {error && (
        <p className="absolute bottom-3 text-xs text-red-500 font-medium">{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept === "video" ? "video/*" : "image/*"}
        className="hidden"
        onChange={handleInputChange}
      />
    </div>
  );
}

export function cloudinaryUrl(
  publicId: string,
  transforms: string = "w_800,q_auto,f_auto"
): string {
  const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transforms}/${publicId}`;
}
