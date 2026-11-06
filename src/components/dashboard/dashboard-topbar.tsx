"use client";
import { notifications as toastNotifications } from "@mantine/notifications";
import { notificationIds, popupBatch } from "@/modules/notifications/popup-state";

import {rememberLoginProfile} from "@/modules/profile/remembered-login";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Button, useMantineColorScheme } from "@mantine/core";
import styles from "@/app/dashboard.module.css";

type ProfileData = {
  user: {
    avatar?:string|null;
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
  popup?: boolean;
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
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);

  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [readIds,setReadIds]=useState<string[]>([]);
  const viewerKey=useRef("");
  const notificationBusy=useRef(false);
  const activePopups=useRef<string[]>([]);
  const shownMemory=useRef<string[]>([]), readMemory=useRef<string[]>([]);
  const darkMode = colorScheme === "dark";

  const loadNotifications = useCallback(async () => {
    if(notificationBusy.current || document.visibilityState !== "visible") return;
    notificationBusy.current=true;
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && Array.isArray(payload?.items)) {
        const scope=typeof payload.viewerKey === "string" ? payload.viewerKey : "";
        if(!scope) return;
        const readKey="fortuno-notifications-read:"+scope,popupKey="fortuno-notifications-shown:"+scope;
        let storedRead:string[]=[],storedShown:string[]=[];
        try{storedRead=notificationIds(window.localStorage.getItem(readKey));storedShown=notificationIds(window.localStorage.getItem(popupKey));}catch{}
        if(viewerKey.current !== scope){for(const id of activePopups.current)toastNotifications.hide(id);activePopups.current=[];viewerKey.current=scope;shownMemory.current=[];readMemory.current=[];}
        storedRead=[...new Set([...storedRead,...readMemory.current])].slice(-1000);
        storedShown=[...new Set([...storedShown,...shownMemory.current])].slice(-1000);
        if(payload.whatsappNotificationsMuted){storedShown=[...new Set([...storedShown,...payload.items.filter((item:NotificationItem)=>item.href.startsWith("/whatsapp")).map((item:NotificationItem)=>item.id)])].slice(-1000);activePopups.current=activePopups.current.filter(id=>{if(id.includes(":whatsapp-message-")){toastNotifications.hide(id);return false;}return true;});}
        readMemory.current=storedRead;setReadIds(current=>current.length===storedRead.length&&current.every((id,index)=>id===storedRead[index])?current:storedRead);
        const batch=popupBatch<NotificationItem>(payload.items,storedShown,storedRead);
        shownMemory.current=batch.seen;
        if(batch.show.some(item=>item.href.startsWith("/reunioes"))) window.dispatchEvent(new Event("fortuno:calendar-changed"));
        try{window.localStorage.setItem(popupKey,JSON.stringify(batch.seen));}catch{}
        for(const item of batch.show){const id="fortuno:"+scope+":"+item.id;activePopups.current.push(id);toastNotifications.show({id,title:item.title,color:item.type === "WARNING" ? "orange" : item.type === "ERROR" ? "red" : "blue",autoClose:12000,message:<div>{item.description}<br/><Button type="button" size="compact-xs" variant="light" mt="xs" onClick={()=>{setReadIds(current=>{const next=[...new Set([...current,item.id])].slice(-1000);try{window.localStorage.setItem(readKey,JSON.stringify(next));}catch{}readMemory.current=next;return next;});window.dispatchEvent(new CustomEvent("fortuno:notification-open",{detail:{href:item.href}}));router.push(item.href as Route);toastNotifications.hide(id);}}>Ver aviso</Button></div>});}
        activePopups.current=activePopups.current.slice(-60);
        setNotifications(payload.items);
      }
    } catch {
      // Mantém a última lista disponível quando a conexão oscilar.
    } finally { notificationBusy.current=false; }
  }, [router]);

  useEffect(() => {
    const loadProfile=()=>{void fetch("/api/profile", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (payload?.user) {setProfile(payload);rememberLoginProfile(payload.user,payload.loginDay);}
      })
      .catch(() => undefined);};
    loadProfile();window.addEventListener("fortuno:profile-updated",loadProfile);return()=>window.removeEventListener("fortuno:profile-updated",loadProfile);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = colorScheme;
  }, [colorScheme]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadNotifications(), 0);
    const interval = window.setInterval(() => void loadNotifications(), 15000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadNotifications();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("fortuno:notifications-refresh",handleVisibility);
    const muteWhatsApp=(event:Event)=>{if((event as CustomEvent<{muted:boolean}>).detail?.muted){activePopups.current=activePopups.current.filter(id=>{if(id.includes(":whatsapp-message-")){toastNotifications.hide(id);return false;}return true;});}};
    window.addEventListener("fortuno:whatsapp-notifications-muted",muteWhatsApp);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("fortuno:notifications-refresh",handleVisibility);
      window.removeEventListener("fortuno:whatsapp-notifications-muted",muteWhatsApp);
    };
  }, [loadNotifications]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setProfileOpen(false);
      setNotificationsOpen(false);
    }, 0);
    return () => window.clearTimeout(timeout);
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

  const unreadItems = useMemo(
    () => notifications.filter((item) => !readIds.includes(item.id)),
    [notifications, readIds],
  );

  const unread=unreadItems.length;
  function markAllRead() {
    setReadIds(current=>{const next=[...new Set([...current,...notifications.map(item=>item.id)])].slice(-1000);try{window.localStorage.setItem("fortuno-notifications-read:"+viewerKey.current,JSON.stringify(next));}catch{}readMemory.current=next;return next;});
  }
  function openNotification(item:NotificationItem) {
    setReadIds(current=>{const next=[...new Set([...current,item.id])].slice(-1000);try{window.localStorage.setItem("fortuno-notifications-read:"+viewerKey.current,JSON.stringify(next));}catch{}readMemory.current=next;return next;});
    setNotificationsOpen(false);
    window.dispatchEvent(new CustomEvent("fortuno:notification-open",{detail:{href:item.href}}));
    router.push(item.href as Route);
  }

  function toggleTheme() {
    const next = !darkMode;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    setColorScheme(next ? "dark" : "light");
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
                {unreadItems.length === 0 ? (
                  <div className={styles.emptyNotifications}>
                    Nenhuma notificação não lida no momento.
                  </div>
                ) : (
                  unreadItems.map((item) => {
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
            {darkMode ? (
              <>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
              </>
            ) : (
              <path d="M20 15.5A8.5 8.5 0 1 1 8.5 4 7 7 0 0 0 20 15.5Z" />
            )}
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
            <Avatar size={36} radius="xl" src={profile?.user.avatar}>{initials || "U"}</Avatar>
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
              <Link href="/termos-de-servico" role="menuitem" target="_blank" rel="noopener noreferrer">
                Termos de Serviço
              </Link>
              <Link href="/politica-de-privacidade" role="menuitem" target="_blank" rel="noopener noreferrer">
                Política de Privacidade
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
