import { useKiosk } from '@/src/context/KioskContext';

export function PrintableReceipt() {
  const { languageConfig, t, submission } = useKiosk();

  if (!submission) return null;

  const { formSummary } = submission;

  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    {
      label: t.form.fields.serviceType.label,
      value: t.dashboard.services[formSummary.serviceType],
    },
    { label: t.form.fields.fullName.label, value: formSummary.fullName },
    { label: t.form.fields.idNumber.label, value: submission.maskedIdNumber, mono: true },
    { label: t.form.fields.dob.label, value: formSummary.dob, mono: true },
    {
      label: t.form.fields.gender.label,
      value: formSummary.gender ? t.form.genders[formSummary.gender] : '-',
    },
    { label: t.form.fields.fatherName.label, value: formSummary.fatherName || '-' },
    { label: t.form.fields.phoneNumber.label, value: formSummary.phoneNumber, mono: true },
    { label: t.form.fields.address.label, value: formSummary.address },
    { label: t.form.fields.pincode.label, value: formSummary.pincode, mono: true },
  ];

  return (
    <section
      className="print-only mx-auto max-w-3xl bg-white p-8 text-slate-900"
      dir={languageConfig.dir}
    >
      <header className="border-b-2 border-slate-900 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t.app.brandName}</h1>
            <p className="mt-1 text-sm text-slate-700">{t.app.brandTagline}</p>
          </div>
          <div className="text-end">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {t.completion.statusLabel}
            </div>
            <div className="mt-0.5 text-sm font-bold text-slate-900">
              {t.completion.statusConfirmed}
            </div>
          </div>
        </div>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-4 rounded-lg border border-slate-300 bg-slate-50 p-4">
        <div>
          <div className="text-xs font-semibold text-slate-600">
            {t.completion.referenceLabel}
          </div>
          <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
            {submission.referenceId}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-600">
            {t.completion.submittedAtLabel}
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-900 tabular-nums">
            {new Date(submission.submittedAt).toLocaleString(languageConfig.speechCode)}
          </div>
        </div>
      </div>

      <table className="mt-6 w-full border-collapse border border-slate-300 text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-slate-300">
              <th
                scope="row"
                className="w-1/3 bg-slate-100 px-4 py-3 text-start font-semibold text-slate-800"
              >
                {row.label}
              </th>
              <td
                className={`px-4 py-3 text-slate-900 ${
                  row.mono ? 'font-mono tabular-nums' : 'font-medium'
                }`}
              >
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="mt-8 border-t border-slate-300 pt-4 text-xs text-slate-600 leading-relaxed">
        <p>{t.completion.receiptFooterNote}</p>
      </footer>
    </section>
  );
}
