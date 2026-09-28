$ErrorActionPreference = "Stop"
$repo = "C:\Users\dell\Desktop\khushi-ITSM-main"

function Replace-Exactly([string]$relativePath, [string]$oldValue, [string]$newValue) {
  $path = Join-Path $repo $relativePath
  $content = [System.IO.File]::ReadAllText($path)
  $index = $content.IndexOf($oldValue, [System.StringComparison]::Ordinal)
  if ($index -lt 0) { throw "Expected text not found in $relativePath" }
  if ($content.IndexOf($oldValue, $index + $oldValue.Length, [System.StringComparison]::Ordinal) -ge 0) {
    throw "Expected text is not unique in $relativePath"
  }
  $updated = $content.Substring(0, $index) + $newValue + $content.Substring($index + $oldValue.Length)
  [System.IO.File]::WriteAllText($path, $updated, [System.Text.UTF8Encoding]::new($false))
}

$globals = "console/src/app/globals.css"
$globalsPath = Join-Path $repo $globals
$globalsContent = [System.IO.File]::ReadAllText($globalsPath)
if (-not $globalsContent.Contains("/* Shared composition rules for focused ITSM role workspaces. */")) {
  $addition = @'


/* Shared composition rules for focused ITSM role workspaces. */
.role-portal {
  width: 100%;
}

.role-portal > header h1 {
  text-wrap: balance;
}

.role-portal table {
  border-collapse: separate;
  border-spacing: 0;
}

.role-portal table thead th {
  background: #faf9fd;
  color: #667085;
  font-size: 0.6875rem;
  letter-spacing: 0.065em;
}

.role-portal table tbody td {
  vertical-align: middle;
}

.role-portal table tbody tr {
  transition: background-color 140ms ease;
}

.role-portal table tbody tr:hover {
  background: #fbfaff;
}

.role-portal :is(button, a, input, select, textarea):focus-visible {
  outline: 2px solid rgba(109, 40, 217, 0.42);
  outline-offset: 2px;
}

@media (min-width: 1280px) {
  .role-portal {
    padding-bottom: 2rem;
  }
}
'@
  [System.IO.File]::WriteAllText($globalsPath, $globalsContent + $addition, [System.Text.UTF8Encoding]::new($false))
}

Replace-Exactly "console/src/components/console-shell.tsx" '          <main className="flex-1 overflow-auto p-6 md:p-8">{children}</main>' '          <main className="flex-1 overflow-auto px-4 py-6 sm:px-6 md:px-8 md:py-8 xl:px-10">{children}</main>'
Replace-Exactly "console/src/components/incident-manager-shell.tsx" '        <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8">{children}</main>' '        <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8 xl:px-10">{children}</main>'

Replace-Exactly "console/src/app/(console)/itsm/incident-manager/page.tsx" '    <div className="mx-auto max-w-7xl space-y-6">' '    <div className="role-portal mx-auto max-w-[1440px] space-y-6">'
Replace-Exactly "console/src/app/(console)/itsm/incident-manager/incidents/page.tsx" '  return <div className="mx-auto max-w-7xl space-y-5">' '  return <div className="role-portal mx-auto max-w-[1440px] space-y-6">'
Replace-Exactly "console/src/app/(console)/itsm/incident-manager/major-incidents/page.tsx" '  return <div className="mx-auto max-w-7xl space-y-5">' '  return <div className="role-portal mx-auto max-w-[1440px] space-y-6">'

$auditor = "console/src/app/(console)/itsm/dashboard/auditor/page.tsx"
$auditorPath = Join-Path $repo $auditor
$auditorContent = [System.IO.File]::ReadAllText($auditorPath)
$auditorContent = $auditorContent.Replace('className="mx-auto max-w-[1440px] space-y-5"', 'className="role-portal mx-auto max-w-[1440px] space-y-6"')
$auditorContent = $auditorContent.Replace('className="mx-auto max-w-[1440px] space-y-4"', 'className="role-portal mx-auto max-w-[1440px] space-y-5"')
[System.IO.File]::WriteAllText($auditorPath, $auditorContent, [System.Text.UTF8Encoding]::new($false))

Write-Output "Applied shared role-portal refinements."
