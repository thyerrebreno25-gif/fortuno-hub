"use client";
import {useState,type ReactNode} from "react";
import {IconChevronDown} from "@tabler/icons-react";
import styles from "@/app/(platform)/whatsapp/whatsapp.module.css";
export function WhatsAppSidebarSection({title,children}:{title:string;children:ReactNode}){
 const [opened,setOpened]=useState(true);
 const id="whatsapp-sidebar-"+title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
 return <section className={styles.filterSection}><button type="button" className={styles.filterSectionToggle} aria-expanded={opened} aria-controls={id} onClick={()=>setOpened(value=>!value)}><span>{title}</span><IconChevronDown size={14} style={{transform:opened?undefined:"rotate(-90deg)"}}/></button><div id={id} hidden={!opened}>{children}</div></section>;
}
