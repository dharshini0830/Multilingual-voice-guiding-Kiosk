import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Eye,
  EyeOff,
  Loader2,
  Send,
  Volume2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFirebase } from '@/src/context/FirebaseContext';
import { useKiosk } from '@/src/context/KioskContext';
import { FORM_FIELDS_ORDER } from '@/src/modules/form/formSchema';
import { interpolate } from '@/src/modules/i18n';
import { maskIdForDisplay, validateEntireForm } from '@/src/modules/validation/formValidator';
import { submitFormToServer } from '@/src/services/apiClient';
import { clearActiveDraft, saveSubmissionToFirestore } from '@/src/services/firebaseService';
import type { FieldKey } from '@/src/types/kiosk';

export function ReviewSubmitStage() {
  const { language, t, formData, setStage, setSubmission, setConsentGiven, speak } = useKiosk();
  const { user } = useFirebase();

  const [revealId, setRevealId] = useState(false);
  const [finalConsent, setFinalConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validation = validateEntireForm(formData, t);

  useEffect(() => {
    if (!validation.isValid) {
      const missingLabels = validation.invalidFields.map((k) => t.form.fields[k].label).join(', ');
      speak(interpolate(t.validation.voiceMissingSummary, { fields: missingLabels }));
    } else {
      speak(t.review.voiceGuide);
    }
  }, []);

  const handleReadAllAloud = () => {
    const parts: string[] = [
      t.review.voiceReadSummaryPrefix,
      `${t.form.fields.serviceType.label}: ${t.dashboard.services[formData.serviceType]}.`,
      `${t.form.fields.fullName.label}: ${formData.fullName || '—'}.`,
      `${t.form.fields.idNumber.label}: ${maskIdForDisplay(formData.idNumber, false)}.`,
      `${t.form.fields.dob.label}: ${formData.dob || '—'}.`,
      `${t.form.fields.gender.label}: ${formData.gender ? t.form.genders[formData.gender] : '—'}.`,
      `${t.form.fields.fatherName.label}: ${formData.fatherName || '—'}.`,
      `${t.form.fields.phoneNumber.label}: ${formData.phoneNumber || '—'}.`,
      `${t.form.fields.address.label}: ${formData.address || '—'}.`,
      `${t.form.fields.pincode.label}: ${formData.pincode || '—'}.`,
    ];
    speak(parts.join(' '), true);
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!validation.isValid) {
      const missingLabels = validation.invalidFields.map((k) => t.form.fields[k].label).join(', ');
      speak(interpolate(t.validation.voiceMissingSummary, { fields: missingLabels }), true);
      return;
    }
    if (!finalConsent) return;

    setIsSubmitting(true);
    speak(t.review.voiceSubmitting, true);
    setConsentGiven(true);

    try {
      const record = await submitFormToServer(formData, language, true);
      if (user && user.emailVerified) {
        await saveSubmissionToFirestore(user.uid, record);
        await clearActiveDraft(user.uid).catch(() => {});
      }
      setSubmission(record);
      setStage('completion');
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.review.submitError;
      setSubmitError(msg);
      speak(t.review.voiceSubmitError, true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{t.review.title}</h1>
            <p className="mt-1.5 text-base text-slate-600">{t.review.subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleReadAllAloud}
              className="inline-flex min-h-[46px] items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-900 hover:bg-slate-100 cursor-pointer"
            >
              <Volume2 className="h-4 w-4 text-blue-900" aria-hidden="true" />
              <span>{t.review.readAllAloudBtn}</span>
            </button>
            <button
              type="button"
              onClick={() => setStage('voice-form')}
              className="inline-flex min-h-[46px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              <Edit3 className="h-4 w-4" aria-hidden="true" />
              <span>{t.review.editSectionBtn}</span>
            </button>
          </div>
        </div>

        {/* Service Type */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold text-slate-500">
            {t.form.fields.serviceType.label}
          </div>
          <div className="mt-1 text-lg font-bold text-slate-900">
            {t.dashboard.services[formData.serviceType]}
          </div>
        </div>

        {/* All Form Fields Summary */}
        <dl className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {FORM_FIELDS_ORDER.map((f) => {
            const key = f.key as Exclude<FieldKey, 'serviceType'>;
            const err = validation.errors[key];
            const warn = validation.warnings[key];
            let displayVal = formData[key] ?? '';

            if (key === 'idNumber') {
              displayVal = maskIdForDisplay(displayVal, revealId);
            } else if (
              key === 'gender' &&
              (displayVal === 'Male' || displayVal === 'Female' || displayVal === 'Other')
            ) {
              displayVal = t.form.genders[displayVal];
            }

            return (
              <div
                key={key}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-4"
              >
                <dt className="text-sm font-semibold text-slate-600 sm:w-56 shrink-0">
                  {t.form.fields[key].label}
                </dt>
                <dd className="flex-1 text-base font-bold text-slate-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={key === 'idNumber' || key === 'phoneNumber' || key === 'pincode' ? 'font-mono tabular-nums' : ''}>
                      {displayVal || '—'}
                    </span>
                    {key === 'idNumber' && formData.idNumber && (
                      <button
                        type="button"
                        onClick={() => setRevealId((r) => !r)}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        {revealId ? (
                          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>{revealId ? t.review.hideFullId : t.review.showFullId}</span>
                      </button>
                    )}
                  </div>
                  {err && <p className="mt-1 text-sm font-semibold text-red-700">{err}</p>}
                  {!err && warn && (
                    <p className="mt-1 text-sm font-semibold text-amber-800">{warn}</p>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        {!validation.isValid && (
          <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm sm:text-base font-semibold text-red-900">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              {interpolate(t.form.missingFieldsAlert, {
                count: validation.invalidFields.length,
              })}
            </span>
          </div>
        )}

        {submitError && (
          <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm sm:text-base font-semibold text-red-900">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{submitError}</span>
          </div>
        )}

        {/* Explicit Submission Consent */}
        <label className="mt-6 flex min-h-[52px] items-start gap-3 rounded-xl border border-slate-300 bg-slate-50 p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={finalConsent}
            onChange={(e) => setFinalConsent(e.target.checked)}
            className="mt-1 h-5 w-5 rounded border-slate-400 text-blue-900 shrink-0 cursor-pointer"
          />
          <span className="text-sm sm:text-base font-semibold text-slate-900">
            {t.review.consentConfirmLabel}
          </span>
        </label>

        <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-slate-200 pt-5">
          <button
            type="button"
            onClick={() => setStage('voice-form')}
            className="min-h-[52px] rounded-xl border border-slate-300 bg-white px-6 py-3 text-base font-bold text-slate-800 hover:bg-slate-50 cursor-pointer"
          >
            {t.app.backBtn}
          </button>

          <button
            type="button"
            disabled={!validation.isValid || !finalConsent || isSubmitting}
            onClick={handleSubmit}
            className="inline-flex min-h-[56px] items-center justify-center gap-2.5 rounded-xl bg-blue-900 px-8 py-3.5 text-lg font-bold text-white hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                <span>{t.review.submittingStatus}</span>
              </>
            ) : (
              <>
                <Send className="h-5 w-5" aria-hidden="true" />
                <span>{t.review.submitBtn}</span>
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
