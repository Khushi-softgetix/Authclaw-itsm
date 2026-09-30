"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import ModalShell from "@/components/modal-shell";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import { Incident, IncidentReferenceItem, TenantUser } from "@/lib/itsm-types";

interface AssignModalProps {
  incident: Incident;
  onClose: () => void;
  onSuccess: (updated: Incident) => void;
  usersEndpoint?: string;
  referenceEndpoint?: string;
}

const COMMON_GROUPS = [
  "Service Desk",
  "Infrastructure",
  "Identity & Access",
  "Security Operations",
  "Network Engineering",
  "Application Support",
  "Database Operations",
];

interface SearchOption {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
}

interface SearchableSelectProps {
  id: string;
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  disabled?: boolean;
}

function SearchableSelect({
  id,
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) => (
        [option.label, option.description || "", option.searchText || ""]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      ))
    : options;
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [open]);

  const selectOption = (option: SearchOption) => {
    onChange(option.value);
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(filteredOptions.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && filteredOptions[activeIndex]) {
      event.preventDefault();
      selectOption(filteredOptions[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      triggerRef.current?.focus();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        id={id + "-trigger"}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={id + "-listbox"}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
          setActiveIndex(0);
        }}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-[#E6E9F0] bg-white px-3 py-2 text-left text-xs text-[#0E1726] outline-none transition hover:border-[#D3D7E2] focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#7C3AED]/10 disabled:cursor-not-allowed disabled:bg-[#F9FAFB] disabled:text-[#98A2B3]"
      >
        <span className="min-w-0 truncate">{selectedOption?.label || placeholder}</span>
        <ChevronDown className={"h-4 w-4 shrink-0 text-[#667085] transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-30 mt-1.5 overflow-hidden rounded-lg border border-[#E1E4EC] bg-white shadow-[0_12px_28px_rgba(16,24,40,0.14)]">
          <div className="border-b border-[#EEF0F4] p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#98A2B3]" />
              <input
                ref={searchRef}
                id={id}
                type="search"
                role="searchbox"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                aria-controls={id + "-listbox"}
                aria-activedescendant={filteredOptions[activeIndex] ? id + "-option-" + activeIndex : undefined}
                autoComplete="off"
                className="w-full rounded-md border border-[#E6E9F0] bg-white py-2 pl-9 pr-3 text-xs text-[#0E1726] outline-none transition placeholder:text-[#98A2B3] focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#7C3AED]/10"
              />
            </div>
          </div>
          <div id={id + "-listbox"} role="listbox" className="max-h-52 overflow-y-auto p-1.5">
            {filteredOptions.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <button
                  id={id + "-option-" + index}
                  key={option.value + "-" + index}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(option)}
                  className={"flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition " + (
                    isActive ? "bg-[#F5F3FF]" : "hover:bg-[#F8F9FB]"
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-[#1D2939]">{option.label}</span>
                    {option.description ? (
                      <span className="mt-0.5 block truncate text-[10px] text-[#667085]">{option.description}</span>
                    ) : null}
                  </span>
                  {isSelected ? <Check className="h-3.5 w-3.5 shrink-0 text-[#6D28D9]" aria-hidden="true" /> : null}
                </button>
              );
            })}
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-[#667085]" role="status">{emptyMessage}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function AssignModal({ incident, onClose, onSuccess, usersEndpoint = "/api/users", referenceEndpoint }: AssignModalProps) {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [teams, setTeams] = useState<IncidentReferenceItem[]>([]);
  const [assigneeId, setAssigneeId] = useState<string>(incident.assignee_id || "");
  const [assignmentGroup, setAssignmentGroup] = useState<string>(incident.assignment_group || "");
  const [loadingUsers, setLoadingUsers] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const selectedTeam = teams.find((team) => team.name === assignmentGroup);
  const eligibleUsers = selectedTeam
    ? users.filter((user) => selectedTeam.member_ids?.includes(user.id))
    : users;

  useEffect(() => {
    let mounted = true;
    const loadUsers = async () => {
      try {
        setLoadingUsers(true);
        const res = await fetch(referenceEndpoint || usersEndpoint, { cache: "no-store" });
        const data = await res.json().catch(() => ([]));
        if (!res.ok) throw new Error(apiErrorMessage(data, "Unable to load eligible assignees"));
        if (mounted && Array.isArray(data)) setUsers(data);
        if (mounted && !Array.isArray(data)) {
          setUsers(Array.isArray(data.users) ? data.users : []);
          setTeams(Array.isArray(data.teams) ? data.teams : []);
        }
      } catch (err: unknown) {
        if (mounted) setError(err instanceof Error ? err.message : "Unable to load eligible assignees");
      } finally {
        if (mounted) setLoadingUsers(false);
      }
    };
    loadUsers();
    return () => {
      mounted = false;
    };
  }, [referenceEndpoint, usersEndpoint]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);

      const payload = {
        assignee_id: assigneeId ? assigneeId : null,
        assignment_group: assignmentGroup.trim() ? assignmentGroup.trim() : null,
      };

      const res = await fetch(`/api/itsm/incidents/${incident.id}/assign`, jsonRequest("POST", payload));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to assign incident"));
      }

      const updated = await res.json();
      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to assign incident");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={`Assign Incident · ${incident.ticket_number}`}
      onClose={onClose}
      error={error}
      maxWidthClass="max-w-[440px]"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="assignee-search-trigger" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
            Assignee (Tenant User)
          </label>
          <SearchableSelect
            id="assignee-search"
            value={assigneeId}
            options={[
              { value: "", label: "Unassigned" },
              ...eligibleUsers.map((user) => ({
                value: user.id,
                label: user.email,
                description: user.role || undefined,
                searchText: user.email + " " + (user.role || ""),
              })),
            ]}
            onChange={setAssigneeId}
            placeholder="Choose a tenant user"
            searchPlaceholder="Search by email or role"
            emptyMessage="No tenant users match this search"
            disabled={loadingUsers}
          />
          {loadingUsers && (
            <p className="text-[10px] text-[#6B7488] mt-1">Loading tenant members...</p>
          )}
        </div>

        <div>
          <label htmlFor={referenceEndpoint ? "group-search-trigger" : "group-select"} className="block text-xs font-semibold text-[#0E1726] mb-1.5">
            Assignment Group
          </label>
          {referenceEndpoint ? (
            <SearchableSelect
              id="group-search"
              value={assignmentGroup}
              options={[
                { value: "", label: "Unassigned" },
                ...teams.map((team) => ({ value: team.name, label: team.name })),
              ]}
              onChange={(value) => {
                setAssignmentGroup(value);
                setAssigneeId("");
              }}
              placeholder="Choose an active team"
              searchPlaceholder="Search active teams"
              emptyMessage="No active teams match this search"
              disabled={loadingUsers || teams.length === 0}
            />
          ) : (
            <>
              <input id="group-select" type="text" list="common-groups" value={assignmentGroup} onChange={(e) => setAssignmentGroup(e.target.value)} placeholder="e.g. Service Desk, Infrastructure..." className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none" />
              <datalist id="common-groups">{COMMON_GROUPS.map(group => <option key={group} value={group} />)}</datalist>
            </>
          )}
          <p className="text-[10px] text-[#6B7488] mt-1">
            {referenceEndpoint
              ? teams.length
                ? "Choose an active operational team in this workspace."
                : "No active operational teams are configured. You can leave the incident without a supporting team."
              : "Choose a common operational group or enter a custom team name."}
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E9F0]">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 bg-white border border-[#E6E9F0] text-[#475069] rounded-lg text-xs font-medium hover:bg-[#F5F7FA] transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-lg text-xs font-semibold transition shadow-sm disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save Assignment"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
