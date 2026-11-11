"use client";
import {useEffect} from "react";
import {RECOVERY_INTENT_COOKIE,recoveryReturnPath} from "@/lib/auth/recovery-return";
export function RecoveryLanding(){
 useEffect(()=>{const intended=document.cookie.split(";").some(part=>part.trim()===`${RECOVERY_INTENT_COOKIE}=1`);const destination=recoveryReturnPath(window.location.href,intended);if(destination)window.location.replace(destination);},[]);
 return null;
}
