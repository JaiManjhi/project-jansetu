"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { PROJECT_STATUS_ENUM } from "@/lib/constants";

/**
 * A claimed project: status, a free-text note, and team members.
 *
 * PRD §5 puts this in "functional but simple" — no approval workflow, no
 * document versioning, latest note only. Resisting the urge to build more here
 * is the point of that section.
 */

const STATUS_LABELS: Record<string, string> = {
  claimed: "Claimed",
  in_progress: "In progress",
  completed: "Completed",
};

export function ProjectCard({
  project,
  problemTitle,
}: {
  project: {
    _id: string;
    status: string;
    statusNote: string;
    teamMembers: string[];
    matchedDepartment: string | null;
    claimedAt: string;
  };
  problemTitle: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(project.status);
  const [note, setNote] = useState(project.statusNote);
  const [team, setTeam] = useState(project.teamMembers.join(", "));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/projects/${project._id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          statusNote: note,
          teamMembers: team.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (!response.ok) {
        setError("Could not save. Please try again.");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-card border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-base font-medium text-ink-900">{problemTitle}</h3>
        <span className="text-sm text-ink-300">
          {STATUS_LABELS[project.status] ?? project.status}
          {project.matchedDepartment && ` · ${project.matchedDepartment}`}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`status-${project._id}`} className="block text-sm font-medium text-ink-900">
            Status
          </label>
          <select
            id={`status-${project._id}`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-2 min-h-touch w-full rounded-button border border-border bg-surface px-3 text-base text-ink-900"
          >
            {PROJECT_STATUS_ENUM.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`team-${project._id}`} className="block text-sm font-medium text-ink-900">
            Team members
          </label>
          <input
            id={`team-${project._id}`}
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            placeholder="Comma separated names"
            className="mt-2 min-h-touch w-full rounded-button border border-border bg-surface px-3 text-base text-ink-900 placeholder:text-ink-300"
          />
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor={`note-${project._id}`} className="block text-sm font-medium text-ink-900">
          Latest update
        </label>
        <textarea
          id={`note-${project._id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="What has happened so far?"
          className="mt-2 w-full rounded-button border border-border bg-surface p-3 text-base text-ink-900 placeholder:text-ink-300"
        />
        <p className="mt-1 text-xs text-ink-300">
          Only the latest update is kept — full history is not built.
        </p>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex min-h-touch items-center gap-2 rounded-button border border-border bg-surface px-5 text-base font-medium text-ink-900 transition-colors hover:bg-accent-subtle disabled:text-ink-300"
        >
          {saving && <LoaderCircle size={20} strokeWidth={1.5} className="animate-spin" aria-hidden />}
          {saving ? "Saving…" : "Save update"}
        </button>
        {saved && <span className="text-sm text-success" role="status">Saved</span>}
        {error && <span className="text-sm text-danger" role="alert">{error}</span>}
      </div>
    </li>
  );
}
