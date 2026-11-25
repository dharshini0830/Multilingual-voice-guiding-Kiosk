export interface TranslationDictionary {
  app: {
    brandName: string;
    brandTagline: string;
    changeLanguage: string;
    backToDashboard: string;
    stepOf: string; // e.g., "Step {current} of {total}"
    continueBtn: string;
    backBtn: string;
    cancelBtn: string;
    saveBtn: string;
    skipBtn: string;
    confirmBtn: string;
    editBtn: string;
    retryBtn: string;
    requiredLabel: string;
    optionalLabel: string;
  };
  stages: {
    welcome: string;
    language: string;
    dashboard: string;
    documentScan: string;
    ocrReview: string;
    qrScan: string;
    voiceForm: string;
    review: string;
    completion: string;
  };
  voiceBar: {
    assistantLabel: string;
    speakingStatus: string;
    pausedStatus: string;
    mutedStatus: string;
    readyStatus: string;
    replay: string;
    repeatPrevious: string;
    pause: string;
    resume: string;
    mute: string;
    unmute: string;
    speedLabel: string;
    voiceGenderLabel: string;
    femaleVoice: string;
    maleVoice: string;
    unavailableNotice: string;
    browserProvider: string;
    neuralProvider: string;
    textOnlyProvider: string;
  };
  welcome: {
    headline: string;
    subtitle: string;
    purposeTitle: string;
    purposeItems: [string, string, string];
    startButton: string;
    hearWelcomeAgain: string;
    voicePrompt: string;
  };
  languageScreen: {
    title: string;
    subtitle: string;
    listenInstruction: string;
    confirmSelection: string;
    selectedBanner: string;
    voiceGuide: string;
    voiceConfirmed: string; // "{language} selected. Moving to the main service menu."
  };
  dashboard: {
    title: string;
    subtitle: string;
    serviceTypeLabel: string;
    services: {
      citizen_certificate: string;
      pension_welfare: string;
      ration_card: string;
      bank_kyc: string;
    };
    cards: {
      ocrTitle: string;
      ocrDesc: string;
      ocrBtn: string;
      qrTitle: string;
      qrDesc: string;
      qrBtn: string;
      voiceTitle: string;
      voiceDesc: string;
      voiceBtn: string;
    };
    filledProgress: string; // "{filled} of {total} fields completed"
    reviewNowBtn: string;
    resetDraftBtn: string;
    voicePrompt: string;
  };
  consent: {
    title: string;
    body: string;
    points: [string, string, string];
    checkboxLabel: string;
    acceptBtn: string;
    declineBtn: string;
    voicePrompt: string;
  };
  ocr: {
    title: string;
    subtitle: string;
    instructions: string;
    uploadBtn: string;
    cameraBtn: string;
    captureBtn: string;
    stopCameraBtn: string;
    rotateLeft: string;
    rotateRight: string;
    processBtn: string;
    processingStatus: string;
    aiEnhanceToggle: string;
    aiEnhanceDesc: string;
    reviewTitle: string;
    reviewSubtitle: string;
    confidenceHigh: string;
    confidenceMedium: string;
    confidenceLow: string;
    confidenceMissing: string;
    rawTextToggle: string;
    applyToFormBtn: string;
    continueVoiceBtn: string;
    rescanBtn: string;
    cameraDenied: string;
    invalidFileError: string;
    noTextFound: string;
    voiceStartGuide: string;
    voiceScanning: string;
    voiceSuccess: string;
    voicePartial: string;
    voiceFailed: string;
    voiceRefillTitle: string;
    voiceRefillDesc: string;
    speakFieldBtn: string;
  };
  qr: {
    title: string;
    subtitle: string;
    instructions: string;
    startCameraBtn: string;
    stopCameraBtn: string;
    uploadQrBtn: string;
    scanningActive: string;
    detectedTitle: string;
    unverifiedWarning: string;
    formatLabel: string;
    applyBtn: string;
    manualFallbackBtn: string;
    invalidQrError: string;
    cameraError: string;
    unsupportedFormat: string;
    voiceGuide: string;
    voiceSuccess: string;
    voiceError: string;
  };
  form: {
    title: string;
    subtitle: string;
    questionProgress: string; // "Question {current} of {total}"
    speakAnswerBtn: string;
    listeningBtn: string;
    stopListeningBtn: string;
    typeInsteadLabel: string;
    recognizedPrefix: string;
    confirmPrompt: string; // "We heard: {value}. Is this correct?"
    yesCorrectBtn: string;
    repeatVoiceBtn: string;
    prevFieldBtn: string;
    nextFieldBtn: string;
    finishToReviewBtn: string;
    allFieldsValid: string;
    missingFieldsAlert: string; // "{count} required fields need attention"
    sttUnavailableNotice: string;
    recordFallbackBtn: string;
    transcribingStatus: string;
    micDenied: string;
    speakAllTitle: string;
    speakAllDesc: string;
    speakAllBtn: string;
    speakAllExample: string;
    speakAllSuccess: string;
    speakAllNoMatch: string;
    fields: {
      serviceType: { label: string; hint: string; voiceQuestion: string };
      fullName: { label: string; hint: string; voiceQuestion: string };
      idNumber: { label: string; hint: string; voiceQuestion: string };
      dob: { label: string; hint: string; voiceQuestion: string };
      gender: { label: string; hint: string; voiceQuestion: string };
      fatherName: { label: string; hint: string; voiceQuestion: string };
      phoneNumber: { label: string; hint: string; voiceQuestion: string };
      address: { label: string; hint: string; voiceQuestion: string };
      pincode: { label: string; hint: string; voiceQuestion: string };
    };
    genders: {
      Male: string;
      Female: string;
      Other: string;
    };
    voiceReadback: string; // "I heard {value}. Tap Confirm if this is correct, or tap Repeat to say it again."
    voiceUnclear: string;
    voiceAllComplete: string;
  };
  validation: {
    required: string;
    nameTooShort: string;
    idInvalid: string;
    idChecksumWarn: string;
    dobInvalid: string;
    genderRequired: string;
    phoneInvalid: string;
    addressTooShort: string;
    pincodeInvalid: string;
    voiceMissingSummary: string;
  };
  review: {
    title: string;
    subtitle: string;
    readAllAloudBtn: string;
    showFullId: string;
    hideFullId: string;
    editSectionBtn: string;
    consentConfirmLabel: string;
    submitBtn: string;
    submittingStatus: string;
    submitError: string;
    voiceGuide: string;
    voiceSubmitting: string;
    voiceSubmitError: string;
    voiceReadSummaryPrefix: string;
  };
  completion: {
    title: string;
    subtitle: string;
    referenceLabel: string;
    submittedAtLabel: string;
    statusLabel: string;
    statusConfirmed: string;
    downloadPdfBtn: string;
    printBtn: string;
    newApplicationBtn: string;
    exitVoiceBtn: string;
    voiceSuccess: string;
    voiceExit: string;
    receiptFooterNote: string;
  };
}
