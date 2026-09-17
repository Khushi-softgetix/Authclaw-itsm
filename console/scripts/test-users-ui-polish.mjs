import fs from "fs";
import path from "path";

console.log("==================================================");
console.log("Starting Users UI Polish Verification");
console.log("==================================================");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASSED: ${message}`);
    passed++;
  } else {
    console.error(`❌ FAILED: ${message}`);
    failed++;
  }
}

// Locate files (support both container /tmp and host path)
const usersPagePath = fs.existsSync("/tmp/users-page.tsx")
  ? "/tmp/users-page.tsx"
  : "console/src/app/(console)/itsm/admin-portal/users/page.tsx";

const userDetailPagePath = fs.existsSync("/tmp/users-id-page.tsx")
  ? "/tmp/users-id-page.tsx"
  : "console/src/app/(console)/itsm/admin-portal/users/[id]/page.tsx";

const usersPageSrc = fs.readFileSync(usersPagePath, "utf8");
const userDetailPageSrc = fs.readFileSync(userDetailPagePath, "utf8");

console.log("\n--- Checking Users List Page UI Code ---");

// Check ROLE_BADGE_CLASS definition and usage
assert(
  usersPageSrc.includes('const ROLE_BADGE_CLASS = "inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE]"'),
  "Unified ROLE_BADGE_CLASS defined with AuthClaw purple style"
);

assert(
  usersPageSrc.includes("<span className={ROLE_BADGE_CLASS}>"),
  "ITSM role column uses ROLE_BADGE_CLASS for all roles"
);

// Verify legacy rainbow badge colors are removed
assert(
  !usersPageSrc.includes("bg-[#EDE9FE] text-[#7C3AED]") &&
  !usersPageSrc.includes("bg-[#E0F2FE] text-[#0369A1]") &&
  !usersPageSrc.includes("bg-[#FEF3C7] text-[#B45309]") &&
  !usersPageSrc.includes("bg-[#FCE7F3] text-[#BE185D]"),
  "No rainbow color badge mapping in Users list table"
);

// Check Typography: Name and Email
assert(
  usersPageSrc.includes('text-sm font-semibold text-[#111827]'),
  "Employee name is clearly readable with medium/semibold weight (text-sm font-semibold text-[#111827])"
);

assert(
  usersPageSrc.includes('text-[13px] font-normal text-[#374151]'),
  "Employee email is clearly readable and not tiny/light (text-[13px] font-normal text-[#374151])"
);

// Check Table Headers
assert(
  usersPageSrc.includes('text-xs font-semibold text-[#4B5565] uppercase tracking-wider'),
  "Table headers are readable and slightly stronger (text-xs font-semibold text-[#4B5565] uppercase)"
);

// Check Status Badges
assert(
  usersPageSrc.includes('bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0]') &&
  usersPageSrc.includes('bg-[#10B981]'),
  "Active status uses subtle green indicator with light green background"
);

assert(
  usersPageSrc.includes('bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]') &&
  usersPageSrc.includes('bg-[#EF4444]'),
  "Inactive/Deactivated status uses subtle red indicator with light red background"
);

// Check Governance Access Badge
assert(
  usersPageSrc.includes('bg-[#F8FAFC] text-[#334155] border border-[#CBD5E1]'),
  "Governance access uses subtle neutral badge (not bright colors)"
);

// Check Action Buttons: Danger and Secondary
assert(
  usersPageSrc.includes('border border-[#FCA5A5] bg-white text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2]'),
  "Deactivate button uses subtle red outline/text (NOT bright filled red)"
);

assert(
  usersPageSrc.includes('border border-[#D1D5DB] bg-white text-xs font-semibold text-[#374151] hover:bg-[#F9FAFB]'),
  "Secondary buttons use white background, subtle border, and dark readable text"
);

console.log("\n--- Checking User Detail Page UI Code ---");

assert(
  userDetailPageSrc.includes('text-sm font-semibold text-[#111827]'),
  "User Detail: Name is medium/semibold font (text-sm font-semibold text-[#111827])"
);

assert(
  userDetailPageSrc.includes('text-[13px] font-normal text-[#374151]'),
  "User Detail: Email is clearly readable and not tiny (text-[13px] font-normal text-[#374151])"
);

assert(
  userDetailPageSrc.includes('bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE]'),
  "User Detail: ITSM role uses the same AuthClaw purple badge"
);

assert(
  userDetailPageSrc.includes('border border-[#FCA5A5] bg-white text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2]'),
  "User Detail: Delete User button uses subtle red outline (NOT bright filled red)"
);

assert(
  userDetailPageSrc.includes('border border-[#D1D5DB] bg-white text-xs font-semibold text-[#374151] hover:bg-[#F9FAFB]'),
  "User Detail: Cancel button matches secondary button styling"
);

assert(
  userDetailPageSrc.includes('bg-[#6D28D9] text-white text-xs font-semibold shadow-xs hover:bg-[#5B21B6]'),
  "User Detail: Save Changes matches primary AuthClaw purple button styling"
);

console.log("\n==================================================");
console.log(`UI POLISH VERIFICATION COMPLETED: ${passed} passed, ${failed} failed`);
console.log("==================================================");

if (failed > 0) {
  process.exit(1);
}
