'use client';
import { useEffect,useRef,type ReactNode } from 'react';
export function HomeworkDialog({titleId,onClose,children}:{titleId:string;onClose:()=>void;children:ReactNode}){
 const dialog=useRef<HTMLElement>(null),close=useRef(onClose);useEffect(()=>{close.current=onClose},[onClose]);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,node=dialog.current;const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close.current()}if(event.key==='Tab'&&node){const controls=[...node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],textarea:not(:disabled)')];const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}};node?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus()}},[]);
 return <div className="hw-modal-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)close.current()}}><section ref={dialog} className="hw-confirm" role="dialog" aria-modal="true" aria-labelledby={titleId}>{children}</section></div>;
}
