import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Animated,
  Vibration,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {Camera, useCameraDevices, useFrameProcessor} from 'react-native-vision-camera';
import {runOnJS} from 'react-native-reanimated';
import {v4 as uuidv4} from 'uuid';
import FaceRecognitionService from '../services/FaceRecognitionService';
import LivenessService, {LivenessState} from '../services/LivenessService';
import DatabaseService from '../services/DatabaseService';
import SyncService from '../services/SyncService';

// ── Color tokens ──────────────────────────────────────────────────────────────
const COLORS = {
  background:    '#0A0A0F',
  surface:       '#12121A',
  card:          '#1A1A28',
  border:        '#2A2A3D',
  primary:       '#FF6B00',
  primaryLight:  '#FF8C00',
  blue:          '#0066CC',
  blueLight:     '#4A9FFF',
  gold:          '#FFB800',
  white:         '#FFFFFF',
  textPrimary:   '#F0F0F8',
  textSecondary: '#888899',
  success:       '#10B981',
  danger:        '#EF4444',
  warning:       '#F59E0B',
  overlay:       'rgba(10,10,15,0.92)',
};

// ── Verification result enum ──────────────────────────────────────────────────
export const VERIFICATION_RESULT = {
  PENDING:        'PENDING',
  LIVENESS_FAIL:  'LIVENESS_FAIL',
  MATCH:          'MATCH',
  NO_MATCH:       'NO_MATCH',
  ERROR:          'ERROR',
};

// ── Constants ─────────────────────────────────────────────────────────────────
const DEVICE_ID = 'NHAI_DEVICE_001';

