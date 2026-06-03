# NHAI Face Recognition Mobile App (Frontend)

This directory contains the React Native client application for the NHAI Face Recognition Access Control System. It is designed to work offline-first, performing face detection, active liveness checks, and recognition embedding comparison entirely on-device, then syncing auth logs in the background.

Refer to the root-level [README.md](file:///d:/REPOS/IIT/NHAI/nhai-project/README.md) for full project setup and backend details.

---

## 1. Local Configuration

Before running the application, make sure to update your local settings:

1. **Sync URL Configuration**:
   - Open [SyncService.js](file:///d:/REPOS/IIT/NHAI/nhai-project/frontend/src/services/SyncService.js#L16) and configure the `SYNC_ENDPOINT` using your deployed AWS Lambda URL.
2. **Admin PIN**:
   - Open [EnrollScreen.js](file:///d:/REPOS/IIT/NHAI/nhai-project/frontend/src/screens/EnrollScreen.js#L39) and change the default `ADMIN_PIN` (currently `1947`).

---

## 2. Installation & Running

### Step 1: Install Node Modules
```sh
npm install
```

### Step 2: Start Metro Bundler
Start the development server:
```sh
npm start
```

### Step 3: Run the App

#### Android
Ensure you have an emulator open or an Android device connected with USB debugging enabled. Then run:
```sh
npm run android
```

#### iOS (macOS only)
Install the CocoaPods dependencies, then run the app:
```sh
cd ios
pod install
cd ..
npm run ios
```
