"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronRight, FileCheck, GitPullRequest, Headphones, ShieldAlert, Sliders, User } from "lucide-react";

export type RoleIcon = "requester" | "service-agent" | "incident-manager" | "process-change" | "platform-admin" | "auditor";

export interface RoleDefinition {
  id: string;
  roleKey: string;
  name: string;
  tagline: string;
  description: string;
  dashboardPath: string;
  icon: RoleIcon;
  responsibilities: string[];
  capabilities: string[];
  targetAudience: string;
}

const ROLE_ICONS = {
  requester: User,
  "service-agent": Headphones,
  "incident-manager": ShieldAlert,
  "process-change": GitPullRequest,
  "platform-admin": Sliders,
  auditor: FileCheck,
};

function RoleSelector({role,selected,onSelect,isSecond}:{role:RoleDefinition;selected:boolean;onSelect:(id:string)=>void;isSecond:boolean}) {
  const Icon = ROLE_ICONS[role.icon];
  return <button id={role.id} type="button" aria-expanded={selected} aria-controls={`role-details-${role.id}`} onClick={()=>onSelect(role.id)} className={`flex min-w-0 scroll-mt-24 items-center gap-4 px-4 py-6 text-left transition focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6D28D9] sm:px-5 ${isSecond?"border-t border-[#E6E9F0] md:border-l md:border-t-0":""} ${selected?"bg-[#F1ECFE]":"hover:bg-[#FAF8FF]"}`}>
    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${selected?"bg-white text-[#5B21B6]":"bg-[#F1ECFE] text-[#6D28D9]"}`}><Icon className="h-5 w-5" /></span>
    <span className="min-w-0 flex-1"><span className="block text-base font-bold text-[#0E1726] sm:text-lg">{role.name}</span><span className="mt-1 block text-sm leading-6 text-[#6B7488]">{role.tagline}</span></span>
    <ChevronRight className={`h-5 w-5 shrink-0 text-[#6D28D9] transition-transform ${selected?"rotate-90":""}`} />
  </button>;
}

function RoleDetails({role,isAuthenticated}:{role:RoleDefinition;isAuthenticated:boolean}) {
  const targetUrl = isAuthenticated ? role.dashboardPath : `/itsm/login?next=${encodeURIComponent(role.dashboardPath)}`;
  return <section id={`role-details-${role.id}`} aria-label={`${role.name} details`} className="border-t border-[#DDD6FE] bg-[#FCFAFF] px-5 py-8 sm:px-8 sm:py-9 lg:px-12 lg:py-10">
    <div className="max-w-4xl">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#6D28D9]">Role focus</p>
      <p className="mt-3 text-base leading-7 text-[#475069]">{role.description}</p>
    </div>
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(250px,.85fr)] lg:gap-10">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-[#0E1726]">Main responsibilities</h2>
        <ul className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {role.responsibilities.map((responsibility)=><li key={responsibility} className="flex items-start gap-2.5 text-sm leading-6 text-[#475069]"><Check aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-[#6D28D9]"/><span>{responsibility}</span></li>)}
        </ul>
      </div>
      <div className="border-t border-[#DDD6FE] pt-7 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-[#0E1726]">Workspace includes</h2>
        <ul className="mt-4 space-y-2.5">
          {role.capabilities.map((capability)=><li key={capability} className="flex items-start gap-2.5 text-sm leading-6 text-[#475069]"><Check aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-[#6D28D9]"/><span>{capability}</span></li>)}
        </ul>
        <div className="mt-7 border-t border-[#DDD6FE] pt-6">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-[#0E1726]">Best suited for</h2>
          <p className="mt-3 text-sm leading-6 text-[#475069]">{role.targetAudience}</p>
        </div>
      </div>
    </div>
    <div className="mt-9 flex flex-col gap-4 border-t border-[#DDD6FE] pt-6 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-[#6B7488]">Open the workspace for this role.</p>
      <Link href={targetUrl} className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg bg-[#6D28D9] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#5B21B6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] focus-visible:ring-offset-2 sm:self-auto">{isAuthenticated?"Open workspace":"Sign in to access"}<ArrowRight aria-hidden="true" className="h-4 w-4"/></Link>
    </div>
  </section>;
}

export default function RoleDirectory({roles,isAuthenticated}:{roles:RoleDefinition[];isAuthenticated:boolean}) {
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const pairs:Array<RoleDefinition[]>=[];
  for(let index=0;index<roles.length;index+=2)pairs.push(roles.slice(index,index+2));

  const selectRole=(id:string)=>setSelectedId(current=>current===id?null:id);

  return <div className="mt-12 border-y border-[#DDD6FE]">
    {pairs.map((pair,pairIndex)=>{
      const selectedRole=pair.find(role=>role.id===selectedId)||null;
      return <section key={pair[0].id} className={pairIndex>0?"border-t border-[#DDD6FE]":""}>
        <div className="grid md:grid-cols-2">
          {pair.map((role,index)=><RoleSelector key={role.id} role={role} selected={role.id===selectedId} onSelect={selectRole} isSecond={index===1}/>)}
        </div>
        {selectedRole?<RoleDetails role={selectedRole} isAuthenticated={isAuthenticated}/>:null}
      </section>;
    })}
  </div>;
}
