import React, { useState } from 'react';
import { ChevronDown, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { VahanVehicle } from '@/services/vehicleService';

type Detail = NonNullable<VahanVehicle['details']>[number];
/** Builds and downloads "Vahan-<REG>.pdf". jsPDF is loaded on demand so it stays out of the main bundle. */
async function downloadVahanPdf(v: VahanVehicle, rows: Detail[]) {
  const [{ jsPDF }, atMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  // Export shape differs between bundlers/versions; take whichever is the function.
  const m = atMod as unknown as { default?: unknown; autoTable?: unknown };
  const autoTable = (typeof m.default === 'function' ? m.default
    : typeof (m.default as { default?: unknown })?.default === 'function' ? (m.default as { default: unknown }).default
    : m.autoTable) as (doc: unknown, opts: Record<string, unknown>) => void;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const reg = v.registrationNumber || 'Vehicle';
  const marginX = 40;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Vehicle details (Vahan)', marginX, 50);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`Registration: ${reg}`, marginX, 68);
  doc.text(`Fetched: ${new Date().toLocaleString('en-IN')}`, marginX, 82);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 98,
    margin: { left: marginX, right: marginX },
    head: [['Field', 'Value']],
    body: rows.map((r) => [r.label, r.masked ? `${r.value} (hidden by Vahan)` : r.value]),
    styles: { fontSize: 10, cellPadding: 6, overflow: 'linebreak' },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    columnStyles: { 0: { cellWidth: 170, fontStyle: 'bold' } },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(
      `Source: Parivahan (Vahan). Owner personal details are not included. Page ${i} of ${pages}`,
      marginX,
      doc.internal.pageSize.getHeight() - 24
    );
  }
  doc.save(`Vahan-${reg}.pdf`);
}

/** Full Vahan output: collapsible, responsive field grid with a PDF download. */
const VahanDetailsPanel: React.FC<{ vehicle: VahanVehicle }> = ({ vehicle }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const rows = vehicle.details || [];
  if (rows.length === 0) return null;

  const onDownload = async () => {
    setSaving(true);
    try {
      await downloadVahanPdf(vehicle, rows);
    } catch {
      toast.error('Could not create the PDF. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-border bg-card">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="min-h-[44px] flex-1 inline-flex items-center gap-2 text-left text-sm font-medium text-foreground rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          {open ? 'Hide' : 'View'} full Vahan details ({rows.length} fields)
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={saving}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Download className="w-4 h-4" aria-hidden />}
          {saving ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>

      {open && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border-t border-border rounded-b-xl overflow-hidden">
          {rows.map((r) => (
            <div key={r.key} className="bg-card px-3 py-2.5 min-w-0">
              <dt className="text-xs text-muted-foreground">{r.label}</dt>
              <dd className="text-sm font-medium text-foreground break-words tabular-nums">
                {r.value}
                {r.masked && <span className="ml-1 text-xs font-normal text-muted-foreground">(hidden by Vahan)</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
};

export default VahanDetailsPanel;
