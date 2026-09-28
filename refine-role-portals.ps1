$ErrorActionPreference = "Stop"
$repo = "C:\Users\dell\Desktop\khushi-ITSM-main"

function Replace-Exactly([string]$relativePath, [string]$oldValue, [string]$newValue) {
  $path = Join-Path $repo $relativePath
  $content = [System.IO.File]::ReadAllText($path).Replace([string][char]13 + [char]10, [string][char]10)
  $index = $content.IndexOf($oldValue, [System.StringComparison]::Ordinal)
  if ($index -lt 0) { if ($content.Contains($newValue)) { return }; throw "Expected text not found in $relativePath`n$oldValue" }
  if ($content.IndexOf($oldValue, $index + $oldValue.Length, [System.StringComparison]::Ordinal) -ge 0) {
    throw "Expected text is not unique in $relativePath"
  }
  $updated = $content.Substring(0, $index) + $newValue + $content.Substring($index + $oldValue.Length)
  [System.IO.File]::WriteAllText($path, $updated, [System.Text.UTF8Encoding]::new($false))
}

$overview = "console/src/app/(console)/itsm/incident-manager/page.tsx"
Replace-Exactly $overview 'function SummaryCard({ label, value, help, icon: Icon, tone = "neutral", active = false, onClick }: {' 'function SummaryCard({ label, value, help, icon: Icon, tone = "neutral", active = false, primary = false, onClick }: {'
Replace-Exactly $overview '  active?: boolean;
  onClick?: () => void;' '  active?: boolean;
  primary?: boolean;
  onClick?: () => void;'
Replace-Exactly $overview '    <div className={`h-full p-4 text-left transition ${active ? "bg-[#F1ECFE] shadow-[inset_0_-2px_0_#6D28D9]" : "bg-white"} ${onClick && !active ? "hover:bg-[#FAF8FF]" : ""}`}>' '    <div className={`h-full text-left transition ${primary ? "p-5 md:p-6" : "p-4"} ${active ? "bg-[#F1ECFE] shadow-[inset_0_-2px_0_#6D28D9]" : "bg-white"} ${onClick && !active ? "hover:bg-[#FAF8FF]" : ""}`}>'
Replace-Exactly $overview '          <p className={`mt-2 text-2xl font-extrabold tracking-tight ${styles.value}`}>{value}</p>' '          <p className={`mt-2 font-extrabold tracking-tight ${primary ? "text-4xl" : "text-2xl"} ${styles.value}`}>{value}</p>'
Replace-Exactly $overview '        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${styles.iconBg}`}>
          <Icon className={`h-4 w-4 ${styles.icon}`} />' '        <span className={`flex items-center justify-center rounded-xl ${primary ? "h-10 w-10" : "h-8 w-8"} ${styles.iconBg}`}>
          <Icon className={`${primary ? "h-5 w-5" : "h-4 w-4"} ${styles.icon}`} />'
