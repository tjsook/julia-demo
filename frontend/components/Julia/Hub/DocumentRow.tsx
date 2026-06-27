import { Archive, Eye, FilePenLine, RotateCcw, Trash2 } from "lucide-react";

import type { JuliaDocument } from "../../../lib/julia/types";
import s from "../../../styles/julia.module.css";

type DocumentRowProps = {
  document: JuliaDocument;
  busy: boolean;
  onPreview: (document: JuliaDocument) => void;
  onEdit: (document: JuliaDocument) => void;
  onArchive: (document: JuliaDocument) => void;
  onRestore: (document: JuliaDocument) => void;
  onHardDelete: (document: JuliaDocument) => void;
};

export function DocumentRow({
  document,
  busy,
  onPreview,
  onEdit,
  onArchive,
  onRestore,
  onHardDelete,
}: DocumentRowProps) {
  const updated = new Date(document.updated_at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <tr>
      <td>
        <div className={s.docTitle}>{document.title}</div>
        <div className={s.docId}>{document.id}</div>
      </td>
      <td>
        <div className={s.aliasList}>
          {document.aliases.map((alias) => (
            <span key={alias} className={s.aliasPill}>
              {alias}
            </span>
          ))}
        </div>
      </td>
      <td>
        <span className={document.is_active ? s.activeBadge : s.archivedBadge}>
          {document.is_active ? "Active" : "Archived"}
        </span>
      </td>
      <td className={s.mutedCell}>{updated}</td>
      <td>
        <div className={s.rowActions}>
          {document.is_active && (
            <button
              type="button"
              className={s.iconButton}
              aria-label={`Preview ${document.title}`}
              title="Preview"
              onClick={() => onPreview(document)}
              disabled={busy}
            >
              <Eye size={16} strokeWidth={1.8} />
            </button>
          )}
          <button
            type="button"
            className={s.iconButton}
            aria-label={`Edit ${document.title}`}
            title="Edit"
            onClick={() => onEdit(document)}
            disabled={busy}
          >
            <FilePenLine size={16} strokeWidth={1.8} />
          </button>
          {document.is_active ? (
            <button
              type="button"
              className={s.iconButton}
              aria-label={`Archive ${document.title}`}
              title="Archive"
              onClick={() => onArchive(document)}
              disabled={busy}
            >
              <Archive size={16} strokeWidth={1.8} />
            </button>
          ) : (
            <>
              <button
                type="button"
                className={s.iconButton}
                aria-label={`Restore ${document.title}`}
                title="Restore"
                onClick={() => onRestore(document)}
                disabled={busy}
              >
                <RotateCcw size={16} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className={s.dangerIconButton}
                aria-label={`Permanently delete ${document.title}`}
                title="Permanently delete"
                onClick={() => onHardDelete(document)}
                disabled={busy}
              >
                <Trash2 size={16} strokeWidth={1.8} />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
