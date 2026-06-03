/**
 * EnrollScreen.js
 * NHAI Face Recognition System — Admin Face Enrollment Flow
 *
 * Flow:
 *  1. PIN entry (admin authentication)
 *  2. Employee details form (Name, Employee ID, Role)
 *  3. Camera capture (3–5 frames for robust embedding)
 *  4. Average embedding stored to SQLite
 *
 * PIN: 4-digit, configurable via ADMIN_PIN constant below.
 * In production, replace with async storage or secure keychain.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Animated,
  Vibration,
} from 'react-native';
import { Camera, useCameraDevices } from 'react-native-vision-camera';
import { v4 as uuidv4 } from 'uuid';

import FaceRecognitionService from '../services/FaceRecognitionService';
import DatabaseService from '../services/DatabaseService';

// ─── Config ────────────────────────────────────────────────────────────────────

const ADMIN_PIN = '1947'; // Independence Day — change for production
const CAPTURE_FRAMES = 4; // Number of frames to average
const FRAME_CAPTURE_DELAY_MS = 800; // Delay between frame captures

const ROLES = ['ENGINEER', 'SUPERVISOR', 'TOLL_OPERATOR', 'INSPECTOR', 'SECURITY', 'CONTRACTOR'];

// ─── Colors ────────────────────────────────────────────────────────────────────

const COLORS = {
  nhaiBlue: '#003366',
  nhaiOrange: '#FF6B00',
  background: '#F5F7FA',
  surface: '#FFFFFF',
  inputBg: '#F9FAFB',
  border: '#E5E7EB',
  borderFocus: '#003366',
  textPrimary: '#1A1A2E',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
};

// ─── Enrollment Steps ──────────────────────────────────────────────────────────

const STEP = Object.freeze({
  PIN: 'PIN',
  FORM: 'FORM',
  CAMERA: 'CAMERA',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
});

// ─── EnrollScreen Component ────────────────────────────────────────────────────

export default function EnrollScreen({ navigation }) {
  const [step, setStep] = useState(STEP.PIN);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const pinShake = useRef(new Animated.Value(0)).current;

  // Form state
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [formErrors, setFormErrors] = useState({});

  // Camera state
  const [hasPermission, setHasPermission] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturedFrames, setCapturedFrames] = useState([]);

  // Result state
  const [enrolledPerson, setEnrolledPerson] = useState(null);
  const successScale = useRef(new Animated.Value(0)).current;

  const devices = useCameraDevices();
  const device = devices.front;
  const cameraRef = useRef(null);

  // ─── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    Camera.requestCameraPermission().then((perm) => {
      setHasPermission(perm === 'authorized' || perm === 'granted');
    });
    FaceRecognitionService.init().then(() => setIsModelReady(true)).catch(console.error);
  }, []);

  // ─── Step 1: PIN ──────────────────────────────────────────────────────────

  const handlePinInput = (digit) => {
    if (pin.length >= 4) return;
    const newPin = pin + digit;
    setPin(newPin);
    setPinError('');
    if (newPin.length === 4) {
      setTimeout(() => validatePin(newPin), 150);
    }
  };

  const validatePin = (enteredPin) => {
    if (enteredPin === ADMIN_PIN) {
      setStep(STEP.FORM);
      setPin('');
    } else {
      setPinError('Incorrect PIN. Try again.');
      setPin('');
      Vibration.vibrate(300);
      Animated.sequence([
        Animated.timing(pinShake, { toValue: 10, duration: 60, useNativeDriver: true }),
        Animated.timing(pinShake, { toValue: -10, duration: 60, useNativeDriver: true }),
        Animated.timing(pinShake, { toValue: 10, duration: 60, useNativeDriver: true }),
        Animated.timing(pinShake, { toValue: 0, duration: 60, useNativeDriver: true }),
      ]).start();
    }
  };

  // ─── Step 2: Form ─────────────────────────────────────────────────────────

  const validateForm = () => {
    const errors = {};
    if (!name.trim() || name.trim().length < 2) errors.name = 'Enter a valid full name';
    if (!employeeId.trim() || !/^[A-Z0-9\-]+$/i.test(employeeId.trim())) {
      errors.employeeId = 'Enter a valid Employee ID (letters, numbers, hyphens)';
    }
    if (!selectedRole) errors.role = 'Please select a role';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleFormNext = async () => {
    if (!validateForm()) return;

    // Check if employee ID already exists
    const exists = await DatabaseService.isEnrolled(employeeId.trim().toUpperCase());
    if (exists) {
      Alert.alert(
        'Already Enrolled',
        `Employee ID ${employeeId.toUpperCase()} is already in the system.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Re-Enroll',
            onPress: () => setStep(STEP.CAMERA),
          },
        ]
      );
      return;
    }

    setStep(STEP.CAMERA);
  };

  // ─── Step 3: Camera Capture ───────────────────────────────────────────────

  const startCapture = useCallback(async () => {
    if (!cameraRef.current || isCapturing) return;
    setIsCapturing(true);
    setCaptureProgress(0);
    setCapturedFrames([]);

    const frames = [];
    for (let i = 0; i < CAPTURE_FRAMES; i++) {
      try {
        // Capture photo
        const photo = await cameraRef.current.takePhoto({ qualityPrioritization: 'quality' });
        // Convert to tensor
        const imageTensor = FaceRecognitionService.frameToTensor({ uri: photo.path });
        const hasFace = await FaceRecognitionService.hasSingleFace(imageTensor);

        if (hasFace) {
          frames.push(imageTensor);
          setCaptureProgress(i + 1);
        } else {
          Alert.alert('No face detected', 'Please position your face clearly in the frame and try again.');
          setIsCapturing(false);
          setCaptureProgress(0);
          return;
        }

        if (i < CAPTURE_FRAMES - 1) {
          await new Promise((r) => setTimeout(r, FRAME_CAPTURE_DELAY_MS));
        }
      } catch (err) {
        console.error('[Enroll] Capture error:', err);
        Alert.alert('Capture Error', err.message);
        setIsCapturing(false);
        return;
      }
    }

    setCapturedFrames(frames);
    await processEnrollment(frames);
  }, [isCapturing, name, employeeId, selectedRole]);

  // ─── Step 4: Process & Save ───────────────────────────────────────────────

  const processEnrollment = async (frames) => {
    setStep(STEP.PROCESSING);

    try {
      // Extract averaged embedding from all frames
      const embedding = await FaceRecognitionService.extractAverageEmbedding(frames);
      if (!embedding) {
        throw new Error('Could not extract a valid face embedding from captured frames.');
      }

      const id = uuidv4();
      const personData = {
        id,
        name: name.trim(),
        employeeId: employeeId.trim().toUpperCase(),
        role: selectedRole,
        embedding,
        enrolledBy: 'ADMIN',
      };

      await DatabaseService.enrollFace(personData);

      setEnrolledPerson(personData);
      setStep(STEP.SUCCESS);

      Vibration.vibrate([0, 200, 100, 200]);
      Animated.spring(successScale, {
        toValue: 1,
        tension: 60,
        friction: 7,
        useNativeDriver: true,
      }).start();

    } catch (err) {
      console.error('[Enroll] Process error:', err);
      Alert.alert('Enrollment Failed', err.message, [
        { text: 'Retry', onPress: () => setStep(STEP.CAMERA) },
      ]);
    } finally {
      setIsCapturing(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" backgroundColor={COLORS.nhaiBlue} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Admin Enrollment</Text>
        <StepIndicator currentStep={step} />
      </View>

      {/* Step Content */}
      {step === STEP.PIN && (
        <PinStep pin={pin} error={pinError} shakeAnim={pinShake} onDigit={handlePinInput} onDelete={() => setPin(pin.slice(0, -1))} />
      )}

      {step === STEP.FORM && (
        <FormStep
          name={name} setName={setName}
          employeeId={employeeId} setEmployeeId={setEmployeeId}
          selectedRole={selectedRole} setSelectedRole={setSelectedRole}
          roles={ROLES}
          errors={formErrors}
          onNext={handleFormNext}
        />
      )}

      {step === STEP.CAMERA && (
        <CameraStep
          device={device}
          cameraRef={cameraRef}
          hasPermission={hasPermission}
          isModelReady={isModelReady}
          isCapturing={isCapturing}
          captureProgress={captureProgress}
          totalFrames={CAPTURE_FRAMES}
          onCapture={startCapture}
          name={name}
          employeeId={employeeId}
          role={selectedRole}
        />
      )}

      {step === STEP.PROCESSING && <ProcessingStep />}

      {step === STEP.SUCCESS && enrolledPerson && (
        <SuccessStep
          person={enrolledPerson}
          scaleAnim={successScale}
          onEnrollAnother={() => {
            setName(''); setEmployeeId(''); setSelectedRole('');
            setCaptureProgress(0); successScale.setValue(0);
            setStep(STEP.FORM);
          }}
          onHome={() => navigation.goBack()}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Step Indicator ────────────────────────────────────────────────────────────

function StepIndicator({ currentStep }) {
  const steps = [STEP.PIN, STEP.FORM, STEP.CAMERA, STEP.SUCCESS];
  const currentIdx = steps.indexOf(currentStep);
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {steps.map((s, i) => (
        <View
          key={s}
          style={[
            stepStyles.dot,
            i <= currentIdx && stepStyles.dotActive,
          ]}
        />
      ))}
    </View>
  );
}
const stepStyles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotActive: { backgroundColor: COLORS.nhaiOrange },
});

