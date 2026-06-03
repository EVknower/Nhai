# NHAI Face Recognition System — Getting Started Guide

This document contains step-by-step instructions on setting up, configuring, and starting both the backend infrastructure and the frontend mobile application.

---

## 1. Prerequisites

Before starting, ensure your local development system meets the following requirements:

### General Requirements
* **Node.js**: `v18.x` or higher installed
* **Package Manager**: `npm` (v9+) or `yarn` (v1.22+)

### Android Development Requirements (For Windows/macOS/Linux)
* **Java Development Kit (JDK)**: JDK 11 or 17 (recommended: Zulu JDK 17)
* **Android Studio**: Installed with:
  * Android SDK Platform (API level 33 or 34)
  * Android SDK Build-Tools
  * Android Emulator
  * Android SDK Platform-Tools (configured in system `PATH` so `adb` works)
* **Active Android Device / Emulator**: Running and connected via USB debugging (`adb devices` should list the device)

### iOS Development Requirements (macOS ONLY)
* **macOS**: Required to build the iOS app
* **Xcode**: v14+ installed with command-line tools
* **CocoaPods**: Installed via Homebrew or Ruby Gem

---

## 2. Backend Setup (AWS Serverless)

The backend consists of an AWS Lambda sync function and a DynamoDB table for log persistence.

### Step 1: Install Lambda Dependencies
Navigate to the backend directory and install the necessary AWS SDK dependencies:
```sh
cd backend
npm install
```

### Step 2: Deploy Infrastructure
Use the provided CloudFormation template to deploy the resources:
1. Open the [AWS CloudFormation Console](https://console.aws.amazon.com/cloudformation/).
2. Click **Create stack** -> **With new resources (standard)**.
3. Select **Upload a template file** and choose [cloudformation.yaml](file:///d:/REPOS/IIT/NHAI/nhai-project/backend/infra/cloudformation.yaml).
4. Set the parameters (e.g., Environment `dev` or `prod`).
5. Click **Next** through the options, check the checkbox acknowledging IAM role creation, and click **Submit**.
6. Once deployment finishes, go to the **Outputs** tab and copy the `SyncEndpointUrl` (e.g., `https://xxxxxx.lambda-url.ap-south-1.on.aws/`).

---

## 3. Frontend Setup (React Native)

### Step 1: Install Dependencies
Navigate to the frontend directory and install the packages:
```sh
cd frontend
npm install
```

### Step 2: Configure Environment & Sync Endpoint
1. Open [SyncService.js](file:///d:/REPOS/IIT/NHAI/nhai-project/frontend/src/services/SyncService.js#L16).
2. Locate the `SYNC_ENDPOINT` configuration:
   ```javascript
   const SYNC_ENDPOINT = process.env.NHAI_SYNC_ENDPOINT || 'https://YOUR_LAMBDA_URL.lambda-url.ap-south-1.on.aws/';
   ```
3. Replace `'https://YOUR_LAMBDA_URL.lambda-url.ap-south-1.on.aws/'` with your deployed `SyncEndpointUrl` from the CloudFormation Outputs.

### Step 3: Change Admin PIN (Optional)
1. Open [EnrollScreen.js](file:///d:/REPOS/IIT/NHAI/nhai-project/frontend/src/screens/EnrollScreen.js#L39).
2. Modify the `ADMIN_PIN` value to secure admin enrollment:
   ```javascript
   const ADMIN_PIN = 'YOUR_NEW_PIN'; // Default is '1947'
   ```

### Step 4: Run iOS CocoaPods (macOS Only)
If you are building for iOS on a macOS device, install the native pod dependencies:
```sh
cd frontend/ios
pod install
cd ..
```

---

## 4. Launching the App

### Step 1: Start Metro Bundler
Start the Metro development server in a separate terminal:
```sh
cd frontend
npm start
```

### Step 2: Build and Run on Emulator/Device
Open another terminal pane and run the compile command:

#### Run on Android:
Ensure an emulator is active or a device is plugged in via USB debugging, then run:
```sh
cd frontend
npm run android
```

#### Run on iOS (macOS Only):
```sh
cd frontend
npm run ios
```

---

## 5. Directory Structure Reference

```
nhai-project/
├── backend/
│   ├── infra/
│   │   └── cloudformation.yaml     # CloudFormation Infrastructure IaC template
│   ├── lambda/
│   │   └── syncHandler.js          # AWS Lambda function for log validation & sync
│   └── package.json
└── frontend/
    ├── App.js                      # Application initialization (TF.js + SQLite)
    ├── package.json
    └── src/
        ├── screens/
        │   ├── HomeScreen.js       # Main visual dashboard and status monitors
        │   ├── VerifyScreen.js     # Live camera tracking, liveness check & recognition
        │   └── EnrollScreen.js     # Admin verification keypad & personnel forms
        └── services/
            ├── DatabaseService.js  # SQLite database interface
            ├── FaceRecognitionService.js # BlazeFace detection + MobileNet extractor
            ├── LivenessService.js  # Active liveness detection state FSM
            └── SyncService.js      # Background batch sync with exponential backoff
```
