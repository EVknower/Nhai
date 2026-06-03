import React, {useState, useEffect, useCallback, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Animated,
  Alert,
  Platform,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import DatabaseService from '../services/DatabaseService';
import SyncService from '../services/SyncService';

// ── Color tokens ──────────────────────────────────────────────────────────────
const COLORS = {
  nhaiOrange: '#FF6B00',
  nhaiBlue:   '#003366',
  nhaiGold:   '#FFB800',
  background: '#F5F7FA',
  white:      '#FFFFFF',
  textPrimary:   '#1A1A2E',
  textSecondary: '#6B7280',
  success: '#10B981',
  danger:  '#EF4444',
  warning: '#F59E0B',
  cardBg:  '#FFFFFF',
  border:  '#E5E7EB',
};

const HEADER_GRADIENT = ['#003366', '#005299', '#0066CC'];

// ── StatCard sub-component ────────────────────────────────────────────────────
const StatCard = ({icon, value, label, valueColor = COLORS.nhaiBlue, loading}) => (
  <View style={styles.statCard}>
    <Text style={styles.statIcon}>{icon}</Text>
    {loading ? (
      <ActivityIndicator size="small" color={COLORS.nhaiOrange} style={styles.statLoader} />
    ) : (
      <Text style={[styles.statValue, {color: valueColor}]}>{value}</Text>
    )}
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

// ── HomeScreen ────────────────────────────────────────────────────────────────
const HomeScreen = ({navigation}) => {
  const [enrolledCount,  setEnrolledCount]  = useState(0);
  const [pendingSync,    setPendingSync]    = useState(0);
  const [isOnline,       setIsOnline]       = useState(false);
  const [isSyncing,      setIsSyncing]      = useState(false);
  const [lastSyncTime,   setLastSyncTime]   = useState(null);
  const [statsLoading,   setStatsLoading]   = useState(true);

  // Animations
  const fadeAnim    = useRef(new Animated.Value(0)).current;
  const pulseAnim   = useRef(new Animated.Value(1)).current;
  const pulseLoop   = useRef(null);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const formatSyncTime = (date) => {
    if (!date) return 'Never';
    const d = new Date(date);
    return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) +
           ' · ' + d.toLocaleDateString([], {day: '2-digit', month: 'short'});
  };

  // ── Pulse animation ────────────────────────────────────────────────────────
  const startPulse = useCallback(() => {
    pulseAnim.setValue(1);
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {toValue: 1.6, duration: 600, useNativeDriver: true}),
        Animated.timing(pulseAnim, {toValue: 1,   duration: 600, useNativeDriver: true}),
      ]),
    );
    pulseLoop.current.start();
  }, [pulseAnim]);

  const stopPulse = useCallback(() => {
    if (pulseLoop.current) {
      pulseLoop.current.stop();
      pulseLoop.current = null;
    }
    pulseAnim.setValue(1);
  }, [pulseAnim]);

  // ── Load stats ─────────────────────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const [embeddings, pending, online, lastSync] = await Promise.all([
        DatabaseService.getAllEmbeddings(),
        DatabaseService.getPendingSyncCount(),
        SyncService.isOnline(),
        SyncService.getLastSyncTime(),
      ]);
      setEnrolledCount(embeddings?.length ?? 0);
      setPendingSync(pending ?? 0);
      setIsOnline(!!online);
      setLastSyncTime(lastSync);
    } catch (err) {
      console.warn('[HomeScreen] loadStats error:', err);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // ── Handle sync now ────────────────────────────────────────────────────────
  const handleSyncNow = useCallback(async () => {
    if (!isOnline) {
      Alert.alert('Offline', 'No network connection. Sync will retry automatically when online.');
      return;
    }
    try {
      setIsSyncing(true);
      await SyncService.syncPendingRecords();
      await loadStats();
      Alert.alert('Sync Complete', 'All pending records have been uploaded.');
    } catch (err) {
      Alert.alert('Sync Failed', err?.message ?? 'Unknown error during sync.');
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, loadStats]);

  // ── Mount animation ────────────────────────────────────────────────────────
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // ── Pulse sync dot ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (isSyncing) {
      startPulse();
    } else {
      stopPulse();
    }
    return () => stopPulse();
  }, [isSyncing, startPulse, stopPulse]);

  // ── Focus listener → reload stats ─────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', loadStats);
    return unsubscribe;
  }, [navigation, loadStats]);

  // ── Connectivity badge ─────────────────────────────────────────────────────
  const badgeColor   = isSyncing ? COLORS.warning : isOnline ? COLORS.success : COLORS.danger;
  const badgeLabel   = isSyncing ? 'Syncing…'    : isOnline ? 'Online'       : 'Offline';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.nhaiBlue} />

      {/* ── Header ── */}
      <LinearGradient colors={HEADER_GRADIENT} style={styles.header}>
        {/* Branding row */}
        <View style={styles.brandRow}>
          <View style={styles.logoBox}>
            <Text style={styles.logoText}>NHAI</Text>
          </View>
          <View style={styles.brandText}>
            <Text style={styles.headerTitle}>Face Recognition</Text>
            <Text style={styles.headerSubtitle}>Access Control System</Text>
          </View>

          {/* Connectivity badge */}
          <View style={styles.badgeContainer}>
            <Animated.View
              style={[
                styles.badgeDot,
                {backgroundColor: badgeColor, transform: [{scale: pulseAnim}]},
              ]}
            />
            <Text style={styles.badgeLabel}>{badgeLabel}</Text>
          </View>
        </View>
      </LinearGradient>

      {/* ── Body ── */}
      <Animated.View style={[styles.body, {opacity: fadeAnim}]}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}>

          {/* Stat cards */}
          <View style={styles.statsRow}>
            <StatCard
              icon="👤"
              value={enrolledCount}
              label="Enrolled"
              valueColor={COLORS.nhaiBlue}
              loading={statsLoading}
            />
            <StatCard
              icon="⏳"
              value={pendingSync}
              label="Pending Sync"
              valueColor={pendingSync > 0 ? COLORS.nhaiOrange : COLORS.nhaiBlue}
              loading={statsLoading}
            />
          </View>

          {/* Primary action — Verify */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Verify')}
            style={styles.primaryBtnWrapper}>
            <LinearGradient
              colors={[COLORS.nhaiOrange, '#FF8C00']}
              start={{x: 0, y: 0}}
              end={{x: 1, y: 0}}
              style={styles.primaryBtn}>
              <Text style={styles.primaryBtnIcon}>🛡️</Text>
              <Text style={styles.primaryBtnText}>Verify Identity</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Secondary action — Enroll */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Enroll')}
            style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnIcon}>📋</Text>
            <Text style={styles.secondaryBtnText}>Admin Enroll</Text>
          </TouchableOpacity>

          {/* Info card */}
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Last Sync</Text>
              <Text style={styles.infoValue}>{formatSyncTime(lastSyncTime)}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Network</Text>
              <View style={styles.networkBadge}>
                <View style={[styles.networkDot, {backgroundColor: badgeColor}]} />
                <Text style={[styles.infoValue, {color: badgeColor}]}>{badgeLabel}</Text>
              </View>
            </View>

            {pendingSync > 0 && (
              <>
                <View style={styles.infoDivider} />
                {isSyncing ? (
                  <View style={styles.syncingRow}>
                    <ActivityIndicator size="small" color={COLORS.nhaiOrange} />
                    <Text style={styles.syncingText}>Syncing {pendingSync} record(s)…</Text>
                  </View>
                ) : (
                  <TouchableOpacity onPress={handleSyncNow} style={styles.syncRow}>
                    <Text style={styles.syncNowText}>
                      {pendingSync} record(s) pending  ·  Sync Now →
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

          {/* Version tag */}
          <Text style={styles.version}>
            NHAI Face Recognition v1.0 · Offline-First
          </Text>
        </ScrollView>
      </Animated.View>
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  // Header
  header: {
    paddingTop: Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight ?? 0) + 12,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: COLORS.nhaiGold,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  logoText: {
    fontSize: 13,
    fontWeight: '900',
    color: COLORS.nhaiBlue,
    letterSpacing: 1,
  },
  brandText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.white,
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  // Connectivity badge
  badgeContainer: {
    alignItems: 'center',
    gap: 4,
  },
  badgeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  badgeLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  // Body
  body: {
    flex: 1,
  },
  scroll: {
    padding: 20,
    paddingBottom: 40,
  },
  // Stat cards
  statsRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  statIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  statLoader: {
    marginVertical: 6,
  },
  statValue: {
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  // Primary button
  primaryBtnWrapper: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 14,
    shadowColor: COLORS.nhaiOrange,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 24,
    gap: 10,
  },
  primaryBtnIcon: {
    fontSize: 22,
  },
  primaryBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.white,
    letterSpacing: 0.4,
  },
  // Secondary button
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.nhaiBlue,
    backgroundColor: COLORS.white,
    marginBottom: 24,
    gap: 10,
  },
  secondaryBtnIcon: {
    fontSize: 20,
  },
  secondaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.nhaiBlue,
    letterSpacing: 0.3,
  },
  // Info card
  infoCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 6,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
  },
  infoLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 13,
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  networkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  infoDivider: {
    height: 1,
    backgroundColor: COLORS.border,
  },
  syncRow: {
    paddingVertical: 13,
    alignItems: 'center',
  },
  syncNowText: {
    fontSize: 13,
    color: COLORS.nhaiOrange,
    fontWeight: '700',
  },
  syncingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    gap: 10,
  },
  syncingText: {
    fontSize: 13,
    color: COLORS.nhaiOrange,
    fontWeight: '600',
  },
  // Version
  version: {
    textAlign: 'center',
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 0.3,
  },
});

export default HomeScreen;
