/**
 * LivenessService.js
 * NHAI Face Recognition System
 *
 * Anti-spoofing liveness detection using facial landmark geometry.
 * Three sequential challenges:
 *   1. Blink   — Eye Aspect Ratio (EAR) drops below threshold
 *   2. Smile   — Mouth Width / Face Width ratio exceeds threshold
 *   3. Head Turn — Nose tip displaced from face center
 *
 * State machine: IDLE → AWAIT_BLINK → AWAIT_SMILE → AWAIT_HEAD_TURN → PASSED | FAILED
 */

const EAR_BLINK_THRESHOLD = 0.22;
const EAR_BLINK_OPEN_THRESHOLD = 0.28;
const EAR_CONSECUTIVE_FRAMES = 2;
const SMILE_RATIO_THRESHOLD = 0.55;
const HEAD_TURN_OFFSET_RATIO = 0.12;
const LIVENESS_TIMEOUT_MS = 20000;
const CHALLENGE_TIMEOUT_MS = 7000;

export const LivenessState = Object.freeze({
  IDLE: 'IDLE',
  AWAIT_BLINK: 'AWAIT_BLINK',
  AWAIT_SMILE: 'AWAIT_SMILE',
  AWAIT_HEAD_TURN: 'AWAIT_HEAD_TURN',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
});

export const LivenessChallenge = Object.freeze({
  BLINK: 'BLINK',
  SMILE: 'SMILE',
  HEAD_TURN: 'HEAD_TURN',
});

// BlazeFace landmark indices
const LM = {
  RIGHT_EYE: 0,
  LEFT_EYE: 1,
  NOSE: 2,
  MOUTH: 3,
  RIGHT_EAR: 4,
  LEFT_EAR: 5,
};

