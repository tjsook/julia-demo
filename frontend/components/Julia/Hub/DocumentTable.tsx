import { FileText } from "lucide-react";

import type { JuliaDocument } from "../../../lib/julia/types";
import s from "../../../styles/julia.module.css";
import { DocumentRow } from "./DocumentRow";

type DocumentTableProps = {
  documents: JuliaDocument[];
  loading: boolean;
  busy: boolean;
  onPreview: (document: JuliaDocument) => void;
  onEdit: (document: JuliaDocument) => void;
  onArchive: (document: JuliaDocument) => void;
  onRestore: (document: JuliaDocument) => void;
  onHardDelete: (document: JuliaDocument) => void;
};

export function DocumentTable({
  documents,
  loading,
  busy,
  onPreview,
  onEdit,
  onArchive,
  onRestore,
  onHardDelete,
}: DocumentTableProps) {
  if (!loading && documents.length === 0) {
    return (
      <section className={s.emptyState}>
        <FileText size={28} strokeWidth={1.7} />
        <h2>No documents found</h2>
        <p>Upload a PDF or switch filters to view archived documents.</p>
      </section>
    );
  }

  return (
    <section className={s.tableBand}>
      <table className={s.documentTable}>
        <thead>
          <tr>
            <th>Document</th>
            <th>Aliases</th>
            <th>Status</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <DocumentRow
              key={document.id}
              document={document}
              busy={busy}
              onPreview={onPreview}
              onEdit={onEdit}
              onArchive={onArchive}
              onRestore={onRestore}
              onHardDelete={onHardDelete}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}
