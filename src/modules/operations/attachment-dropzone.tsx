"use client";
import {useState,type ReactNode} from "react";
import {Text} from "@mantine/core";
export function OperationAttachmentDropzone({children,disabled,onFiles,label="Arraste arquivos para anexar"}:{children:ReactNode;disabled?:boolean;onFiles:(files:File[])=>Promise<void>;label?:string}){
 const [over,setOver]=useState(false);
 return <div role="region" aria-label={label} onDragOver={event=>{event.preventDefault();event.stopPropagation();if(!disabled&&event.dataTransfer.types.includes("Files")){event.dataTransfer.dropEffect="copy";setOver(true);}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOver(false);}} onDrop={event=>{event.preventDefault();event.stopPropagation();setOver(false);if(!disabled){const files=Array.from(event.dataTransfer.files);if(files.length)void onFiles(files);}}} style={{border:over?"2px dashed var(--mantine-color-blue-5)":"2px solid transparent",borderRadius:12,background:over?"var(--mantine-color-blue-light)":undefined,padding:2}}>{children}{!disabled&&<Text size="xs" c={over?"blue":"dimmed"} ta="center" py={5}>{over?"Solte aqui para anexar":label}</Text>}</div>;
}
