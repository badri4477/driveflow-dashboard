import React, { useMemo, useState } from 'react';
import { ChevronDown, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { VahanVehicle } from '@/services/vehicleService';

type Detail = NonNullable<VahanVehicle['details']>[number];

const NOT_PROVIDED = 'Not provided by Vahan';
const display = (r: Detail) => (!r.provided ? NOT_PROVIDED : r.masked ? `${r.value} (hidden by Vahan)` : r.value);

/** Annexure-I groups in order, each with its fields. */
const groupRows = (rows: Detail[]) => {
  const groups: { name: string; rows: Detail[] }[] = [];
  for (const r of [...rows].sort((a, b) => a.sno - b.sno)) {
    const last = groups[groups.length - 1];
    if (last && last.name === r.group) last.rows.push(r);
    else groups.push({ name: r.group, rows: [r] });
  }
  return groups;
};

/** Builds and downloads "Vahan-<REG>.pdf" in the Annexure-I layout. jsPDF loads on demand. */
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

  const body: unknown[] = [];
  for (const g of groupRows(rows)) {
    body.push([{ content: `${g.name}:`, colSpan: 3, styles: { fontStyle: 'bold', fillColor: [226, 232, 240] } }]);
    for (const r of g.rows) body.push([String(r.sno), r.label, display(r)]);
  }

  autoTable(doc, {
    startY: 98,
    margin: { left: marginX, right: marginX },
    head: [['Sl. No', 'Dataset', 'Value']],
    body,
    styles: { fontSize: 10, cellPadding: 6, overflow: 'linebreak' },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    columnStyles: { 0: { cellWidth: 48, halign: 'center' }, 1: { cellWidth: 180, fontStyle: 'bold' } },
    didParseCell: (c: { section: string; column: { index: number }; cell: { raw: unknown; styles: Record<string, unknown> } }) => {
      if (c.section === 'body' && c.column.index === 2 && c.cell.raw === NOT_PROVIDED) {
        c.cell.styles.textColor = [140, 140, 140];
        c.cell.styles.fontStyle = 'italic';
      }
    },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(
      `Source: Parivahan (Vahan), Annexure-I dataset. Owner personal details are not included. Page ${i} of ${pages}`,
      marginX,
      doc.internal.pageSize.getHeight() - 24
    );
  }
  doc.save(`Vahan-${reg}.pdf`);
}

/** Full Vahan output (the 19 Annexure-I fields): collapsible, grouped, responsive grid with a PDF download. */
const VahanDetailsPanel: React.FC<{ vehicle: VahanVehicle; defaultOpen?: boolean }> = ({ vehicle, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const [saving, setSaving] = useState(false);
  const rows = useMemo(() => vehicle.details || [], [vehicle.details]);
  const groups = useMemo(() => groupRows(rows), [rows]);
  if (rows.length === 0) return null;
  const provided = rows.filter((r) => r.provided).length;

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
          {open ? 'Hide' : 'View'} full Vahan details ({provided} of {rows.length} provided)
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
        <div className="border-t border-border">
          {groups.map((g) => (
            <section key={g.name} aria-label={g.name}>
              <h4 className="px-3 pt-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</h4>
              <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border-y border-border">
                {g.rows.map((r) => (
                  <div key={r.sno} className="bg-card px-3 py-2.5 min-w-0">
                    <dt className="text-xs text-muted-foreground">
                      <span className="tabular-nums">{r.sno}.</span> {r.label}
                    </dt>
                    <dd className={`text-sm break-words tabular-nums ${r.provided ? 'font-medium text-foreground' : 'italic text-muted-foreground'}`}>
                      {display(r)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default VahanDetailsPanel;
