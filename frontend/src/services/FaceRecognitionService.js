/**
 * FaceRecognitionService.js
 * NHAI Face Recognition System
 *
 * On-device face recognition using:
 *  - BlazeFace for face detection / landmark extraction
 *  - MobileNet V1 (0.25x, 128px input) as a lightweight feature extractor
 *  - Cosine similarity for embedding comparison
 *
 * All ML runs on-device — zero cloud calls during verification.
 */

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-react-native';
import * as blazeface from '@tensorflow-models/blazeface';
import * as mobilenet from '@tensorflow-models/mobilenet';

const FACE_INPUT_SIZE = 128;
const MATCH_THRESHOLD = 0.85;
const MOBILENET_VERSION = 1;
const MOBILENET_ALPHA = 0.25;

class FaceRecognitionService {
  constructor() {
    this.blazefaceModel = null;
    this.mobileNetModel = null;
    this.isInitialized = false;
    this._initPromise = null;
  }

  async init() {
    if (this.isInitialized) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        console.log('[FaceRecog] Waiting for TF.js backend...');
        await tf.ready();
        console.log('[FaceRecog] TF.js backend:', tf.getBackend());

        console.log('[FaceRecog] Loading BlazeFace...');
        this.blazefaceModel = await blazeface.load({
          maxFaces: 1,
          inputWidth: 128,
          inputHeight: 128,
          iouThreshold: 0.3,
          scoreThreshold: 0.75,
        });

        console.log('[FaceRecog] Loading MobileNet...');
        this.mobileNetModel = await mobilenet.load({
          version: MOBILENET_VERSION,
          alpha: MOBILENET_ALPHA,
        });

        this.isInitialized = true;
        console.log('[FaceRecog] All models loaded successfully');
      } catch (err) {
        this._initPromise = null;
        console.error('[FaceRecog] Model load failed:', err);
        throw err;
      }
    })();

    return this._initPromise;
  }

  _assertInitialized() {
    if (!this.isInitialized) {
      throw new Error('FaceRecognitionService not initialized. Call init() first.');
    }
  }

  async detectFaces(imageTensor) {
    this._assertInitialized();
    return this.blazefaceModel.estimateFaces(imageTensor, false);
  }

  async hasSingleFace(imageTensor) {
    const faces = await this.detectFaces(imageTensor);
    return faces && faces.length === 1;
  }

  async extractEmbedding(imageTensor) {
    this._assertInitialized();

    const faces = await this.detectFaces(imageTensor);
    if (!faces || faces.length === 0) {
      console.warn('[FaceRecog] No face detected during embedding extraction');
      return null;
    }

    const face = faces[0];
    return tf.tidy(() => {
      const [imgH, imgW] = imageTensor.shape;

      const topLeft = face.topLeft;
      const bottomRight = face.bottomRight;

      const x1 = Math.max(0, topLeft[0] - imgW * 0.1);
      const y1 = Math.max(0, topLeft[1] - imgH * 0.1);
      const x2 = Math.min(imgW, bottomRight[0] + imgW * 0.1);
      const y2 = Math.min(imgH, bottomRight[1] + imgH * 0.1);

      const faceROI = tf.image.cropAndResize(
        imageTensor.expandDims(0),
        [[y1 / imgH, x1 / imgW, y2 / imgH, x2 / imgW]],
        [0],
        [FACE_INPUT_SIZE, FACE_INPUT_SIZE]
      ).squeeze([0]);

      const normalized = faceROI.div(127.5).sub(1.0);
      const activation = this.mobileNetModel.infer(normalized.expandDims(0), true);
      const pooled = activation.mean([1, 2]).squeeze();
      const l2Norm = pooled.norm();
      const embeddingTensor = pooled.div(l2Norm.add(1e-8));

      return embeddingTensor.dataSync();
    });
  }

  async extractAverageEmbedding(frameTensors) {
    this._assertInitialized();

    const embeddings = [];
    for (const frame of frameTensors) {
      const emb = await this.extractEmbedding(frame);
      if (emb) embeddings.push(emb);
    }

    if (embeddings.length === 0) return null;

    const size = embeddings[0].length;
    const avg = new Float32Array(size);
    for (const emb of embeddings) {
      for (let i = 0; i < size; i++) avg[i] += emb[i];
    }
    for (let i = 0; i < size; i++) avg[i] /= embeddings.length;

    return this._l2Normalize(avg);
  }

  cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) {
      throw new Error(`Embedding dimension mismatch: ${vecA.length} vs ${vecB.length}`);
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom < 1e-8 ? 0 : dot / denom;
  }

  findBestMatch(queryEmbedding, enrollments, threshold = MATCH_THRESHOLD) {
    if (!enrollments || enrollments.length === 0) return null;

    let bestScore = -1;
    let bestMatch = null;

    for (const enrollment of enrollments) {
      const score = this.cosineSimilarity(queryEmbedding, enrollment.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = enrollment;
      }
    }

    if (bestScore >= threshold) {
      console.log(`[FaceRecog] Match: ${bestMatch.name} (score: ${bestScore.toFixed(4)})`);
      return { match: bestMatch, confidence: bestScore };
    }

    console.log(`[FaceRecog] No match. Best score: ${bestScore.toFixed(4)} < threshold ${threshold}`);
    return null;
  }

  _l2Normalize(vec) {
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    const normalized = new Float32Array(vec.length);
    for (let i = 0; i < vec.length; i++) normalized[i] = vec[i] / (norm + 1e-8);
    return normalized;
  }

  frameToTensor(frame) {
    const { decodeJpeg } = require('@tensorflow/tfjs-react-native');
    const imageData = new Uint8Array(frame.toArrayBuffer ? frame.toArrayBuffer() : frame);
    return decodeJpeg(imageData, 3);
  }

  dispose() {
    if (this.blazefaceModel) {
      this.blazefaceModel.dispose?.();
      this.blazefaceModel = null;
    }
    if (this.mobileNetModel) {
      this.mobileNetModel.dispose?.();
      this.mobileNetModel = null;
    }
    this.isInitialized = false;
    this._initPromise = null;
    console.log('[FaceRecog] Disposed');
  }
}

export default new FaceRecognitionService();
export { MATCH_THRESHOLD, FACE_INPUT_SIZE };