class LivenessService {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = LivenessState.IDLE;
    this.currentChallenge = null;
    this.blinkCount = 0;
    this.consecutiveClosedFrames = 0;
    this.eyeWasOpen = true;
    this.smileDetected = false;
    this.headTurnDetected = false;
    this.headTurnDirection = null;
    this.frameHistory = [];
    this.challengeStartTime = null;
    this.sessionStartTime = null;
    this.listeners = [];
  }

  start() {
    this.reset();
    this.state = LivenessState.AWAIT_BLINK;
    this.currentChallenge = LivenessChallenge.BLINK;
    this.sessionStartTime = Date.now();
    this.challengeStartTime = Date.now();
    this.headTurnDirection = Math.random() > 0.5 ? 'LEFT' : 'RIGHT';
    console.log('[Liveness] Session started. Head turn direction:', this.headTurnDirection);
    this._emit();
    return this.currentChallenge;
  }

  processFrame(face) {
    if (this.state === LivenessState.PASSED || this.state === LivenessState.FAILED) {
      return this._status();
    }

    if (Date.now() - this.sessionStartTime > LIVENESS_TIMEOUT_MS) {
      console.warn('[Liveness] Session timeout');
      this.state = LivenessState.FAILED;
      this._emit();
      return this._status();
    }

    if (Date.now() - this.challengeStartTime > CHALLENGE_TIMEOUT_MS) {
      console.warn('[Liveness] Challenge timeout:', this.currentChallenge);
      this.state = LivenessState.FAILED;
      this._emit();
      return this._status();
    }

    if (!face || !face.landmarks) {
      return this._status();
    }

    const lm = face.landmarks;

    switch (this.state) {
      case LivenessState.AWAIT_BLINK:
        this._processBlink(lm, face);
        break;
      case LivenessState.AWAIT_SMILE:
        this._processSmile(lm, face);
        break;
      case LivenessState.AWAIT_HEAD_TURN:
        this._processHeadTurn(lm, face);
        break;
    }

    return this._status();
  }

  _processBlink(landmarks, face) {
    const ear = this._estimateEAR(landmarks, face);

    if (ear < EAR_BLINK_THRESHOLD) {
      this.consecutiveClosedFrames++;
      this.eyeWasOpen = false;
    } else if (ear > EAR_BLINK_OPEN_THRESHOLD) {
      if (!this.eyeWasOpen && this.consecutiveClosedFrames >= EAR_CONSECUTIVE_FRAMES) {
        this.blinkCount++;
        console.log('[Liveness] Blink detected! Count:', this.blinkCount);
        if (this.blinkCount >= 1) {
          this._advanceToSmile();
        }
      }
      this.consecutiveClosedFrames = 0;
      this.eyeWasOpen = true;
    }
  }

  _processSmile(landmarks, face) {
    if (this._detectSmile(landmarks, face)) {
      console.log('[Liveness] Smile detected!');
      this._advanceToHeadTurn();
    }
  }

  _processHeadTurn(landmarks, face) {
    if (this._detectHeadTurn(landmarks, face, this.headTurnDirection)) {
      console.log('[Liveness] Head turn detected:', this.headTurnDirection);
      this.state = LivenessState.PASSED;
      this._emit();
    }
  }

  _estimateEAR(landmarks, face) {
    const rightEye = landmarks[LM.RIGHT_EYE];
    const leftEye = landmarks[LM.LEFT_EYE];
    const nose = landmarks[LM.NOSE];

    const eyeMidY = (rightEye[1] + leftEye[1]) / 2;
    const eyeToNoseDist = Math.abs(nose[1] - eyeMidY);

    const [, topY] = face.topLeft;
    const [, botY] = face.bottomRight;
    const faceHeight = Math.max(1, botY - topY);

    return (eyeToNoseDist / faceHeight) * 1.2;
  }

  _detectSmile(landmarks, face) {
    const rightEar = landmarks[LM.RIGHT_EAR];
    const leftEar = landmarks[LM.LEFT_EAR];

    const faceWidth = Math.abs(leftEar[0] - rightEar[0]);
    const [, topY] = face.topLeft;
    const [, botY] = face.bottomRight;
    const faceHeight = Math.max(1, botY - topY);

    const ratio = faceWidth / faceHeight;
    return ratio > SMILE_RATIO_THRESHOLD;
  }

  _detectHeadTurn(landmarks, face, direction) {
    const nose = landmarks[LM.NOSE];
    const [leftX] = face.topLeft;
    const [rightX] = face.bottomRight;

    const faceCenterX = (leftX + rightX) / 2;
    const faceWidth = Math.max(1, rightX - leftX);
    const nosOffset = (nose[0] - faceCenterX) / faceWidth;

    if (direction === 'LEFT' && nosOffset < -HEAD_TURN_OFFSET_RATIO) return true;
    if (direction === 'RIGHT' && nosOffset > HEAD_TURN_OFFSET_RATIO) return true;
    return false;
  }

  _advanceToSmile() {
    this.state = LivenessState.AWAIT_SMILE;
    this.currentChallenge = LivenessChallenge.SMILE;
    this.challengeStartTime = Date.now();
    this._emit();
  }

  _advanceToHeadTurn() {
    this.state = LivenessState.AWAIT_HEAD_TURN;
    this.currentChallenge = LivenessChallenge.HEAD_TURN;
    this.challengeStartTime = Date.now();
    this._emit();
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  _emit() {
    const status = this._status();
    this.listeners.forEach((l) => l(status));
  }

  _status() {
    return {
      state: this.state,
      challenge: this.currentChallenge,
      headTurnDirection: this.headTurnDirection,
      progress: {
        blinkDone: this.blinkCount >= 1,
        smileDone: this.smileDetected,
        headTurnDone: this.headTurnDetected,
      },
      isPassed: this.state === LivenessState.PASSED,
      isFailed: this.state === LivenessState.FAILED,
    };
  }

  getChallengePrompt() {
    switch (this.state) {
      case LivenessState.IDLE:
        return 'Press Start to begin liveness check';
      case LivenessState.AWAIT_BLINK:
        return 'Please blink naturally';
      case LivenessState.AWAIT_SMILE:
        return 'Now smile for the camera 😊';
      case LivenessState.AWAIT_HEAD_TURN:
        return `Turn your head to the ${this.headTurnDirection}`;
      case LivenessState.PASSED:
        return 'Liveness check passed ✓';
      case LivenessState.FAILED:
        return 'Liveness check failed — please try again';
      default:
        return '';
    }
  }
}

export default new LivenessService();
export { EAR_BLINK_THRESHOLD, SMILE_RATIO_THRESHOLD, HEAD_TURN_OFFSET_RATIO };
