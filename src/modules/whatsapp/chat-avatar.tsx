"use client";
import { Avatar } from "@mantine/core";
import { IconUsers } from "@tabler/icons-react";
import { memo, useEffect, useRef, useState } from "react";

const cache = new Map<string, { url: string | null; until: number }>();
const pending = new Map<string, Promise<string | null>>();
const queue: Array<() => void> = [];
let active = 0;
function pump() { while (active < 2 && queue.length) { active++; queue.shift()!(); } }
function load(id: string): Promise<string | null> {
  const stored = cache.get(id);
  if (stored && stored.until > Date.now()) return Promise.resolve(stored.url);
  const existing = pending.get(id);
  if (existing) return existing;
  const result = new Promise<string | null>(resolve => {
    queue.push(() => {
      fetch("/api/whatsapp/" + encodeURIComponent(id) + "/avatar", { signal: AbortSignal.timeout(15000) })
        .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
        .then(body => { const url = typeof body.url === "string" ? body.url : null; cache.set(id, { url, until: Date.now() + 600000 }); resolve(url); })
        .catch(() => { cache.set(id, { url: null, until: Date.now() + 60000 }); resolve(null); })
        .finally(() => { pending.delete(id); active--; if (cache.size > 1000) cache.delete(cache.keys().next().value!); pump(); });
    });
  });
  pending.set(id, result); pump(); return result;
}
export const ChatAvatar = memo(function ChatAvatar({ id, name, group, size = 40 }: { id: string; name: string; group: boolean; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [photo, setPhoto] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void load(id).then(url => { if (alive) setPhoto({ id, url }); });
    }, { rootMargin: "80px" });
    if (ref.current) observer.observe(ref.current);
    return () => { alive = false; observer.disconnect(); };
  }, [id]);
  return <Avatar ref={ref} src={photo?.id === id ? photo.url : null} alt={name} size={size} color={group ? "violet" : "green"} radius="xl" imageProps={{ loading: "lazy", decoding: "async", referrerPolicy: "no-referrer" }}>
    {group ? <IconUsers size={20} /> : (name || "?").slice(0, 1).toUpperCase()}
  </Avatar>;
});
