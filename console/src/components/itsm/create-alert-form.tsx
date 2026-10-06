import React, { useState, useEffect, useMemo } from "react";
import { AlertCircle, Link2, Search, X, ShieldAlert, Loader2, Plus, BellRing, Activity } from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import type { OutageAlert, OutageAlertLinkableRecords } from "@/lib/outage-alert-types";
import { apiErrorMessage } from "@/lib/errors";

const inputClass = "w-full rounded-lg border border-[#DDE1E8] bg-white px-3 py-2.5 text-sm text-[#0E1726] outline-none transition placeholder:text-[#8A93A5] focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10";
const labelClass = "block text-xs font-semibold text-[#0E1726] mb-1.5";
const sectionClass = "rounded-xl border border-[#E6E9F0] bg-white overflow-hidden shadow-sm";
const sectionHeaderClass = "bg-[#FBFAF9] px-5 py-4 border-b border-[#E6E9F0]";

export function CreateAlertForm({
  services,
  linkable,
  onLoadLinkable,
  requestedMajorIncidentId,
  onCancel,
  onSuccess,
}: {
  services: Array<{ id: string; name: string }>;
  linkable: OutageAlertLinkableRecords | null;
  onLoadLinkable: () => void;
  requestedMajorIncidentId: string | null;
  onCancel: () => void;
  onSuccess: (alert: OutageAlert, notice: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [whatsHappening, setWhatsHappening] = useState("");
  const [severity, setSeverity] = useState("Critical");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [audience, setAudience] = useState<Record<string, boolean>>({
    requesters: true,
    agents: true,
    managers: true,
  });
  const [whatUsersKnow, setWhatUsersKnow] = useState("");
  const [whatUsersDo, setWhatUsersDo] = useState("");
  const [nextUpdate, setNextUpdate] = useState("");
  
  const [selectedLink, setSelectedLink] = useState<{ type: string; id: string; ticket_number: string; title: string; status?: string } | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize selectedLink if requestedMajorIncidentId is present
  useEffect(() => {
    if (requestedMajorIncidentId && linkable && !selectedLink) {
      const match = linkable.major_incidents.find(mi => mi.id === requestedMajorIncidentId);
      if (match) {
        setSelectedLink({ type: "MAJOR_INCIDENT", id: match.id, ticket_number: match.ticket_number, title: match.title });
      }
    }
  }, [requestedMajorIncidentId, linkable, selectedLink]);

  const compileDraftMessage = () => {
    const parts = [];
    parts.push(`**What's Happening?**\n${whatsHappening.trim()}`);
    parts.push(`\n**Severity**: ${severity}`);
    
    const selectedAudience = [];
    if (audience.requesters) selectedAudience.push("Requesters / Users of affected services");
    if (audience.agents) selectedAudience.push("Service Agents supporting affected services");
    if (audience.managers) selectedAudience.push("Problem & Change Managers responsible for affected services");
    
    if (selectedAudience.length > 0) {
      parts.push(`\n**Target Audience**\n${selectedAudience.map(a => `- ${a}`).join("\n")}`);
    }
    
    parts.push(`\n**What Should Users Know?**\n${whatUsersKnow.trim()}`);
    if (whatUsersDo.trim()) parts.push(`\n**What Should Users Do?**\n${whatUsersDo.trim()}`);
    if (nextUpdate.trim()) parts.push(`\n**Next Update**: ${nextUpdate.trim()}`);
    return parts.join("\n");
  };

  const isFormValid = title.trim() && whatsHappening.trim() && whatUsersKnow.trim() && serviceIds.length > 0 && Object.values(audience).some(v => v);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || saving) return;
    
    setSaving(true);
    setError(null);
    
    try {
      const draftMessage = compileDraftMessage();
      const response = await fetch("/api/itsm/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          draft_message: draftMessage,
          affected_service_ids: serviceIds,
        })
      });
      
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(body, "Unable to create Alert draft"));
      
      const created = body as OutageAlert;
      let notice = "Alert draft created. Publishing remains pending the approved audience and approval policy.";
      
      if (selectedLink) {
        const linkResponse = await fetch(`/api/itsm/alerts/${created.id}/links`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_type: selectedLink.type,
            target_id: selectedLink.id,
          })
        });
        if (!linkResponse.ok) {
          const linkBody = await linkResponse.json().catch(() => ({}));
          throw new Error(apiErrorMessage(linkBody, "Alert was created, but operational record linking failed"));
        }
        notice = "Alert draft created and linked to the operational record.";
      }
      
      onSuccess(created, notice);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create Alert draft");
    } finally {
      setSaving(false);
    }
  };

  const openLinkModal = () => {
    onLoadLinkable();
    setShowLinkModal(true);
  };

  const filteredLinks = useMemo(() => {
    if (!linkable) return [];
    const query = searchQuery.toLowerCase();
    const incidents = linkable.incidents.map(i => ({ type: "INCIDENT", id: i.id, ticket_number: i.ticket_number, title: i.title, status: i.status }));
    const majors = linkable.major_incidents.map(m => ({ type: "MAJOR_INCIDENT", id: m.id, ticket_number: m.ticket_number, title: m.title, status: "Active" }));
    return [...majors, ...incidents].filter(item => 
      item.ticket_number.toLowerCase().includes(query) || item.title.toLowerCase().includes(query)
    );
  }, [linkable, searchQuery]);

  return (
    <div className="bg-[#FBFAF9] rounded-[20px] shadow-sm border border-[#DDD6FE] mb-8 overflow-hidden relative">
      <div className="bg-white border-b border-[#DDD6FE] p-5 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#0E1726]">Create Alert Draft</h2>
          <p className="mt-1 text-sm text-[#6B7488]">A draft is private. Publishing remains unavailable until approval policy is met.</p>
        </div>
        <button type="button" onClick={onCancel} className="text-[#8A93A5] hover:text-[#0E1726] transition bg-[#F5F7FA] hover:bg-[#EEF1F5] p-2 rounded-lg">
          <X className="h-5 w-5" />
        </button>
      </div>
      
      {error && <div className="m-5 p-4 rounded-xl border border-[#F1C7C1] bg-[#FFF7F6] text-[#8A241B] flex gap-3 text-sm font-semibold">
        <ShieldAlert className="h-5 w-5 shrink-0" /> {error}
      </div>}

      <form onSubmit={handleSubmit} className="p-5 space-y-8">
        
        {/* 1. Alert Information */}
        <section className={sectionClass}>
          <div className={sectionHeaderClass}>
            <h3 className="text-sm font-bold text-[#0E1726] flex items-center gap-2"><BellRing className="h-4 w-4 text-[#6D28D9]" /> Alert Information</h3>
          </div>
          <div className="p-5 space-y-5">
            <div>
              <label className={labelClass}>Alert Title <span className="text-[#8A241B]">*</span></label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Database Connectivity Degraded" className={inputClass} required />
              <p className="mt-1.5 text-[11px] text-[#6B7488]">A short, clear public-facing title for this alert.</p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-5">
              <div className="md:col-span-2">
                <label className={labelClass}>What's Happening? <span className="text-[#8A241B]">*</span></label>
                <textarea value={whatsHappening} onChange={e => setWhatsHappening(e.target.value)} placeholder="Brief description of what users are experiencing..." rows={3} className={`${inputClass} resize-y`} required />
              </div>
              <div>
                <label className={labelClass}>Severity <span className="text-[#8A241B]">*</span></label>
                <div className="grid grid-cols-1 gap-2 mt-1.5">
                  {["Critical", "High", "Medium", "Low"].map(sev => (
                    <label key={sev} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${severity === sev ? "border-[#6D28D9] bg-[#F8F5FF] text-[#6D28D9]" : "border-[#E6E9F0] bg-white text-[#475069] hover:bg-[#F5F7FA]"}`}>
                      <input type="radio" name="severity" checked={severity === sev} onChange={() => setSeverity(sev)} className="hidden" />
                      <div className={`h-3 w-3 rounded-full border-2 flex items-center justify-center ${severity === sev ? "border-[#6D28D9]" : "border-[#8A93A5]"}`}>
                        {severity === sev && <div className="h-1.5 w-1.5 rounded-full bg-[#6D28D9]" />}
                      </div>
                      {sev}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2. Service Impact */}
        <section className={sectionClass}>
          <div className={sectionHeaderClass}>
            <h3 className="text-sm font-bold text-[#0E1726] flex items-center gap-2"><Activity className="h-4 w-4 text-[#6D28D9]" /> Service Impact</h3>
          </div>
          <div className="p-5 space-y-6">
            <div>
              <label className={labelClass}>Affected Services <span className="text-[#8A241B]">*</span></label>
              <div className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-[#DDE1E8] bg-white p-2 shadow-inner">
                {services.length ? services.map(service => (
                  <label key={service.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-[#F8F5FF] transition">
                    <input type="checkbox" checked={serviceIds.includes(service.id)} onChange={e => setServiceIds(cur => e.target.checked ? [...cur, service.id] : cur.filter(id => id !== service.id))} className="h-4 w-4 rounded border-[#DDE1E8] text-[#6D28D9] focus:ring-[#6D28D9]" />
                    <span className="text-sm font-medium text-[#475069]">{service.name}</span>
                  </label>
                )) : <p className="text-sm text-[#8A93A5] p-2">No services available.</p>}
              </div>
            </div>
            
            <div className="border-t border-[#EEF1F5] pt-6">
              <label className={labelClass}>Who Should Receive This Alert? <span className="text-[#8A241B]">*</span></label>
              <p className="mb-3 text-[11px] text-[#6B7488]">Select the authorized audience that should be notified about this outage.</p>
              
              <div className="space-y-3">
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#E6E9F0] p-3 hover:bg-[#F5F7FA] transition">
                  <input type="checkbox" checked={audience.requesters} onChange={e => setAudience(a => ({ ...a, requesters: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-[#DDE1E8] text-[#6D28D9] focus:ring-[#6D28D9]" />
                  <div>
                    <span className="block text-sm font-bold text-[#0E1726]">Requesters / Users of affected services</span>
                    <span className="block text-[11px] text-[#6B7488] mt-0.5">Receives customer-safe information</span>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#E6E9F0] p-3 hover:bg-[#F5F7FA] transition">
                  <input type="checkbox" checked={audience.agents} onChange={e => setAudience(a => ({ ...a, agents: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-[#DDE1E8] text-[#6D28D9] focus:ring-[#6D28D9]" />
                  <div>
                    <span className="block text-sm font-bold text-[#0E1726]">Service Agents supporting affected services</span>
                    <span className="block text-[11px] text-[#6B7488] mt-0.5">Receives authorized support view and Incident context</span>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#E6E9F0] p-3 hover:bg-[#F5F7FA] transition">
                  <input type="checkbox" checked={audience.managers} onChange={e => setAudience(a => ({ ...a, managers: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-[#DDE1E8] text-[#6D28D9] focus:ring-[#6D28D9]" />
                  <div>
                    <span className="block text-sm font-bold text-[#0E1726]">Problem & Change Managers responsible for affected services</span>
                    <span className="block text-[11px] text-[#6B7488] mt-0.5">Receives operational context and timeline</span>
                  </div>
                </label>
              </div>

              {Object.values(audience).some(v => v) && (
                <div className="mt-4 rounded-lg bg-[#F8F5FF] border border-[#DDD6FE] p-4 text-xs">
                  <p className="font-bold text-[#5B21B6] mb-1.5 uppercase tracking-wide text-[10px]">Audience Scope</p>
                  <ul className="space-y-1 mb-2">
                    {audience.requesters && <li className="flex items-center gap-1.5 text-[#475069]">✓ Users of affected services</li>}
                    {audience.agents && <li className="flex items-center gap-1.5 text-[#475069]">✓ Service Agents supporting affected services</li>}
                    {audience.managers && <li className="flex items-center gap-1.5 text-[#475069]">✓ Problem & Change Managers responsible for affected services</li>}
                  </ul>
                  <p className="text-[#6D28D9] font-medium pt-2 border-t border-[#DDD6FE]/40">Recipients will be resolved from the selected services.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 3. Public Communication */}
        <section className={sectionClass}>
          <div className={sectionHeaderClass}>
            <h3 className="text-sm font-bold text-[#0E1726] flex items-center gap-2"><AlertCircle className="h-4 w-4 text-[#6D28D9]" /> Public Communication</h3>
          </div>
          <div className="p-5 space-y-5">
            <div>
              <label className={labelClass}>What Should Users Know? <span className="text-[#8A241B]">*</span></label>
              <textarea value={whatUsersKnow} onChange={e => setWhatUsersKnow(e.target.value)} placeholder="Initial public message explaining the context..." rows={3} className={`${inputClass} resize-y`} required />
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass}>What Should Users Do? <span className="text-[#8A93A5] font-normal">(Optional)</span></label>
                <textarea value={whatUsersDo} onChange={e => setWhatUsersDo(e.target.value)} placeholder="Workarounds or immediate actions to take..." rows={2} className={`${inputClass} resize-y`} />
              </div>
              <div>
                <label className={labelClass}>Next Update <span className="text-[#8A93A5] font-normal">(Optional)</span></label>
                <input value={nextUpdate} onChange={e => setNextUpdate(e.target.value)} placeholder="e.g. In 1 hour, or at 15:00 UTC" className={inputClass} />
              </div>
            </div>
          </div>
        </section>

        {/* 4. Operational Context */}
        <section className={sectionClass}>
          <div className={sectionHeaderClass}>
            <h3 className="text-sm font-bold text-[#0E1726] flex items-center gap-2"><Link2 className="h-4 w-4 text-[#6D28D9]" /> Operational Context</h3>
          </div>
          <div className="p-5">
            <p className="text-sm text-[#475069] mb-4">Connect this alert to an existing incident or major incident. Optional.</p>
            
            {selectedLink ? (
              <div className="flex items-center justify-between rounded-lg border border-[#DDD6FE] bg-[#F8F5FF] p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm">
                    <Link2 className="h-5 w-5 text-[#6D28D9]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#6D28D9]">{selectedLink.type.replace("_", " ")}</span>
                      <span className="text-xs font-semibold text-[#8A93A5]">{selectedLink.ticket_number}</span>
                    </div>
                    <p className="mt-0.5 text-sm font-bold text-[#0E1726]">{selectedLink.title}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setSelectedLink(null)} className="text-xs font-bold text-[#8A241B] hover:underline px-2">Unlink</button>
              </div>
            ) : (
              <button type="button" onClick={openLinkModal} className="inline-flex items-center gap-2 rounded-lg border border-[#E6E9F0] bg-white px-4 py-2.5 text-sm font-bold text-[#0E1726] shadow-sm transition hover:border-[#6D28D9] hover:bg-[#F8F5FF] hover:text-[#6D28D9]">
                <Plus className="h-4 w-4" /> Link Operational Record
              </button>
            )}
          </div>
        </section>

        {/* Bottom Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-[#E6E9F0] bg-white px-5 py-2.5 text-sm font-bold text-[#475069] hover:bg-[#F5F7FA] transition">
            Cancel
          </button>
          <button type="submit" disabled={!isFormValid || saving} className="inline-flex items-center gap-2 rounded-lg bg-[#6D28D9] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#5B21B6] disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save Draft
          </button>
        </div>
      </form>

      {/* Link Search Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0E1726]/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between border-b border-[#E6E9F0] px-5 py-4 bg-[#FBFAF9]">
              <h3 className="text-base font-bold text-[#0E1726]">Link Operational Record</h3>
              <button onClick={() => setShowLinkModal(false)} className="text-[#8A93A5] hover:text-[#0E1726] p-1.5 rounded-lg hover:bg-[#E6E9F0]"><X className="h-5 w-5" /></button>
            </div>
            
            <div className="p-4 border-b border-[#E6E9F0] bg-white relative">
              <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-5 w-5 text-[#8A93A5]" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search by ID or title..." className="w-full rounded-xl border border-[#DDE1E8] bg-[#F5F7FA] py-3 pl-10 pr-4 text-sm outline-none focus:border-[#6D28D9] focus:bg-white" autoFocus />
            </div>

            <div className="overflow-y-auto flex-1 p-4 bg-[#F5F7FA]">
              {!linkable ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-[#6D28D9]" /></div>
              ) : filteredLinks.length > 0 ? (
                <div className="space-y-2">
                  {filteredLinks.map(link => (
                    <button key={link.id} type="button" onClick={() => { setSelectedLink(link); setShowLinkModal(false); }} className="w-full text-left rounded-xl border border-[#E6E9F0] bg-white p-4 shadow-sm hover:border-[#6D28D9] hover:shadow-md transition flex flex-col group">
                      <div className="flex items-start justify-between w-full">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${link.type === 'MAJOR_INCIDENT' ? 'bg-[#FFF7F6] text-[#8A241B]' : 'bg-[#F8F5FF] text-[#6D28D9]'}`}>
                            {link.type.replace("_", " ")}
                          </span>
                          <span className="text-xs font-mono text-[#6B7488]">{link.ticket_number}</span>
                        </div>
                        <span className="text-[10px] font-bold text-[#475069] bg-[#EEF1F5] px-2 py-0.5 rounded">{link.status}</span>
                      </div>
                      <p className="mt-2 text-sm font-bold text-[#0E1726] group-hover:text-[#6D28D9] transition">{link.title}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-sm font-bold text-[#0E1726]">No records found</p>
                  <p className="text-xs text-[#6B7488] mt-1">Try adjusting your search query.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
