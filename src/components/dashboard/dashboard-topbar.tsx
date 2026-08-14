"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "@/app/dashboard.module.css";

type ProfileData = {
  user: {
    name: string;
    email: string;
    role: string;
  };
};

type NotificationItem = {
  id: string;
  type: "ERROR" | "WARNING" | "INFO" | "SUCCESS";
  title: string;
  description: string;
  href: string;
  createdAt: string;
};

const roleLabels: Record<string, string> = {
  MASTER: "Master",
  ADMIN: "Administrador",
  MANAGER: "Gestor",
  OPERATOR: "Operador",
  CLIENT: "Cliente",
};

function timeAgo(value: string) {
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(difference / 60000));

  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

export function DashboardTopbar() {
  const router = useRouter();
  const pathname = usePathname();
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);

  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [darkMode, setDarkMode] = useState(false);

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && Array.isArray(payload?.items)) {
        setNotifications(payload.items);
      }
    } catch {
      // Mantém a última lista disponível quando a conexão oscilar.
    }
  }, []);

  useEffect(() => {
    void fetch("/api/profile", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (payload?.user) setProfile(payload);
      })
      .catch(() => undefined);

    const stored = window.localStorage.getItem("fortuno-notifications-read");
    if (stored) {
      try {
        setReadIds(JSON.parse(stored));
      } catch {
        setReadIds([]);
      }
    }

    const theme = window.localStorage.getItem("fortuno-theme") === "dark";
    setDarkMode(theme);
    document.documentElement.dataset.theme = theme ? "dark" : "light";
  }, []);

  useEffect(() => {
    void loadNotifications();
    const interval = window.setInterval(() => void loadNotifications(), 30000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadNotifications();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadNotifications]);

  useEffect(() => {
    setProfileOpen(false);
    setNotificationsOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handleOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (!profileRef.current?.contains(target)) setProfileOpen(false);
      if (!notificationRef.current?.contains(target)) {
        setNotificationsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const unread = useMemo(
    () => notifications.filter((item) => !readIds.includes(item.id)).length,
    [notifications, readIds],
  );

  function markAllRead() {
    const ids = notifications.map((item) => item.id);
    setReadIds(ids);
    window.localStorage.setItem(
      "fortuno-notifications-read",
      JSON.stringify(ids),
    );
  }

  function openNotification(item: NotificationItem) {
    const next = Array.from(new Set([...readIds, item.id]));
    setReadIds(next);
    window.localStorage.setItem(
      "fortuno-notifications-read",
      JSON.stringify(next),
    );
    setNotificationsOpen(false);
    router.push(item.href as Route);
  }

  function toggleTheme() {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    window.localStorage.setItem("fortuno-theme", next ? "dark" : "light");
  }

  const profileName = profile?.user.name || "Usuário";
  const profileRole =
    roleLabels[profile?.user.role || ""] || profile?.user.role || "Conta";
  const initials = profileName
    .split(/\s+/)
    .slice(0, 2)
    .map((item) => item[0])
    .join("")
    .toUpperCase();

  return (
    <header className={styles.topbar}>
      <div className={styles.searchBox}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6" />
          <path d="m16 16 4 4" />
        </svg>

        <input
          type="search"
          placeholder="Buscar..."
          aria-label="Buscar no Fortuno Hub"
        />
        <span>Ctrl K</span>
      </div>

      <div className={styles.topbarActions}>
        <div className={styles.notificationWrapper} ref={notificationRef}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Notificações"
            onClick={() => {
              setNotificationsOpen((current) => !current);
              setProfileOpen(false);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
              <path d="M10 21h4" />
            </svg>
            {unread > 0 && (
              <span className={styles.notificationBadge}>
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>

          {notificationsOpen && (
            <div className={styles.notificationsMenu}>
              <div className={styles.notificationsHeader}>
                <div>
                  <strong>Notificações</strong>
                  <span>{unread} não lida(s)</span>
                </div>
                {unread > 0 && (
                  <button type="button" onClick={markAllRead}>
                    Marcar todas como lidas
                  </button>
                )}
              </div>

              <div className={styles.notificationsList}>
                {notifications.length === 0 ? (
                  <div className={styles.emptyNotifications}>
                    Nenhuma pendência operacional no momento.
                  </div>
                ) : (
                  notifications.map((item) => {
                    const read = readIds.includes(item.id);

                    return (
                      <button
                        type="button"
                        key={item.id}
                        className={`${styles.notificationItem} ${
                          read ? styles.notificationRead : ""
                        }`}
                        onClick={() => openNotification(item)}
                      >
                        <span
                          className={`${styles.notificationType} ${
                            styles[`notification${item.type}`]
                          }`}
                        />
                        <span className={styles.notificationContent}>
                          <strong>{item.title}</strong>
                          <small>{item.description}</small>
                          <time>{timeAgo(item.createdAt)}</time>
                        </span>
                        {!read && <i />}
                      </button>
                    );
                  })
                )}
              </div>

              <Link href="/historico" className={styles.notificationsFooter}>
                Ver histórico operacional
              </Link>
            </div>
          )}
        </div>

        <button
          type="button"
          className={styles.iconButton}
          aria-label={darkMode ? "Usar tema claro" : "Usar tema escuro"}
          onClick={toggleTheme}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 15.5A8.5 8.5 0 1 1 8.5 4 7 7 0 0 0 20 15.5Z" />
          </svg>
        </button>

        <div className={styles.profileWrapper} ref={profileRef}>
          <button
            type="button"
            className={styles.profileButton}
            onClick={() => {
              setProfileOpen((current) => !current);
              setNotificationsOpen(false);
            }}
            aria-expanded={profileOpen}
            aria-haspopup="menu"
          >
            <span className={styles.profileAvatar}>{initials || "U"}</span>
            <span className={styles.profileText}>
              <strong>{profileName}</strong>
              <small>{profileRole}</small>
            </span>
            <span className={styles.profileChevron}>⌄</span>
          </button>

          {profileOpen && (
            <div className={styles.profileMenu} role="menu">
              <Link href="/perfil" role="menuitem">
                Meu perfil
              </Link>
              <Link href="/configuracoes" role="menuitem">
                Configurações
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  window.location.href = "/auth/signout";
                }}
              >
                Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
