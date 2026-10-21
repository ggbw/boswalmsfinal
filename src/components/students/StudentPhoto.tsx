import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { signedUrl } from "@/lib/storage";

/**
 * Find the student's photo: the official `<id>/profile_photo.webp` (bulk upload
 * and the gallery's profile upload write it), else, with `fallback`, the first
 * photo in their folder. My Profile uploads write `photo_<ts>.webp` and never a
 * profile_photo, so without the fallback a student who added their own photo
 * there would still see only their initial on the dashboard.
 */
async function findPhotoUrl(studentRef: string, fallback: boolean): Promise<string> {
  const official = await signedUrl("student-photos", `${studentRef}/profile_photo.webp`);
  if (official || !fallback) return official;
  const { data: files } = await supabase.storage.from("student-photos").list(studentRef, { limit: 100 });
  const first = (files || []).find(f => f.name.endsWith(".webp") && !f.name.startsWith("thumb_"));
  return first ? signedUrl("student-photos", `${studentRef}/${first.name}`) : "";
}

/** The student's profile photo when one has been uploaded, otherwise their initial. */
export function StudentPhoto({ studentRef, name, gender, size = 52, fallback = false }: {
  studentRef: string; name: string; gender: string; size?: number; fallback?: boolean;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    setUrl("");
    findPhotoUrl(studentRef, fallback).then(u => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [studentRef, fallback]);

  if (url) {
    return (
      <img src={url} alt={name} onError={() => setUrl("")}
           style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
    );
  }
  return (
    <div className="avatar" style={{ background: gender === "Female" ? "#8250df" : "#1f6feb", width: size, height: size, fontSize: Math.round(size * 0.38), flexShrink: 0 }}>
      {name[0]}
    </div>
  );
}