// ── LivenessBadges sub-component ─────────────────────────────────────────────
const LivenessBadges = ({currentState}) => {
  const steps = [
    {state: LivenessState.BLINK,  icon: '👁️', label: 'Blink'},
    {state: LivenessState.SMILE,  icon: '😊', label: 'Smile'},
    {state: LivenessState.TURN,   icon: '↔️', label: 'Turn'},
  ];

  const stateOrder = [
    LivenessState.BLINK,
    LivenessState.SMILE,
    LivenessState.TURN,
    LivenessState.COMPLETE,
  ];

  const currentIndex = stateOrder.indexOf(currentState);

  return (
    <View style={styles.badgesRow}>
      {steps.map((step, i) => {
        const stepIndex  = stateOrder.indexOf(step.state);
        const isDone     = currentIndex > stepIndex;
        const isActive   = currentIndex === stepIndex;
        return (
          <View
            key={step.state}
            style={[
              styles.badge,
              isDone   && styles.badgeDone,
              isActive && styles.badgeActive,
            ]}>
            <Text style={styles.badgeIcon}>{isDone ? '✅' : step.icon}</Text>
            <Text
              style={[
                styles.badgeLabel,
                isDone   && styles.badgeLabelDone,
                isActive && styles.badgeLabelActive,
              ]}>
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

// ── ResultContent sub-component ───────────────────────────────────────────────
const ResultContent = ({
  result,
  matchedPerson,
  confidence,
  onRetry,
  onHome,
}) => {
  const isMatch  = result === VERIFICATION_RESULT.MATCH;
  const isFail   = result === VERIFICATION_RESULT.LIVENESS_FAIL;
  const isNoMatch= result === VERIFICATION_RESULT.NO_MATCH;
  const isError  = result === VERIFICATION_RESULT.ERROR;

  const icon =
    isMatch   ? '✅' :
    isFail    ? '🚫' :
    isNoMatch ? '❌' :
    isError   ? '⚠️' : '❓';

  const title =
    isMatch   ? 'Identity Verified'       :
    isFail    ? 'Liveness Check Failed'   :
    isNoMatch ? 'Person Not Recognised'   :
    isError   ? 'System Error'            : 'Unknown';

  const subtitle =
    isMatch   ? 'Access granted. Have a safe journey.' :
    isFail    ? 'Please try again and follow the on-screen prompts.' :
    isNoMatch ? 'Face does not match any enrolled employee.' :
    isError   ? 'An unexpected error occurred. Contact admin.' : '';

  const titleColor =
    isMatch   ? COLORS.success :
    isFail    ? COLORS.danger  :
    isNoMatch ? COLORS.danger  :
    isError   ? COLORS.warning : COLORS.white;

  return (
    <View style={styles.resultContent}>
      <Text style={styles.resultIcon}>{icon}</Text>
      <Text style={[styles.resultTitle, {color: titleColor}]}>{title}</Text>
      <Text style={styles.resultSubtitle}>{subtitle}</Text>

      {/* Person card — only on MATCH */}
      {isMatch && matchedPerson && (
        <View style={styles.personCard}>
          <View style={styles.personAvatarBox}>
            <Text style={styles.personAvatar}>
              {(matchedPerson.name ?? 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.personInfo}>
            <Text style={styles.personName}>{matchedPerson.name}</Text>
            <Text style={styles.personDetail}>ID: {matchedPerson.employeeId}</Text>
            <Text style={styles.personDetail}>Role: {matchedPerson.role}</Text>
          </View>

          {/* Confidence bar */}
          <View style={styles.confContainer}>
            <Text style={styles.confLabel}>
              {Math.round((confidence ?? 0) * 100)}% match
            </Text>
            <View style={styles.confBar}>
              <View
                style={[
                  styles.confFill,
                  {
                    width: `${Math.round((confidence ?? 0) * 100)}%`,
                    backgroundColor:
                      confidence > 0.8
                        ? COLORS.success
                        : confidence > 0.6
                        ? COLORS.warning
                        : COLORS.danger,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.resultActions}>
        <TouchableOpacity onPress={onRetry} style={styles.retryBtn} activeOpacity={0.8}>
          <Text style={styles.retryBtnText}>🔄  Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onHome} style={styles.homeBtn} activeOpacity={0.8}>
          <Text style={styles.homeBtnText}>🏠  Home</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ── PermissionDeniedView ──────────────────────────────────────────────────────
const PermissionDeniedView = ({onHome}) => (
  <View style={styles.centredView}>
    <Text style={styles.centredIcon}>📷</Text>
    <Text style={styles.centredTitle}>Camera Permission Required</Text>
    <Text style={styles.centredSubtitle}>
      Please grant camera access in your device settings to use face verification.
    </Text>
    <TouchableOpacity onPress={onHome} style={styles.retryBtn}>
      <Text style={styles.retryBtnText}>← Go Back</Text>
    </TouchableOpacity>
  </View>
);

// ── LoadingView ───────────────────────────────────────────────────────────────
const LoadingView = ({message = 'Initialising…'}) => (
  <View style={styles.centredView}>
    <ActivityIndicator size="large" color={COLORS.primary} />
    <Text style={styles.loadingText}>{message}</Text>
  </View>
);

// ── VerifyScreen ──────────────────────────────────────────────────────────────
const VerifyScreen = ({navigation}) => {
  // ── State ──────────────────────────────────────────────────────────────────
  const [hasPermission,      setHasPermission]      = useState(null);
  const [isModelReady,       setIsModelReady]       = useState(false);
  const [isActive,           setIsActive]           = useState(true);
  const [livenessState,      setLivenessState]      = useState(LivenessState.BLINK);
  const [challengePrompt,    setChallengePrompt]    = useState('Blink your eyes slowly…');
  const [headTurnDirection,  setHeadTurnDirection]  = useState('left');
  const [verificationResult, setVerificationResult] = useState(VERIFICATION_RESULT.PENDING);
  const [matchedPerson,      setMatchedPerson]      = useState(null);
  const [confidence,         setConfidence]         = useState(0);
  const [isProcessing,       setIsProcessing]       = useState(false);
  const [enrollments,        setEnrollments]        = useState([]);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const resultScale    = useRef(new Animated.Value(0)).current;
  const progressAnim   = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const challengeSlide = useRef(new Animated.Value(40)).current;
  const lastFrameRef   = useRef(null);
  const isFinished     = useRef(false);

  // ── Camera ─────────────────────────────────────────────────────────────────
  const devices = useCameraDevices();
  const device  = devices.front;

  // ── Init screen ────────────────────────────────────────────────────────────
  const initScreen = useCallback(async () => {
    try {
      // Camera permission
      const camStatus = await Camera.requestCameraPermission();
      setHasPermission(camStatus === 'authorized');
      if (camStatus !== 'authorized') return;

      // Init face recognition model
      await FaceRecognitionService.init();

      // Load enrollments
      const stored = await DatabaseService.getAllEmbeddings();
      setEnrollments(stored ?? []);

      // Subscribe to liveness events
      LivenessService.subscribe({
        onStateChange: (state, prompt, direction) => {
          setLivenessState(state);
          setChallengePrompt(prompt ?? '');
          if (direction) setHeadTurnDirection(direction);

          // Animate challenge box in
          challengeSlide.setValue(40);
          Animated.spring(challengeSlide, {
            toValue: 0,
            useNativeDriver: true,
            tension: 60,
            friction: 10,
          }).start();
        },
        onComplete: handleLivenessPassed,
        onFail:     handleLivenessFailed,
      });

      setIsModelReady(true);

      // Slide challenge in initially
      Animated.spring(challengeSlide, {
        toValue: 0,
        useNativeDriver: true,
        tension: 60,
        friction: 10,
      }).start();
    } catch (err) {
      console.error('[VerifyScreen] initScreen error:', err);
      Alert.alert('Init Error', err?.message ?? 'Failed to initialise face recognition.');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    initScreen();
    return () => {
      LivenessService.unsubscribe?.();
      LivenessService.reset?.();
    };
  }, [initScreen]);

  // ── Result overlay animation ───────────────────────────────────────────────
  const showResultAnimation = useCallback((result) => {
    isFinished.current = true;
    setIsActive(false);
    setVerificationResult(result);

    Animated.parallel([
      Animated.timing(overlayOpacity, {toValue: 1, duration: 350, useNativeDriver: true}),
      Animated.spring(resultScale,    {toValue: 1, tension: 60, friction: 9, useNativeDriver: true}),
    ]).start();
  }, [overlayOpacity, resultScale]);

  // ── Liveness passed → face matching ───────────────────────────────────────
  const handleLivenessPassed = useCallback(async () => {
    if (isFinished.current) return;
    if (isProcessing)       return;
    setIsProcessing(true);

    try {
      const frame = lastFrameRef.current;
      if (!frame) throw new Error('No frame captured');

      // Extract embedding from last captured frame
      const embedding = await FaceRecognitionService.extractEmbedding(frame);
      if (!embedding) throw new Error('Failed to extract face embedding');

      // Match against enrolled persons
      const match = await FaceRecognitionService.findBestMatch(embedding, enrollments);

      // Build log record
      const logId = uuidv4();
      const timestamp = new Date().toISOString();

      if (match && match.similarity >= 0.55) {
        // ── SUCCESS ──
        await DatabaseService.saveVerificationLog({
          id:         logId,
          deviceId:   DEVICE_ID,
          personId:   match.personId,
          result:     'MATCH',
          confidence: match.similarity,
          timestamp,
        });
        await SyncService.queueRecord({id: logId, type: 'verification', timestamp});

        setMatchedPerson(match.person);
        setConfidence(match.similarity);
        Vibration.vibrate(Platform.OS === 'android' ? [0, 100, 80, 100] : 400);
        showResultAnimation(VERIFICATION_RESULT.MATCH);
      } else {
        // ── NO MATCH ──
        await DatabaseService.saveVerificationLog({
          id:         logId,
          deviceId:   DEVICE_ID,
          personId:   null,
          result:     'NO_MATCH',
          confidence: match?.similarity ?? 0,
          timestamp,
        });
        await SyncService.queueRecord({id: logId, type: 'verification', timestamp});

        Vibration.vibrate(Platform.OS === 'android' ? [0, 300, 100, 300] : 800);
        showResultAnimation(VERIFICATION_RESULT.NO_MATCH);
      }
    } catch (err) {
      console.error('[VerifyScreen] handleLivenessPassed error:', err);
      showResultAnimation(VERIFICATION_RESULT.ERROR);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, enrollments, showResultAnimation]);

  // ── Liveness failed ────────────────────────────────────────────────────────
  const handleLivenessFailed = useCallback(async () => {
    if (isFinished.current) return;

    try {
      const logId = uuidv4();
      const timestamp = new Date().toISOString();
      await DatabaseService.saveVerificationLog({
        id:       logId,
        deviceId: DEVICE_ID,
        personId: null,
        result:   'LIVENESS_FAIL',
        confidence: 0,
        timestamp,
      });
      await SyncService.queueRecord({id: logId, type: 'verification', timestamp});
    } catch (err) {
      console.warn('[VerifyScreen] handleLivenessFailed log error:', err);
    }

    Vibration.vibrate(Platform.OS === 'android' ? [0, 500] : 600);
    showResultAnimation(VERIFICATION_RESULT.LIVENESS_FAIL);
  }, [showResultAnimation]);

  // ── Frame processor (runs on camera thread) ────────────────────────────────
  const processFrameOnJS = useCallback((frame) => {
    if (isFinished.current || isProcessing) return;
    lastFrameRef.current = frame;

    // Detect faces and pass to LivenessService
    FaceRecognitionService.detectFaces(frame)
      .then((faces) => {
        if (faces && faces.length > 0) {
          LivenessService.processFrame(faces[0], frame);
        }
      })
      .catch((err) => console.warn('[VerifyScreen] detectFaces error:', err));
  }, [isProcessing]);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    runOnJS(processFrameOnJS)(frame);
  }, [processFrameOnJS]);

  // ── Reset / retry ──────────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    isFinished.current = false;
    lastFrameRef.current = null;
    resultScale.setValue(0);
    overlayOpacity.setValue(0);
    progressAnim.setValue(0);
    challengeSlide.setValue(40);

    setVerificationResult(VERIFICATION_RESULT.PENDING);
    setMatchedPerson(null);
    setConfidence(0);
    setIsProcessing(false);
    setIsActive(true);
    setLivenessState(LivenessState.BLINK);
    setChallengePrompt('Blink your eyes slowly…');

    LivenessService.reset?.();

    Animated.spring(challengeSlide, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 10,
    }).start();
  }, [resultScale, overlayOpacity, progressAnim, challengeSlide]);

  const handleHome = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // ── Head-turn arrow helper ─────────────────────────────────────────────────
  const turnArrow = headTurnDirection === 'left' ? '←' : '→';

  // ── Derived flags ──────────────────────────────────────────────────────────
  const isDone     = verificationResult !== VERIFICATION_RESULT.PENDING;
  const isTurnStep = livenessState === LivenessState.TURN;

  // ── Render guards ──────────────────────────────────────────────────────────
  if (hasPermission === false) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <PermissionDeniedView onHome={handleHome} />
      </View>
    );
  }

  if (hasPermission === null || !isModelReady || !device) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <LoadingView
          message={
            hasPermission === null
              ? 'Requesting camera permission…'
              : !isModelReady
              ? 'Loading face recognition model…'
              : 'Opening camera…'
          }
        />
      </View>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />

      {/* Camera feed */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        frameProcessor={frameProcessor}
        frameProcessorFps={5}
      />

      {/* Dark vignette overlay (always visible) */}
      <View style={styles.vignette} pointerEvents="none" />

      {/* ── Face guide oval (only when not done) ── */}
      {!isDone && (
        <View style={styles.ovalGuideWrapper} pointerEvents="none">
          <View style={styles.ovalGuide} />
          <Text style={styles.ovalHint}>Centre your face</Text>
        </View>
      )}

      {/* ── Challenge box (liveness badges + prompt) ── */}
      {!isDone && (
        <Animated.View
          style={[styles.challengeBox, {transform: [{translateY: challengeSlide}]}]}>
          <LivenessBadges currentState={livenessState} />
          <Text style={styles.challengePrompt}>{challengePrompt}</Text>
          {isTurnStep && (
            <Text style={styles.turnArrow}>{turnArrow}</Text>
          )}
        </Animated.View>
      )}

      {/* ── Processing spinner ── */}
      {isProcessing && (
        <View style={styles.processingBanner}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.processingText}>Verifying identity…</Text>
        </View>
      )}

      {/* ── Result overlay ── */}
      {isDone && (
        <Animated.View
          style={[styles.resultOverlay, {opacity: overlayOpacity}]}
          pointerEvents="auto">
          <Animated.View
            style={[styles.resultCard, {transform: [{scale: resultScale}]}]}>
            <ResultContent
              result={verificationResult}
              matchedPerson={matchedPerson}
              confidence={confidence}
              onRetry={handleRetry}
              onHome={handleHome}
            />
          </Animated.View>
        </Animated.View>
      )}

      {/* ── Back button (top-left) ── */}
      {!isDone && (
        <TouchableOpacity
          style={styles.backBtn}
          onPress={handleHome}
          activeOpacity={0.8}>
          <Text style={styles.backBtnText}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // Vignette
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    borderWidth: 0,
    // Simulate vignette with a transparent overlay (gradient would need LinearGradient)
  },

  // Back button
  backBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight ?? 0) + 12,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },

  // Oval face guide
  ovalGuideWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ovalGuide: {
    width: 220,
    height: 280,
    borderRadius: 110,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.6)',
    borderStyle: 'dashed',
  },
  ovalHint: {
    marginTop: 14,
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '500',
    letterSpacing: 0.5,
  },

  // Challenge box
  challengeBox: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(10,10,15,0.88)',
    paddingHorizontal: 24,
    paddingVertical: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    alignItems: 'center',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },

  // Liveness badges
  badgesRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  badge: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    minWidth: 70,
  },
  badgeDone: {
    borderColor: COLORS.success,
    backgroundColor: 'rgba(16,185,129,0.12)',
  },
  badgeActive: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(255,107,0,0.12)',
  },
  badgeIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  badgeLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  badgeLabelDone: {
    color: COLORS.success,
  },
  badgeLabelActive: {
    color: COLORS.primary,
  },

  // Challenge prompt
  challengePrompt: {
    fontSize: 16,
    color: COLORS.white,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  turnArrow: {
    fontSize: 36,
    color: COLORS.primary,
    fontWeight: '900',
  },

  // Processing banner
  processingBanner: {
    position: 'absolute',
    top: '45%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 30,
  },
  processingText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },

  // Result overlay
  resultOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  resultCard: {
    width: '100%',
    backgroundColor: COLORS.card,
    borderRadius: 24,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 10},
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  resultContent: {
    alignItems: 'center',
  },
  resultIcon: {
    fontSize: 56,
    marginBottom: 12,
  },
  resultTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.white,
    marginBottom: 8,
    textAlign: 'center',
  },
  resultSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
    paddingHorizontal: 8,
  },

  // Person card
  personCard: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  personAvatarBox: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    alignSelf: 'center',
  },
  personAvatar: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.white,
  },
  personInfo: {
    alignItems: 'center',
    marginBottom: 12,
  },
  personName: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  personDetail: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },

  // Confidence bar
  confContainer: {
    width: '100%',
  },
  confLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 6,
    textAlign: 'right',
  },
  confBar: {
    width: '100%',
    height: 6,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  confFill: {
    height: '100%',
    borderRadius: 3,
  },

  // Result action buttons
  resultActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  retryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  retryBtnText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 14,
  },
  homeBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  homeBtnText: {
    color: COLORS.textPrimary,
    fontWeight: '700',
    fontSize: 14,
  },

  // Centred helper views (permission denied / loading)
  centredView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  centredIcon: {
    fontSize: 60,
    marginBottom: 16,
  },
  centredTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: 10,
  },
  centredSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  loadingText: {
    marginTop: 18,
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
});

export default VerifyScreen;
