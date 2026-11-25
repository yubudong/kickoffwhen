"use client";
import { useState,type ReactNode } from 'react';

// Keep native keyboard and screen-reader behavior while mounting only the open branch.
export function LazyDetails({summary,children,className}:{summary:ReactNode;children:ReactNode;className?:string}){
 const [open,setOpen]=useState(false);
 return <details className={className} open={open} onToggle={event=>{if(event.target===event.currentTarget)setOpen(event.currentTarget.open)}}><summary>{summary}</summary>{open?children:null}</details>;
}
