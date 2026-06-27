import { Document, Page, pdfjs } from "react-pdf";

import s from "../../../styles/julia.module.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type PdfDocumentViewerProps = {
  signedUrl: string;
  pageNumber: number;
  pageWidth: number;
  onPageCount: (pageCount: number) => void;
};

export function PdfDocumentViewer({
  signedUrl,
  pageNumber,
  pageWidth,
  onPageCount,
}: PdfDocumentViewerProps) {
  return (
    <Document
      file={signedUrl}
      loading={<div className={s.documentState}>Rendering PDF...</div>}
      error={<div className={s.documentError}>PDF could not be rendered.</div>}
      onLoadSuccess={({ numPages }) => onPageCount(numPages)}
    >
      <Page
        pageNumber={pageNumber}
        width={pageWidth}
        renderAnnotationLayer={false}
        renderTextLayer={false}
      />
    </Document>
  );
}
