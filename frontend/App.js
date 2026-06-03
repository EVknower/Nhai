/**
 * App.js — NHAI Face Recognition System
 *
 * Root component:
 *  - Initializes TensorFlow.js backend
 *  - Initializes SQLite database
 *  - Starts SyncService
 *  - Sets up React Navigation stack
 *
 * Screens:
 *  Home    → Entry point, stats, navigation
 *  Verify  → Liveness + face recognition
 *  Enroll  → Admin PIN + face enrollment
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-react-native';
import { v4 as uuidv4 } from 'uuid';

import HomeScreen from './src/screens/HomeScreen';
import VerifyScreen from './src/screens/VerifyScreen';
import EnrollScreen from './src/screens/EnrollScreen';
import DatabaseService from './src/services/DatabaseService';
import SyncService from './src/services/SyncService';

// ─── Navigation Stack ─────────────────────────────────────────────────────────

const Stack = createStackNavigator();

// ─── App Component ────────────────────────────────────────────────────────────

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState(null);
  const [initStage, setInitStage] = useState('Starting...');

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // 1. Wait for TF.js backend to be ready
      setInitStage('Loading AI runtime...');
      await tf.ready();
      console.log('[App] TF.js backend ready:', tf.getBackend());

      // 2. Initialize SQLite database
      setInitStage('Opening database...');
      await DatabaseService.init();
      console.log('[App] Database initialized');

      // 3. Generate or retrieve stable device ID
      // In production, persist to AsyncStorage or SecureStore
      const deviceId = `NHAI-${uuidv4().slice(0, 8).toUpperCase()}`;

      // 4. Start sync service
      setInitStage('Starting sync service...');
      await SyncService.start(deviceId);
      console.log('[App] Sync service started');

      setIsReady(true);
    } catch (err) {
      console.error('[App] Initialization failed:', err);
      setInitError(err.message || 'Unknown initialization error');
    }
  };

  if (initError) {
    return <ErrorScreen error={initError} onRetry={initializeApp} />;
  }

  if (!isReady) {
    return <SplashScreen stage={initStage} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer>
          <StatusBar barStyle="light-content" backgroundColor="#003366" />
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerShown: false,
              cardStyle: { backgroundColor: '#F5F7FA' },
              // Smooth slide transition
              cardStyleInterpolator: ({ current, layouts }) => ({
                cardStyle: {
                  opacity: current.progress,
                  transform: [
                    {
                      translateX: current.progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [layouts.screen.width * 0.15, 0],
                      }),
                    },
                  ],
                },
              }),
            }}
          >
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Verify" component={VerifyScreen} />
            <Stack.Screen name="Enroll" component={EnrollScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// ─── Splash Screen ────────────────────────────────────────────────────────────

function SplashScreen({ stage }) {
  return (
    <View style={splash.container}>
      <StatusBar barStyle="light-content" backgroundColor="#003366" />
      <View style={splash.logoBox}>
        <Text style={splash.logoText}>NHAI</Text>
      </View>
      <Text style={splash.title}>Face Recognition System</Text>
      <Text style={splash.subtitle}>Access Control · Offline First</Text>
      <View style={splash.loaderRow}>
        <ActivityIndicator color="#FF6B00" size="small" />
        <Text style={splash.stage}>{stage}</Text>
      </View>
    </View>
  );
}

// ─── Error Screen ─────────────────────────────────────────────────────────────

function ErrorScreen({ error, onRetry }) {
  return (
    <View style={[splash.container, { justifyContent: 'center' }]}>
      <Text style={{ fontSize: 48, marginBottom: 16 }}>⚠️</Text>
      <Text style={[splash.title, { color: '#EF4444' }]}>Initialization Failed</Text>
      <Text style={[splash.subtitle, { color: 'rgba(255,255,255,0.6)', marginBottom: 24 }]}>{error}</Text>
      <View
        style={{
          backgroundColor: '#FF6B00',
          borderRadius: 12,
          paddingHorizontal: 28,
          paddingVertical: 14,
        }}
        onTouchEnd={onRetry}
      >
        <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 16 }}>Retry</Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const splash = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#003366',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  logoBox: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: '#FF6B00',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#FF6B00',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
  logoText: {
    color: '#FFF',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 2,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    marginTop: 6,
    marginBottom: 48,
    textAlign: 'center',
  },
  loaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  stage: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '500',
  },
});
