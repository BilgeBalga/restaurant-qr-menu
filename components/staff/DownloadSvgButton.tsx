"use client";

/** Triggers a real browser download of an already-rendered QR SVG string — no server round trip, no canvas/PNG conversion needed for a crisp, printable vector file. */
export function DownloadSvgButton({ svg, filename, className }: { svg: string; filename: string; className?: string }) {
  function handleDownload() {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" onClick={handleDownload} className={className}>
      Download SVG
    </button>
  );
}
