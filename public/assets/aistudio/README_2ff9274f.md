# Multilingual Voice Guided Kiosk — OCR Implementation & VS Code Setup Guide

This project contains the complete, working production OCR implementation for identity documents (Aadhaar Card) and Bank Passbooks, mapping extracted data accurately to the 7 citizen fields.

---

## 1. Complete OCR Architecture & Working Components

The working OCR implementation consists of 4 tightly integrated modules:

### A. Backend OCR API Endpoint (`server.ts` -> `/api/kiosk/ocr-document`)
- **Technology & SDK**: `@google/genai` (v2.4.0) with Express (`express` 4.21.2).
- **Models**: `gemini-3.6-flash` (primary), fallback to `gemini-flash-latest` and `gemini-3.1-flash-lite`.
- **Configuration**:
  - `temperature: 0.0` (zero creativity, strict deterministic factual extraction).
  - `responseMimeType: "application/json"` with structured JSON schema.
- **Extraction Rules**:
  - **Zero Hallucination / Zero Guessing**: Unclear, blurry, or cut-off fields return empty string (`""`) for manual user entry. Absolutely no demo or sample data.
  - **Numeric Preservation**: Aadhaar numbers and phone numbers are strictly numeric digits only (`\D` stripped). No conversion to words.
  - **Field Mapping**: Aadhaar Card and Bank Passbook fields are parsed into structured keys:
    - `name` / `applicantName`
    - `aadhaarNumber` / `idNumber` (numeric digits only)
    - `phoneNumber` / `phone` (numeric digits only)
    - `fatherName`
    - `gender`
    - `address`
    - `dob` (Date of Birth in DD/MM/YYYY or YYYY-MM-DD)
    - Passbook specifics: `accountNumber`, `bankName`, `ifscCode`, `branch`, `cifNumber`.

### B. Client OCR Service (`src/services/ocrService.ts`)
- **Image Preprocessing**:
  - Max dimension bounding (1600px) maintaining crisp aspect ratio.
  - Contrast and brightness normalization (`filter: contrast(1.15..1.20) brightness(1.02)`).
  - 3x3 unsharp mask convolution kernel sharpening text character edges against card textures:
    ```
    [  0,   -0.3,   0  ]
    [ -0.3,  2.2,  -0.3]
    [  0,   -0.3,   0  ]
    ```
  - Crop box ratio calculation with 10% generous safety margins to prevent clipping header/footer text.
- **Processing Hierarchy**:
  1. Calls `/api/kiosk/ocr-document` with base64 image payload.
  2. If offline or server unreachable, falls back to in-browser client Tesseract OCR (`tesseract.js`) with regex parsing rules (`parseTextToFields`).
  3. Strict policy: If no text is readable, returns empty fields—NEVER dummy data.

### C. Live Document Scanner Modal (`src/components/OCRDocumentScanner.tsx`)
- **Webcam & Camera Feed**: `navigator.mediaDevices.getUserMedia` with fallback to standard webcam.
- **Framing Guide**: Visual card guideline box with 10% safety margin.
- **File Upload**: Supports direct photo upload (JPEG/PNG) from mobile/desktop.
- **Voice Feedback**: Multilingual voice guidance via `ttsService` in Tamil, English, and 8 other Indian languages.
- **Verification UI**: Live preview of detected fields, confidence score, and clear consent checkbox before applying to form.

### D. Form Integration (`src/App.tsx`)
- Maps extracted values directly into the 7 citizen fields:
  1. `name` (Name)
  2. `aadhaarNumber` (Aadhaar Number — numeric digits only)
  3. `phoneNumber` (Phone Number — numeric digits only)
  4. `fatherName` (Father's Name)
  5. `gender` (Gender)
  6. `address` (Address)
  7. `dob` (Date of Birth)
- Pre-fills the form cleanly and allows the user to review, edit with voice/touch, submit, and print thermal receipt.

---

## 2. Required Dependencies

All required dependencies are specified in `package.json`:

```json
{
  "dependencies": {
    "@google/genai": "^2.4.0",
    "@tailwindcss/vite": "^4.1.14",
    "@vitejs/plugin-react": "^5.0.4",
    "@zxing/library": "^0.23.0",
    "canvas-confetti": "^1.9.4",
    "dotenv": "^17.2.3",
    "express": "^4.21.2",
    "jspdf": "^4.2.1",
    "jsqr": "^1.4.0",
    "lucide-react": "^0.546.0",
    "motion": "^12.23.24",
    "pako": "^3.0.1",
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "recharts": "^3.10.1",
    "tesseract.js": "^7.0.0",
    "vite": "^6.2.3"
  },
  "devDependencies": {
    "@types/canvas-confetti": "^1.9.0",
    "@types/express": "^4.17.21",
    "@types/node": "^22.14.0",
    "@types/pako": "^3.0.0",
    "autoprefixer": "^10.4.21",
    "esbuild": "^0.25.0",
    "tailwindcss": "^4.1.14",
    "tsx": "^4.21.0",
    "typescript": "~5.8.2"
  }
}
```

---

## 3. Running in VS Code

### Step 1: Install Dependencies
Open a terminal in the project root:
```bash
npm install
```

### Step 2: Configure Environment Variables
Create a `.env` file in the root directory:
```bash
cp .env.example .env
```
Open `.env` and set your Gemini API key:
```env
GEMINI_API_KEY="YOUR_ACTUAL_GEMINI_API_KEY"
PORT=3000
```

### Step 3: Run the Development Server
```bash
npm run dev
```
This runs `tsx server.ts`, which starts the Express backend with the OCR endpoint and mounts Vite in middleware mode.

Open your browser at `http://localhost:3000`.

### Step 4: Build for Production (Optional)
```bash
npm run build
npm start
```

---

## 4. OCR Workflow

1. Citizen clicks **"Scan Document / ஆவணம் ஸ்கேன்"** or selects camera capture / file upload.
2. Citizen aligns card (Aadhaar or Bank Passbook) within the guideline box.
3. System captures and preprocesses the image (scaling, contrast normalization, 3x3 unsharp convolution sharpening).
4. The image is sent to the backend `/api/kiosk/ocr-document` endpoint.
5. Gemini extracts actual text and validates against strict rules (zero hallucination, numbers only for Aadhaar/phone).
6. Result is displayed on the Review card.
7. Citizen confirms and data autofills into the 7 fields.
8. Citizen reviews, submits, and prints thermal receipt.