// ─── PIN Step ──────────────────────────────────────────────────────────────────

function PinStep({ pin, error, shakeAnim, onDigit, onDelete }) {
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'DEL'];
  return (
    <ScrollView contentContainerStyle={styles.stepContainer}>
      <Text style={styles.stepTitle}>🔐 Admin Authentication</Text>
      <Text style={styles.stepSubtitle}>Enter your 4-digit admin PIN to continue</Text>

      <Animated.View style={[styles.pinDots, { transform: [{ translateX: shakeAnim }] }]}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.pinDot, pin.length > i && styles.pinDotFilled]} />
        ))}
      </Animated.View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.pinGrid}>
        {digits.map((d, idx) => {
          if (d === null) return <View key={idx} style={styles.pinKeyEmpty} />;
          return (
            <TouchableOpacity
              key={idx}
              style={[styles.pinKey, d === 'DEL' && styles.pinKeyDel]}
              onPress={() => d === 'DEL' ? onDelete() : onDigit(String(d))}
              activeOpacity={0.7}
            >
              <Text style={[styles.pinKeyText, d === 'DEL' && styles.pinKeyDelText]}>
                {d === 'DEL' ? '⌫' : d}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

// ─── Form Step ─────────────────────────────────────────────────────────────────

function FormStep({ name, setName, employeeId, setEmployeeId, selectedRole, setSelectedRole, roles, errors, onNext }) {
  return (
    <ScrollView contentContainerStyle={styles.stepContainer} keyboardShouldPersistTaps="handled">
      <Text style={styles.stepTitle}>📋 Personnel Details</Text>
      <Text style={styles.stepSubtitle}>Enter the details of the person to enroll</Text>

      <View style={styles.formGroup}>
        <Text style={styles.formLabel}>Full Name *</Text>
        <TextInput
          style={[styles.formInput, errors.name && styles.formInputError]}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Rajesh Kumar Singh"
          placeholderTextColor={COLORS.textTertiary}
          autoCapitalize="words"
          returnKeyType="next"
        />
        {errors.name && <Text style={styles.fieldError}>{errors.name}</Text>}
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.formLabel}>Employee ID *</Text>
        <TextInput
          style={[styles.formInput, errors.employeeId && styles.formInputError]}
          value={employeeId}
          onChangeText={setEmployeeId}
          placeholder="e.g. NHAI-2024-001"
          placeholderTextColor={COLORS.textTertiary}
          autoCapitalize="characters"
          returnKeyType="done"
        />
        {errors.employeeId && <Text style={styles.fieldError}>{errors.employeeId}</Text>}
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.formLabel}>Role *</Text>
        <View style={styles.roleGrid}>
          {roles.map((role) => (
            <TouchableOpacity
              key={role}
              style={[styles.roleChip, selectedRole === role && styles.roleChipSelected]}
              onPress={() => setSelectedRole(role)}
            >
              <Text style={[styles.roleChipText, selectedRole === role && styles.roleChipTextSelected]}>
                {role.replace('_', ' ')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {errors.role && <Text style={styles.fieldError}>{errors.role}</Text>}
      </View>

      <TouchableOpacity style={styles.primaryButton} onPress={onNext}>
        <Text style={styles.primaryButtonText}>Continue to Camera →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Camera Step ───────────────────────────────────────────────────────────────

function CameraStep({ device, cameraRef, hasPermission, isModelReady, isCapturing, captureProgress, totalFrames, onCapture, name, employeeId, role }) {
  if (!hasPermission || !device || !isModelReady) {
    return (
      <View style={styles.stepContainer}>
        <ActivityIndicator color={COLORS.nhaiOrange} size="large" />
        <Text style={{ color: COLORS.textSecondary, marginTop: 12 }}>
          {!hasPermission ? 'Camera permission needed' : !device ? 'Finding camera...' : 'Loading models...'}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Person summary bar */}
      <View style={cameraStepStyles.personBar}>
        <Text style={cameraStepStyles.personName}>{name}</Text>
        <Text style={cameraStepStyles.personMeta}>{employeeId} · {role.replace('_', ' ')}</Text>
      </View>

      {/* Camera */}
      <View style={{ flex: 1, position: 'relative' }}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={true}
          photo={true}
        />
        <View style={cameraStepStyles.ovalContainer} pointerEvents="none">
          <View style={cameraStepStyles.oval} />
          <Text style={cameraStepStyles.ovalLabel}>
            {isCapturing ? `Capturing ${captureProgress}/${totalFrames}...` : 'Center your face here'}
          </Text>
        </View>
      </View>

      {/* Capture area */}
      <View style={cameraStepStyles.captureArea}>
        {isCapturing ? (
          <View style={cameraStepStyles.progressRow}>
            {Array.from({ length: totalFrames }).map((_, i) => (
              <View
                key={i}
                style={[cameraStepStyles.frameDot, i < captureProgress && cameraStepStyles.frameDotDone]}
              />
            ))}
          </View>
        ) : null}

        <TouchableOpacity
          style={[cameraStepStyles.captureButton, isCapturing && { opacity: 0.5 }]}
          onPress={onCapture}
          disabled={isCapturing}
          activeOpacity={0.85}
        >
          <View style={cameraStepStyles.captureButtonInner}>
            {isCapturing
              ? <ActivityIndicator color="#FFF" />
              : <Text style={cameraStepStyles.captureIcon}>📸</Text>}
          </View>
        </TouchableOpacity>
        <Text style={cameraStepStyles.captureHint}>
          {isCapturing
            ? 'Hold still...'
            : `${totalFrames} photos will be taken automatically`}
        </Text>
      </View>
    </View>
  );
}

const cameraStepStyles = StyleSheet.create({
  personBar: {
    backgroundColor: COLORS.nhaiBlue,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  personName: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  personMeta: { color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 2 },
  ovalContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oval: {
    width: 200,
    height: 260,
    borderRadius: 100,
    borderWidth: 3,
    borderColor: COLORS.nhaiOrange,
    borderStyle: 'dashed',
  },
  ovalLabel: {
    color: '#FFF',
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  captureArea: {
    backgroundColor: '#000',
    paddingVertical: 24,
    alignItems: 'center',
  },
  progressRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  frameDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  frameDotDone: { backgroundColor: COLORS.nhaiOrange },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.nhaiOrange,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,107,0,0.3)',
  },
  captureButtonInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.nhaiOrange, alignItems: 'center', justifyContent: 'center' },
  captureIcon: { fontSize: 26 },
  captureHint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 10 },
});

// ─── Processing Step ───────────────────────────────────────────────────────────

function ProcessingStep() {
  return (
    <View style={[styles.stepContainer, { alignItems: 'center', justifyContent: 'center' }]}>
      <ActivityIndicator color={COLORS.nhaiOrange} size="large" />
      <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: '700', marginTop: 20 }}>
        Processing Enrollment
      </Text>
      <Text style={{ color: COLORS.textSecondary, marginTop: 8, textAlign: 'center' }}>
        Extracting face embedding and saving to local database...
      </Text>
    </View>
  );
}

// ─── Success Step ──────────────────────────────────────────────────────────────

function SuccessStep({ person, scaleAnim, onEnrollAnother, onHome }) {
  return (
    <View style={[styles.stepContainer, { alignItems: 'center' }]}>
      <Animated.View style={{ transform: [{ scale: scaleAnim }], alignItems: 'center' }}>
        <Text style={{ fontSize: 64, marginBottom: 16 }}>✅</Text>
        <Text style={[styles.stepTitle, { color: COLORS.success }]}>Enrolled Successfully!</Text>
        <Text style={styles.stepSubtitle}>The following person has been added to the system</Text>

        <View style={successStyles.personCard}>
          <Text style={successStyles.personName}>{person.name}</Text>
          <Text style={successStyles.personId}>{person.employeeId}</Text>
          <Text style={successStyles.personRole}>{person.role.replace('_', ' ')}</Text>
          <Text style={successStyles.personId}>ID: {person.id.slice(0, 8)}...</Text>
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={onEnrollAnother}>
          <Text style={styles.primaryButtonText}>+ Enroll Another Person</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.primaryButton, { backgroundColor: COLORS.nhaiBlue, marginTop: 10 }]} onPress={onHome}>
          <Text style={styles.primaryButtonText}>← Back to Home</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const successStyles = StyleSheet.create({
  personCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
    marginVertical: 24,
    borderWidth: 1.5,
    borderColor: COLORS.success,
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  personName: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '800', marginBottom: 6 },
  personId: { color: COLORS.textSecondary, fontSize: 13, marginTop: 3 },
  personRole: { color: COLORS.nhaiOrange, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 },
});

// ─── Shared Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  // Header
  header: {
    backgroundColor: COLORS.nhaiBlue,
    paddingTop: Platform.OS === 'ios' ? 54 : 20,
    paddingBottom: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: { color: '#FFF', fontSize: 18, fontWeight: '600' },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: '700' },

  // Step containers
  stepContainer: {
    flex: 1,
    padding: 24,
    paddingTop: 32,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 32,
    lineHeight: 20,
  },

  // PIN
  pinDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginVertical: 32,
  },
  pinDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: COLORS.nhaiBlue,
    backgroundColor: 'transparent',
  },
  pinDotFilled: { backgroundColor: COLORS.nhaiBlue },
  pinGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
  },
  pinKey: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pinKeyEmpty: { width: 80, height: 80 },
  pinKeyText: { fontSize: 26, fontWeight: '600', color: COLORS.textPrimary },
  pinKeyDel: { backgroundColor: COLORS.inputBg },
  pinKeyDelText: { fontSize: 22 },

  // Form
  formGroup: { marginBottom: 20 },
  formLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  formInput: {
    backgroundColor: COLORS.inputBg,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    padding: 14,
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  formInputError: { borderColor: COLORS.error },
  fieldError: { color: COLORS.error, fontSize: 12, marginTop: 5, fontWeight: '500' },
  errorText: { color: COLORS.error, textAlign: 'center', fontSize: 14, fontWeight: '600', marginBottom: 12 },

  // Role chips
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.inputBg,
  },
  roleChipSelected: { borderColor: COLORS.nhaiBlue, backgroundColor: COLORS.nhaiBlue },
  roleChipText: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  roleChipTextSelected: { color: '#FFF' },

  // Primary button
  primaryButton: {
    backgroundColor: COLORS.nhaiOrange,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: COLORS.nhaiOrange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  primaryButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },

  // Shared
  textPrimary: { color: COLORS.textPrimary },
  textSecondary: { color: COLORS.textSecondary },
});