Replace-Exactly $overview @'
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-[#DDD6FE] bg-[#DDD6FE] shadow-[0_1px_2px_rgba(91,33,182,.06)] md:grid-cols-4 xl:grid-cols-8">
        <Link href="/itsm/incident-manager/incidents" className="block"><SummaryCard label="Open" value={summary.open_incidents} help="Active incident queue" icon={Gauge} /></Link>
        <SummaryCard label="Watch list" value={summary.escalation_watch} help="Requires review" icon={ShieldAlert} tone="critical" active={view === "all"} onClick={() => setView("all")} />
        <SummaryCard label="P1 / P2" value={summary.p1_p2} help="High priority" icon={Flame} tone="critical" active={view === "priority"} onClick={() => setView("priority")} />
        <SummaryCard label="Breached" value={summary.sla_breached} help="Past SLA target" icon={TimerOff} tone="critical" active={view === "breached"} onClick={() => setView("breached")} />
        <SummaryCard label="At risk" value={summary.sla_at_risk} help="SLA needs attention" icon={Clock3} tone="warning" active={view === "risk"} onClick={() => setView("risk")} />
        <SummaryCard label="Stuck" value={summary.stuck} help="No recent activity" icon={AlertTriangle} tone="warning" active={view === "stuck"} onClick={() => setView("stuck")} />
        <Link href="/itsm/incident-manager/incidents?assignment_group=__UNASSIGNED__&unassigned=true" className="block"><SummaryCard label="Unassigned" value={summary.unassigned} help="No team or individual owner" icon={UsersRound} /></Link>
        <Link href="/itsm/incident-manager/major-incidents" className="block"><SummaryCard label="Active majors" value={summary.active_major_incidents} help="Command in progress" icon={Radio} /></Link>
      </div>
'@ @'
      <section className="grid gap-3 xl:grid-cols-[minmax(250px,.72fr)_minmax(0,2.28fr)]" aria-label="Incident operations summary">
        <Link href="/itsm/incident-manager/incidents" className="overflow-hidden rounded-2xl border border-[#DDD6FE] bg-white shadow-[0_1px_2px_rgba(91,33,182,.06)]"><SummaryCard label="Open incidents" value={summary.open_incidents} help="View the complete active incident queue" icon={Gauge} primary /></Link>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#DDD6FE] bg-[#DDD6FE] shadow-[0_1px_2px_rgba(91,33,182,.06)] sm:grid-cols-4 xl:grid-cols-7">
          <SummaryCard label="Watch list" value={summary.escalation_watch} help="Requires review" icon={ShieldAlert} tone="critical" active={view === "all"} onClick={() => setView("all")} />
          <SummaryCard label="P1 / P2" value={summary.p1_p2} help="High priority" icon={Flame} tone="critical" active={view === "priority"} onClick={() => setView("priority")} />
          <SummaryCard label="Breached" value={summary.sla_breached} help="Past SLA target" icon={TimerOff} tone="critical" active={view === "breached"} onClick={() => setView("breached")} />
          <SummaryCard label="At risk" value={summary.sla_at_risk} help="SLA needs attention" icon={Clock3} tone="warning" active={view === "risk"} onClick={() => setView("risk")} />
          <SummaryCard label="Stuck" value={summary.stuck} help="No recent activity" icon={AlertTriangle} tone="warning" active={view === "stuck"} onClick={() => setView("stuck")} />
          <Link href="/itsm/incident-manager/incidents?assignment_group=__UNASSIGNED__&unassigned=true" className="block"><SummaryCard label="Unassigned" value={summary.unassigned} help="No owner" icon={UsersRound} /></Link>
          <Link href="/itsm/incident-manager/major-incidents" className="block"><SummaryCard label="Active majors" value={summary.active_major_incidents} help="Command in progress" icon={Radio} /></Link>
        </div>
      </section>
'@

$queue = "console/src/app/(console)/itsm/incident-manager/incidents/page.tsx"
Replace-Exactly $queue 'import { AlertCircle, Bookmark, ChevronLeft, ChevronRight, RefreshCw, Search, SlidersHorizontal, Trash2 } from "lucide-react";' 'import { AlertCircle, Bookmark, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Search, SlidersHorizontal, Trash2 } from "lucide-react";'
Replace-Exactly $queue '  const [savingView, setSavingView] = useState(false);' '  const [savingView, setSavingView] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);'
Replace-Exactly $queue '      <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_repeat(3,minmax(130px,auto))]">' '      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(300px,1fr)_repeat(4,minmax(128px,auto))]">'
Replace-Exactly $queue '        <Filter value={attention} onChange={value=>{setAttention(value);setOffset(0);}} label="Filter by attention" options={attentionOptions}/>
      </div>
      <div className="mt-2 flex flex-col gap-2 border-t border-[#EEF1F5] pt-2 sm:flex-row sm:items-center">' '        <Filter value={attention} onChange={value=>{setAttention(value);setOffset(0);}} label="Filter by attention" options={attentionOptions}/>
        <button type="button" onClick={()=>setAdvancedFiltersOpen(open=>!open)} aria-expanded={advancedFiltersOpen} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#DDD6FE] bg-white px-3 py-2.5 text-xs font-semibold text-[#5B21B6] transition hover:bg-[#F1ECFE]"><SlidersHorizontal className="h-3.5 w-3.5"/>More filters<ChevronDown className={`h-3.5 w-3.5 transition ${advancedFiltersOpen?"rotate-180":""}`}/></button>
      </div>
      {advancedFiltersOpen ? <div className="mt-3 grid gap-2 border-t border-[#EEF1F5] pt-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(140px,1fr))_auto_auto]">'
Replace-Exactly $queue '        {hasFilters ? <button type="button" onClick={clearFilters} className="px-2 py-2 text-xs font-semibold text-[#6D28D9] hover:underline">Clear filters</button> : null}
      </div>' '        {hasFilters ? <button type="button" onClick={clearFilters} className="px-2 py-2 text-xs font-semibold text-[#6D28D9] hover:underline">Clear filters</button> : null}
      </div> : null}'

$major = "console/src/app/(console)/itsm/incident-manager/major-incidents/page.tsx"
Replace-Exactly $major '  return <div className="mx-auto max-w-[1440px] space-y-4">' '  return <div className="role-portal mx-auto max-w-[1440px] space-y-6">'
Replace-Exactly $major '  const [openSection,setOpenSection]=useState<CommandSection|null>(null);' '  const [openSection,setOpenSection]=useState<CommandSection|null>(record ? "restore" : "details");'

$auditor = "console/src/app/(console)/itsm/dashboard/auditor/page.tsx"
$auditorPath = Join-Path $repo $auditor
$auditorContent = [System.IO.File]::ReadAllText($auditorPath)
$auditorContent = $auditorContent.Replace('className="mx-auto max-w-[1440px] space-y-5"', 'className="role-portal mx-auto max-w-[1440px] space-y-6"')
$auditorContent = $auditorContent.Replace('className="mx-auto max-w-[1440px] space-y-4"', 'className="role-portal mx-auto max-w-[1440px] space-y-5"')
[System.IO.File]::WriteAllText($auditorPath, $auditorContent, [System.Text.UTF8Encoding]::new($false))

Replace-Exactly $auditor 'function OverviewMetric({ icon: Icon, label, value, detail, verified = false, warning = false }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; detail: string; verified?: boolean; warning?: boolean }) {' 'function OverviewMetric({ icon: Icon, label, value, detail, verified = false, warning = false, primary = false }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; detail: string; verified?: boolean; warning?: boolean; primary?: boolean }) {'
Replace-Exactly $auditor '  return <div className="flex min-h-28 items-center gap-4 px-5 py-5"><span className="rounded-xl bg-[#F1ECFE] p-3 text-[#6D28D9]"><Icon className="h-5 w-5" /></span><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[.09em] text-[#6B7488]">{label}</p><p className={`mt-1 text-2xl font-extrabold ${valueClass}`}>{value}</p><p className="mt-1 text-[11px] leading-4 text-[#8A93A5]">{detail}</p></div></div>;' '  return <div className={`flex items-center gap-4 px-5 ${primary ? "min-h-36 py-6" : "min-h-28 py-5"}`}><span className={`rounded-xl bg-[#F1ECFE] text-[#6D28D9] ${primary ? "p-4" : "p-3"}`}><Icon className={primary ? "h-6 w-6" : "h-5 w-5"} /></span><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[.09em] text-[#6B7488]">{label}</p><p className={`mt-1 font-extrabold ${primary ? "text-4xl" : "text-2xl"} ${valueClass}`}>{value}</p><p className="mt-1 text-[11px] leading-4 text-[#8A93A5]">{detail}</p></div></div>;'
Replace-Exactly $auditor @'
        <div className="grid divide-y divide-[#E6E9F0] sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          <OverviewMetric icon={FileCheck2} label="Total audit events" value={overviewLoading ? "—" : String(overview?.total_events ?? 0)} detail="Tenant-scoped records" />
          <OverviewMetric icon={LockKeyhole} label="Privileged actions" value={overviewLoading ? "—" : String(overview?.privileged_events ?? 0)} detail="Role, permission, and admin activity" />
          <OverviewMetric icon={CircleX} label="Denied actions" value={overviewLoading ? "—" : String(overview?.denied_events ?? 0)} detail="Authorization failures" warning={Boolean(overview?.denied_events)} />
          <OverviewMetric icon={ShieldCheck} label="Integrity" value={overviewLoading ? "Checking" : !overview?.total_events ? "No records" : overview.integrity_valid ? "Verified" : "Needs review"} detail="Complete tenant hash chain" verified={Boolean(overview?.total_events && overview.integrity_valid)} warning={Boolean(overview?.total_events && !overview.integrity_valid)} />
        </div>
'@ @'
        <div className="grid divide-y divide-[#E6E9F0] xl:grid-cols-[minmax(270px,.8fr)_minmax(0,2.2fr)] xl:divide-x xl:divide-y-0">
          <OverviewMetric icon={FileCheck2} label="Total audit events" value={overviewLoading ? "—" : String(overview?.total_events ?? 0)} detail="Tenant-scoped records available for review" primary />
          <div className="grid divide-y divide-[#E6E9F0] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <OverviewMetric icon={LockKeyhole} label="Privileged actions" value={overviewLoading ? "—" : String(overview?.privileged_events ?? 0)} detail="Role, permission, and admin activity" />
            <OverviewMetric icon={CircleX} label="Denied actions" value={overviewLoading ? "—" : String(overview?.denied_events ?? 0)} detail="Authorization failures" warning={Boolean(overview?.denied_events)} />
            <OverviewMetric icon={ShieldCheck} label="Integrity" value={overviewLoading ? "Checking" : !overview?.total_events ? "No records" : overview.integrity_valid ? "Verified" : "Needs review"} detail="Complete tenant hash chain" verified={Boolean(overview?.total_events && overview.integrity_valid)} warning={Boolean(overview?.total_events && !overview.integrity_valid)} />
          </div>
        </div>
'@

Write-Output "Applied page hierarchy refinements."
