import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useConvex, useQuery, useQuery_experimental, useMutation, useAction } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { 
  Crown, 
  Castle, 
  Shield, 
  Users, 
  Wheat, 
  Coins, 
  Pickaxe, 
  TreePine, 
  Anvil, 
  Swords, 
  Target, 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  Heart, 
  Info, 
  AlertCircle, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp, 
  BookOpen, 
  Scroll,
  Activity,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  LogOut,
  UserCheck,
  Database,
  Check,
  Loader2,
  Award,
  Sun,
  ShieldAlert
} from 'lucide-react';
import { 
  calculateSimulatedKingdomResources, 
  VALID_FOOD_TIERS, 
  type ValidFoodTier 
} from '../convex/economyAdapter';
import { constructionProgress } from '../convex/buildingRules';
import { useConvexAuth, useAuthActions } from "@convex-dev/auth/react";
import { DEMO_USER_ID } from '../convex/kingdomAccess';
import { BUILDINGS, CIVILIZATIONS, DAILY_BONUS, PROFESSION_EFFECTS, REST_POLICIES } from '../convex/balanceConfig';
import { TabNavigation, type MainTab } from './components/TabNavigation';
import { FoundingWizard } from './components/FoundingWizard';
import { HomeScreen } from './components/HomeScreen';
import { RecoveryCodeCard, describeAuthError } from './components/AccessPanel';
import { ArmyPanel } from './components/ArmyPanel';
import { UniversityPanel } from './components/UniversityPanel';
import { ParliamentPanel } from './components/ParliamentPanel';
import { MapPanel } from './components/MapPanel';
import { MissionsPanel, MissionCelebrations } from './components/MissionsPanel';
import { formatCosts, formatRequirements } from './components/shared';

const CIVILIZATION_LABELS: Record<string, string> = Object.fromEntries(CIVILIZATIONS.map((c) => [c.id, c.label]));

/* ==========================================================================
   TIPOS DEL BACKEND CONVEX Y ESTADO DEL REINO
   ========================================================================== */
interface KingdomDoc {
  _id: string;
  name: string;
  civilization: string;
  castleName: string;
  monarchName?: string;
  happiness?: number;
  militaryMorale?: number;
  taxPolicy?: string;
  userId: string;
  foodTier?: string; // Régimen alimentario persistente oficial (P17 / B.8)
  taxRate?: number;
  honor?: number;
  glory?: number;
  lastDailyBonusAt?: number;
  homeTerritoryId?: string;
  pendingTerritoryClaims?: number;
  armyFatigue?: number;
  restPolicy?: string;
  formation?: Partial<Record<string, number>>;
  createdAt?: number;
  updatedAt?: number;
}

interface ResourcesDoc {
  _id: string;
  gold: number;
  wood: number;
  stone: number;
  iron: number;
  food: number;
  kingdomId: string;
  lastUpdated?: number;
  settlementInitialized?: boolean; // Marca de inicialización del motor autoritativo
}

interface PopulationDoc {
  _id: string;
  total: number;
  capacity?: number;
  available: number;
  starving?: boolean;
  kingdomId: string;
}

interface PopulationJob {
  _id?: string;
  jobType: 'agriculture' | 'mining' | 'construction' | 'military' | 'scholars' | string;
  assignedCount: number;
  kingdomId: string;
}

interface ArmyUnit {
  _id?: string;
  unitType: 'infanteria' | 'caballeria' | 'arqueria' | 'asedio' | string;
  count: number;
  kingdomId: string;
}

interface BuildingRecord {
  _id: string;
  kingdomId: string;
  buildingType: string;
  level: number;
}

interface ConstructionRecord {
  _id: string;
  buildingType?: string;
  targetLevel?: number;
  startedAt?: number;
  durationMs?: number;
  progressPercent: number | null;
}

interface ConstructionState {
  buildings: BuildingRecord[];
  residentialCapacity: number | null;
  constructionQueue: ConstructionRecord[];
  serverTimeMs: number;
  writable: boolean;
  availableBuildingTypes: string[];
  pendingBuildingTypes?: string[];
  pendingParameters?: readonly string[];
  catalog?: Record<string, {
    label: string;
    role?: string;
    costs: Record<string, number> | null;
    baseDurationMs: number | null;
    progressionRequirements: Record<string, number> | null;
    residentialCapacityPerLevel?: number | null;
    productiveWorkerCapacityPerLevel?: number | null;
    jobType?: string | null;
  }>;
  catalogForLevels?: Record<string, {
    label: string;
    role: string;
    currentLevel: number;
    nextLevel: number | null;
    nextCosts: Record<string, number> | null;
    nextDurationMs: number | null;
    requirements: Record<string, number>;
    requirementsSatisfied: boolean;
    castleCapSatisfied: boolean;
    residentialCapacityPerLevel: number;
    workerCapacityPerLevel: number;
    jobType: string | null;
  }>;
  buildingLevels?: Record<string, number>;
  jobCapacities?: Record<string, number> | null;
  constructionDurationModifier?: number;
  hasInitialBuildings?: boolean;
}

interface SettlementSummary {
  timestamp: number;
  foodDelta: number;
  foodResult: number;
  isStarving: boolean;
  starvationSeconds: number;
  starvationPhase: number;
  elapsedSeconds: number;
  appliedTier: string;
  dailyProduction: Record<string, number> | null;
  dailyFoodConsumption: number | null;
  dailyTaxIncome: number | null;
  taxesCollected: number;
  productivityMultiplier: number;
  population: { totalBefore: number; totalAfter: number; births: number; deaths: number; growthCappedByHousing: boolean; residentialCapacity: number | null } | null;
  happiness: number | null;
  militaryMorale: number | null;
  militaryDesertion: number;
  storageCapacity: number | null;
  wastedByStorage: Record<string, number> | null;
  professions: { woundedRecoveryBonus: number; happinessPerDay: number; foodConsumptionMultiplier: number; constructionDurationMultiplier: number; effectiveWorkers: Record<string, number> } | null;
  glory: { before: number; after: number; moraleBonus: number } | null;
  mercenaries: { count: number; salaryDue: number; salaryPaid: number; unpaid: boolean } | null;
  restPolicy: string;
}

const setRestPolicyMutation = makeFunctionReference<"mutation">("economy:setRestPolicy");

const getParliamentBadgeQuery = makeFunctionReference<"query">("parliament:getParliament");
const bootstrapInitialBuildingsMutation = makeFunctionReference<"mutation">("kingdoms:bootstrapInitialBuildings");
const ensureMyHomeTerritoryMutation = makeFunctionReference<"mutation">("territories:ensureMyHomeTerritory");

function hasConstructionTiming(
  construction: ConstructionRecord
): construction is ConstructionRecord & { startedAt: number; durationMs: number } {
  return typeof construction.startedAt === 'number' && typeof construction.durationMs === 'number';
}

interface KingdomFullResponse {
  kingdom?: KingdomDoc;
  resources?: ResourcesDoc;
  population?: PopulationDoc | null;
  populationJobs?: PopulationJob[];
  armyUnits?: ArmyUnit[];
  buildings?: BuildingRecord[];
  constructionQueue?: unknown[];
  technologies?: unknown[];
  season?: { id: string; label: string; progress: number; effectsEnabled: boolean };
}

const getKingdomFullQuery = makeFunctionReference<"query">("kingdoms:getKingdomFull");
const getViewerQuery = makeFunctionReference<"query">("kingdoms:getViewer");
const settleKingdomEconomyMutation = makeFunctionReference<"mutation">("economy:settleKingdomEconomy");
const setKingdomFoodTierMutation = makeFunctionReference<"mutation">("economy:setKingdomFoodTier");
const reassignPopulationJobMutation = makeFunctionReference<"mutation">("economy:reassignPopulationJob");
const getConstructionStateQuery = makeFunctionReference<"query">("kingdoms:getConstructionState");
const startConstructionMutation = makeFunctionReference<"mutation">("kingdoms:startConstruction");
const cancelConstructionMutation = makeFunctionReference<"mutation">("kingdoms:cancelConstruction");

/* ==========================================================================
   SESIÓN (sección 5 de CLAUDE.md): nombre del gobernante y cerrar sesión.
   El acceso (crear cuenta / entrar / invitado) vive en la pantalla de inicio.
   ========================================================================== */
const getRecoveryStatusQuery = makeFunctionReference<"query">("account:getRecoveryStatus");
const issueRecoveryCodeAction = makeFunctionReference<"action">("account:issueRecoveryCode");

function SessionControls() {
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();
  const viewer = useQuery(getViewerQuery) as { rulerName?: string | null } | null | undefined;
  const [busy, setBusy] = useState(false);
  if (!isAuthenticated) return null;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="hidden sm:inline-flex items-center gap-1.5 text-[#e6ded0] font-serif" title="Gobernante con sesión iniciada">
        <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
        {viewer?.rulerName ?? 'Gobernante'}
      </span>
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await signOut();
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="p-1.5 sm:px-2.5 sm:py-1.5 bg-[#1b1711] hover:bg-[#262017] border border-[#3b3121] rounded text-[#c5a059] hover:text-[#e8dfc8] transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
        title="Cerrar sesión en este dispositivo (tu reino sigue en el servidor)"
      >
        <LogOut className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Cerrar sesión</span>
      </button>
    </div>
  );
}

/**
 * Código de recuperación [DECISIÓN 21-10-2026]: se muestra UNA SOLA VEZ nada más crear la
 * cuenta. Mientras la cuenta no tenga código activo (recién creada), esta pantalla lo genera,
 * lo enseña y exige confirmar que se ha guardado antes de seguir.
 */
function RecoveryCodeGate(props: { children: React.ReactNode }) {
  const statusResult = useQuery_experimental({
    query: getRecoveryStatusQuery,
    args: {},
    throwOnError: false,
  });
  const status =
    statusResult.status === 'success'
      ? (statusResult.data as { hasActiveCode: boolean } | null)
      : statusResult.status === 'error'
        ? null
        : undefined;
  const issue = useAction(issueRecoveryCodeAction);
  const [code, setCode] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === undefined) {
    return (
      <div className="min-h-[300px] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[#d4af37] animate-spin" />
      </div>
    );
  }
  if (status === null || status.hasActiveCode || acknowledged) return <>{props.children}</>;

  return (
    <div className="max-w-md mx-auto bg-[#14120e] border-2 border-[#b8902a]/70 rounded-xl p-5 sm:p-6 shadow-2xl">
      {code ? (
        <RecoveryCodeCard
          code={code}
          title="Tu código de recuperación"
          intro="Cuenta creada. Este código sustituye al correo: con tu nombre de gobernante y este código podrás fijar una contraseña nueva si la olvidas."
          continueLabel="Continuar: elegir civilización"
          onContinue={() => setAcknowledged(true)}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-[#d4af37]" />
            <h3 className="text-base font-serif font-bold text-[#f4eedb]">Antes de seguir: tu código de recuperación</h3>
          </div>
          <p className="text-xs text-[#c5b7a0] leading-relaxed">
            No usamos correo electrónico. Para poder recuperar la cuenta si olvidas la contraseña, el servidor te entregará ahora un código que <strong>solo se muestra una vez</strong>.
          </p>
          {error && <p className="text-[11px] text-rose-400">{error}</p>}
          <button
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const result = (await issue({})) as { recoveryCode: string };
                setCode(result.recoveryCode);
              } catch (err) {
                setError(describeAuthError(err));
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="w-full py-3 rounded-md bg-gradient-to-b from-[#e2c25c] to-[#b8902a] text-[#1a1407] font-serif font-bold text-sm uppercase tracking-wider shadow-md disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Generar y mostrar mi código
          </button>
          <p className="text-[10px] text-[#6e6352] text-center">Genera tu código · gratis · inmediato · se muestra una sola vez y pasas a elegir civilización.</p>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   HOOK DEL ESTADO DE CONEXIÓN WEBSOCKET DE CONVEX
   ========================================================================== */
type ConnectionStatus = 'connected' | 'disconnected' | 'unavailable';

function useConvexConnectionState(): ConnectionStatus {
  const convex = useConvex();
  const [status, setStatus] = useState<ConnectionStatus>(() => {
    try {
      if (convex && typeof convex.connectionState === 'function') {
        const state = convex.connectionState();
        return state.isWebSocketConnected ? 'connected' : 'disconnected';
      }
      return 'unavailable';
    } catch {
      return 'unavailable';
    }
  });

  useEffect(() => {
    if (!convex || typeof convex.subscribeToConnectionState !== 'function') {
      setStatus('unavailable');
      return;
    }

    try {
      const current = convex.connectionState();
      setStatus(current.isWebSocketConnected ? 'connected' : 'disconnected');

      const unsubscribe = convex.subscribeToConnectionState((state) => {
        setStatus(state.isWebSocketConnected ? 'connected' : 'disconnected');
      });

      return () => {
        unsubscribe();
      };

    } catch {
      setStatus('unavailable');
    }
  }, [convex]);

  return status;
}

function ConnectionStatusBadge() {
  const status = useConvexConnectionState();

  if (status === 'connected') {
    return (
      <div 
        className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/40 border border-emerald-700/50 rounded text-emerald-400 text-xs"
        title="Canal WebSocket en tiempo real activo con el backend Convex"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <Wifi className="w-3.5 h-3.5" />
        <span className="font-medium tracking-wide">Conectado</span>
      </div>
    );
  }

  if (status === 'disconnected') {
    return (
      <div 
        className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-950/40 border border-rose-700/50 rounded text-rose-400 text-xs"
        title="Conexión WebSocket reconectando o desconectada"
      >
        <span className="inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
        <WifiOff className="w-3.5 h-3.5" />
        <span className="font-medium tracking-wide">Desconectado</span>
      </div>
    );
  }

  return (
    <div 
      className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-900 border border-neutral-700/50 rounded text-neutral-400 text-xs"
      title="Estado de conexión no disponible en el cliente"
    >
      <span className="inline-flex rounded-full h-2 w-2 bg-neutral-500"></span>
      <WifiOff className="w-3.5 h-3.5 opacity-60" />
      <span className="font-medium tracking-wide">No disponible</span>
    </div>
  );
}

/* ==========================================================================
   ERROR BOUNDARY PARA CONSULTAS REACTIVAS DE CONVEX
   ========================================================================== */
interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackUserId: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

class QueryErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const msg = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage: msg };
  }

  componentDidCatch(error: unknown) {
    console.error('Error en consulta reactiva de Convex:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-[#18130e] border border-rose-900/60 rounded-xl p-6 text-center max-w-xl mx-auto my-8 space-y-4">
          <AlertCircle className="w-10 h-10 text-rose-400 mx-auto" />
          <h2 className="text-lg font-serif font-bold text-rose-200">Error al consultar el reino</h2>
          <p className="text-xs text-neutral-300 leading-relaxed font-mono bg-neutral-950/80 p-3 rounded border border-rose-950">
            {this.state.errorMessage}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, errorMessage: null })}
            className="px-4 py-2 bg-[#2d2214] hover:bg-[#3d2f1b] border border-[#d4af37]/40 rounded text-[#d4af37] text-xs font-semibold uppercase tracking-wider"
          >
            Reintentar sincronización
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function formatSecondsDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0 s';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const remainingMins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${remainingMins}m`;
}

/* ==========================================================================
   PANTALLA PRINCIPAL: RESUMEN DEL REINO (JUEGO DE ESTRATEGIA MEDIEVAL)
   ========================================================================== */
function KingdomOverviewContent() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  // Consulta autoritativa OIDC de Convex en tiempo real
  const viewer = useQuery(getViewerQuery);
  const activeUserId = isAuthenticated && viewer ? (viewer.userId ?? viewer.subject.split('|')[0]) : null;

  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<MainTab>('aldea');
  const [bootstrapBusy, setBootstrapBusy] = useState<string | null>(null);
  const [bootstrapMessage, setBootstrapMessage] = useState<string | null>(null);

  // Estados para proyección puramente local en el cliente (sin escrituras en BD)
  const [clientTime, setClientTime] = useState<number>(() => Date.now());
  const [selectedFoodTier, setSelectedFoodTier] = useState<ValidFoodTier>('normal');
  const [showProjectionDetails, setShowProjectionDetails] = useState<boolean>(true);

  // Reloj local del cliente: actualiza el tiempo de referencia periódicamente sin recrear suscripciones Convex
  useEffect(() => {
    const timer = setInterval(() => {
      setClientTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Consulta reactiva en tiempo real al backend remoto
  const kingdomData = useQuery(
    getKingdomFullQuery,
    activeUserId ? { userId: activeUserId } : "skip"
  ) as KingdomFullResponse | undefined | null;

  const kingdom = kingdomData?.kingdom;
  const resources = kingdomData?.resources;
  const population = kingdomData?.population;
  const populationJobs = kingdomData?.populationJobs;
  const armyUnits = kingdomData?.armyUnits;
  const buildings = kingdomData?.buildings ?? [];
  const constructionState = useQuery(
    getConstructionStateQuery,
    kingdom ? { kingdomId: kingdom._id as any } : "skip"
  ) as ConstructionState | undefined;
  const parliamentBadge = useQuery(
    getParliamentBadgeQuery,
    kingdom ? { kingdomId: kingdom._id as any } : "skip"
  ) as { badgeCount: number } | undefined;

  // Mutaciones autoritativas del Bloque B.8
  const settleKingdomEconomy = useMutation(settleKingdomEconomyMutation);
  const setKingdomFoodTier = useMutation(setKingdomFoodTierMutation);
  const reassignPopulationJob = useMutation(reassignPopulationJobMutation);
  const cancelConstruction = useMutation(cancelConstructionMutation);
  const startConstruction = useMutation(startConstructionMutation);
  const bootstrapInitialBuildings = useMutation(bootstrapInitialBuildingsMutation);
  const ensureMyHomeTerritory = useMutation(ensureMyHomeTerritoryMutation);

  // Verificación estricta de titularidad en el servidor (P1)
  const isOwner = Boolean(
    isAuthenticated &&
    viewer &&
    kingdom &&
    ((viewer.userId ?? viewer.subject.split('|')[0]) === kingdom.userId.split('|')[0])
  );
  const activeOwnerKey = isOwner && viewer && kingdom
    ? `${viewer.subject}:${kingdom._id}`
    : null;
  const activeOwnerKeyRef = useRef<string | null>(activeOwnerKey);
  activeOwnerKeyRef.current = activeOwnerKey;

  useEffect(() => {
    if (constructionState) {
      setConstructionClockAnchor({
        serverTimeMs: constructionState.serverTimeMs,
        clientTimeMs: Date.now(),
      });
    }
  }, [constructionState?.serverTimeMs]);

  // Estados del selector persistente de régimen (P17 / B.8)
  const [tierSaveStatus, setTierSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [tierErrorMessage, setTierErrorMessage] = useState<string | null>(null);

  // Estados de liquidación autoritativa en Convex
  const [isSettling, setIsSettling] = useState<boolean>(false);
  const [restPolicySaving, setRestPolicySaving] = useState<boolean>(false);
  const [restPolicyError, setRestPolicyError] = useState<string | null>(null);
  const setRestPolicy = useMutation(setRestPolicyMutation);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [savingWorkerJob, setSavingWorkerJob] = useState<string | null>(null);
  const [workerSaveError, setWorkerSaveError] = useState<string | null>(null);
  const [workerSaveMessage, setWorkerSaveMessage] = useState<string | null>(null);
  const [cancellingConstruction, setCancellingConstruction] = useState<string | null>(null);
  const [startingConstruction, setStartingConstruction] = useState<string | null>(null);
  const [constructionError, setConstructionError] = useState<string | null>(null);
  const [constructionMessage, setConstructionMessage] = useState<string | null>(null);
  const [constructionClockAnchor, setConstructionClockAnchor] = useState<{
    serverTimeMs: number;
    clientTimeMs: number;
  } | null>(null);
  const [lastSettlement, setLastSettlement] = useState<SettlementSummary | null>(null);
  const tierSavedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Control para liquidación automática en primer arranque sin bucles infinitos
  const hasAutoSettledRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    setTierSaveStatus('idle');
    setTierErrorMessage(null);
    setSettleError(null);
    setIsSettling(false);
    setLastSettlement(null);
    setSavingWorkerJob(null);
    setWorkerSaveError(null);
    setWorkerSaveMessage(null);
    hasAutoSettledRef.current = {};
    if (tierSavedTimeoutRef.current) clearTimeout(tierSavedTimeoutRef.current);
    tierSavedTimeoutRef.current = null;
  }, [activeOwnerKey]);

  useEffect(() => () => {
    if (tierSavedTimeoutRef.current) clearTimeout(tierSavedTimeoutRef.current);
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
  }, []);

  // Carga inicial del régimen desde kingdom.foodTier con fallback a 'normal' (Requisito 2 / Test 35)
  useEffect(() => {
    if (kingdom) {
      const persistedTier = kingdom.foodTier;
      if (persistedTier && (persistedTier === 'minima' || persistedTier === 'normal' || persistedTier === 'abundante' || persistedTier === 'excelente')) {
        setSelectedFoodTier(persistedTier as ValidFoodTier);
      } else {
        setSelectedFoodTier('normal');
      }
    }
  }, [kingdom?._id, kingdom?.foodTier]);

  // Manejador del cambio de régimen alimentario con transición en servidor
  const handleFoodTierChange = async (tier: ValidFoodTier) => {
    if (tier === selectedFoodTier && tierSaveStatus !== 'error') return;

    if (!isOwner) {
      // Modo demo o visitante: modificación puramente local en memoria para explorar la proyección
      setSelectedFoodTier(tier);
      setTierSaveStatus('idle');
      setTierErrorMessage(null);
      return;
    }

    // Reino propio verificado: mutación persistente en Convex
    const requestOwnerKey = activeOwnerKey;
    setTierSaveStatus('saving');
    setTierErrorMessage(null);
    try {
      const res = await setKingdomFoodTier({
        kingdomId: kingdom!._id,
        foodTier: tier,
      });
      if (activeOwnerKeyRef.current !== requestOwnerKey) return;
      if (res && res.success) {
        setSelectedFoodTier(tier);
        setTierSaveStatus('saved');
        setTierErrorMessage(null);
        if (tierSavedTimeoutRef.current) clearTimeout(tierSavedTimeoutRef.current);
        tierSavedTimeoutRef.current = setTimeout(() => {
          setTierSaveStatus(prev => prev === 'saved' ? 'idle' : prev);
        }, 3000);
      } else {
        throw new Error((res as any)?.error || 'Fallo de respuesta al actualizar régimen.');
      }
    } catch (err: any) {
      if (activeOwnerKeyRef.current !== requestOwnerKey) return;
      // Revertir selector al valor oficial confirmado por el servidor (Test 37)
      const confirmedTier = (kingdom?.foodTier as ValidFoodTier) || 'normal';
      setSelectedFoodTier(confirmedTier);
      setTierSaveStatus('error');
      setTierErrorMessage(err?.message || 'Error al persistir el régimen en el servidor Convex.');
    }
  };

  // Manejador de liquidación autoritativa (Requisito 3)
  // [M-04] Política de descanso del Castillo (P15, P55)
  const handleRestPolicyChange = async (restPolicy: string) => {
    if (!isOwner || !kingdom || restPolicy === (kingdom.restPolicy ?? 'normal')) return;
    setRestPolicySaving(true);
    setRestPolicyError(null);
    try {
      await setRestPolicy({ kingdomId: kingdom._id, restPolicy });
    } catch (err: any) {
      setRestPolicyError(err?.message || 'No se pudo cambiar la política de descanso.');
    } finally {
      setRestPolicySaving(false);
    }
  };

  const handleSettleEconomy = async () => {
    if (!isOwner || !kingdom) return;

    const requestOwnerKey = activeOwnerKey;
    setIsSettling(true);
    setSettleError(null);
    try {
      const res = await settleKingdomEconomy({
        kingdomId: kingdom._id,
      });
      if (activeOwnerKeyRef.current !== requestOwnerKey) return;
      if (res && res.success) {
        setLastSettlement({
          timestamp: res.lastUpdated || Date.now(),
          foodDelta: res.foodDelta ?? 0,
          foodResult: res.resources?.food ?? 0,
          isStarving: Boolean(res.isStarving),
          starvationSeconds: res.starvationSeconds ?? 0,
          starvationPhase: res.starvationPhase ?? 0,
          elapsedSeconds: res.elapsedSeconds ?? 0,
          appliedTier: res.appliedFoodTier ?? selectedFoodTier,
          dailyProduction: res.dailyProduction ?? null,
          dailyFoodConsumption: res.dailyFoodConsumption ?? null,
          dailyTaxIncome: res.dailyTaxIncome ?? null,
          taxesCollected: res.taxesCollected ?? 0,
          productivityMultiplier: res.productivityMultiplier ?? 1,
          population: res.population ?? null,
          happiness: typeof res.happiness === 'number' ? res.happiness : null,
          militaryMorale: typeof res.militaryMorale === 'number' ? res.militaryMorale : null,
          militaryDesertion: res.militaryDesertion ?? 0,
          storageCapacity: typeof res.storageCapacity === 'number' ? res.storageCapacity : null,
          wastedByStorage: res.wastedByStorage ?? null,
          professions: res.professions ?? null,
          glory: res.glory ?? null,
          mercenaries: res.mercenaries ?? null,
          restPolicy: res.restPolicy ?? 'normal',
        });
        setSettleError(null);
      } else {
        throw new Error((res as any)?.error || 'Error al procesar la liquidación en Convex.');
      }
    } catch (err: any) {
      if (activeOwnerKeyRef.current !== requestOwnerKey) return;
      setSettleError(err?.message || 'Error de conexión o autorización al liquidar economía.');
    } finally {
      if (activeOwnerKeyRef.current === requestOwnerKey) setIsSettling(false);
    }
  };

  const handleWorkerReassignment = async (
    event: React.FormEvent<HTMLFormElement>,
    jobType: string
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!isOwner || !kingdom) return;

    const rawAssignedCount = new FormData(form).get('assignedCount');
    const assignedCount = typeof rawAssignedCount === 'string' ? Number(rawAssignedCount) : NaN;
    if (!Number.isInteger(assignedCount) || assignedCount < 0) {
      setWorkerSaveError('La asignación debe ser un entero no negativo.');
      form.reset();
      return;
    }

    const requestOwnerKey = activeOwnerKey;
    setSavingWorkerJob(jobType);
    setWorkerSaveError(null);
    setWorkerSaveMessage(null);
    try {
      const result = await reassignPopulationJob({
        kingdomId: kingdom._id,
        jobType,
        assignedCount,
      });
      if (activeOwnerKeyRef.current !== requestOwnerKey) return;
      if (!result?.success) {
        throw new Error('El servidor no confirmó la reasignación.');
      }
      setWorkerSaveMessage(
        `${result.assignedCount} asignados a ${jobLabels[jobType]?.label ?? jobType}; ${result.available} disponibles.`
      );
      form.reset();
    } catch (err: unknown) {
      if (activeOwnerKeyRef.current !== requestOwnerKey) return;
      setWorkerSaveError(
        err instanceof Error ? err.message : 'Error de conexión o autorización al reasignar trabajadores.'
      );
      form.reset();
    } finally {
      if (activeOwnerKeyRef.current === requestOwnerKey) setSavingWorkerJob(null);
    }
  };

  const handleConstructionCancellation = async (construction: ConstructionRecord) => {
    if (!isOwner || !kingdom || !window.confirm(
      `¿Cancelar ${construction.buildingType} nivel ${construction.targetLevel}? El servidor devolverá el 50 % de los costes registrados.`
    )) return;

    setCancellingConstruction(construction._id);
    setConstructionError(null);
    setConstructionMessage(null);
    try {
      const result = await cancelConstruction({
        kingdomId: kingdom._id,
        constructionId: construction._id,
      });
      if (!result?.success) throw new Error("El servidor no confirmó la cancelación.");
      setConstructionMessage("Construcción cancelada; se aplicó el reembolso confirmado por Convex.");
    } catch (error) {
      setConstructionError(error instanceof Error ? error.message : "No se pudo cancelar la construcción.");
    } finally {
      setCancellingConstruction(null);
    }
  };

  const handleConstructionStart = async (buildingType: string) => {
    if (!isOwner || !kingdom) return;
    const requestOwnerKey = activeOwnerKey;
    setStartingConstruction(buildingType);
    setConstructionError(null);
    setConstructionMessage(null);
    try {
      const result = await startConstruction({ kingdomId: kingdom._id, buildingType });
      if (activeOwnerKeyRef.current !== requestOwnerKey) return;
      if (!result?.success) throw new Error("Convex no confirmó el inicio de construcción.");
      setConstructionMessage(`${result.buildingType}, nivel ${result.targetLevel}, añadido a la cola del servidor.`);
    } catch (error) {
      if (activeOwnerKeyRef.current !== requestOwnerKey) return;
      setConstructionError(error instanceof Error ? error.message : "No se pudo iniciar la construcción.");
    } finally {
      if (activeOwnerKeyRef.current === requestOwnerKey) setStartingConstruction(null);
    }
  };

  const handleBootstrapBuildings = async () => {
    if (!isOwner || !kingdom) return;
    setBootstrapBusy('buildings');
    setBootstrapMessage(null);
    try {
      const result = await bootstrapInitialBuildings({ kingdomId: kingdom._id });
      setBootstrapMessage(result.inserted
        ? `Edificios fundacionales recibidos: ${Object.entries(result.levels).map(([type, level]) => `${type} ${level}`).join(', ')}.`
        : 'El reino ya tenía edificios; no se añadió nada.');
    } catch (error) {
      setBootstrapMessage(error instanceof Error ? error.message : 'No se pudieron asignar los edificios fundacionales.');
    } finally {
      setBootstrapBusy(null);
    }
  };

  const handleEnsureHomeTerritory = async () => {
    if (!isOwner || !kingdom) return;
    setBootstrapBusy('territory');
    setBootstrapMessage(null);
    try {
      const result = await ensureMyHomeTerritory({ kingdomId: kingdom._id });
      setBootstrapMessage(result.success ? `Territorio principal asignado en la celda ${result.homeTerritoryId}.` : 'No quedan celdas libres en el mapa.');
    } catch (error) {
      setBootstrapMessage(error instanceof Error ? error.message : 'No se pudo asignar el territorio principal.');
    } finally {
      setBootstrapBusy(null);
    }
  };

  // Liquidación automática al cargar el reino propio por primera vez en la sesión (sin bucles)
  useEffect(() => {
    const settlementKey = activeOwnerKey;
    if (isOwner && kingdom && settlementKey && !hasAutoSettledRef.current[settlementKey]) {
      hasAutoSettledRef.current[settlementKey] = true;
      handleSettleEconomy();
    }
  }, [isOwner, kingdom?._id, viewer?.subject]);

  // Cálculo de la proyección analítica continua mediante el adaptador puro (solo lectura)
  // Se invoca incondicionalmente para cumplir con las Reglas de Hooks de React
  const simulationResult = useMemo(() => {
    if (!kingdom || !resources || !population) return null;

    return calculateSimulatedKingdomResources({
      kingdom,
      resources: {
        ...resources,
        lastUpdated: typeof resources.lastUpdated === 'number' ? resources.lastUpdated : -1,
      },
      population,
      populationJobs: populationJobs ?? [],
      armyUnits: armyUnits ?? [],
      buildings,
      foodTier: selectedFoodTier,
      targetTime: clientTime,
      callerUserId: activeUserId,
    });
  }, [kingdom, resources, population, populationJobs, armyUnits, buildings, selectedFoodTier, clientTime, activeUserId]);

  const foodDelta = simulationResult?.success && simulationResult.simulatedResources && resources
    ? simulationResult.simulatedResources.food - resources.food
    : 0;

  const dailySurplus = simulationResult?.productionAndConsumption?.dailyFoodNetSurplus ?? 0;
  const constructionDisplayServerTime = constructionClockAnchor
    ? constructionClockAnchor.serverTimeMs + (clientTime - constructionClockAnchor.clientTimeMs)
    : constructionState?.serverTimeMs ?? clientTime;

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      setIsRefreshing(false);
    }, 600);
  };

  // 1. Si el usuario no está autenticado, mostrar pantalla de inicio / bienvenida (P4)
  if (!isAuthenticated) {
    return (
      <HomeScreen />
    );
  }

  // 2. Estado de carga inicial (consultando sesión o reino en Convex)
  if (isLoading || viewer === undefined || (activeUserId && kingdomData === undefined)) {
    return (
      <div className="min-h-[500px] flex flex-col items-center justify-center p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full border-2 border-[#d4af37]/20 border-t-[#d4af37] animate-spin flex items-center justify-center">
          <Crown className="w-5 h-5 text-[#d4af37]" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-serif font-semibold text-[#f4eedb]">Convocando los registros de la corona...</h2>
          <p className="text-xs text-[#8e816d]">Recuperando estado autoritativo desde el backend de Convex</p>
        </div>
      </div>
    );
  }

  // 3. Si el usuario autenticado aún no tiene un reino propio: código de recuperación (una vez) y asistente de fundación (P4-P9, paso 2)
  if (!kingdom) {
    return (
      <RecoveryCodeGate>
        <div className="space-y-4">
          <div className="text-center text-xs text-[#8e816d]">
            {viewer ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 font-serif">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Gobernante: {viewer.rulerName ?? viewer.name ?? 'sesión iniciada'}</span>
              </span>
            ) : (
              <div className="max-w-md mx-auto space-y-2">
                <div className="p-3 bg-amber-950/40 border border-amber-600/40 rounded-lg text-amber-200 text-xs text-left">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                    <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span>Sesión en espera de validación por el servidor</span>
                  </div>
                  <p className="mt-1 text-[11px] text-amber-300/80 leading-relaxed">
                    El servidor aún no ha confirmado tu sesión. Si persiste, cierra sesión y vuelve a entrar.
                  </p>
                </div>
              </div>
            )}
          </div>
          <FoundingWizard defaultMonarchName={viewer?.rulerName ?? ''} onFounded={() => setActiveTab('aldea')} />
        </div>
      </RecoveryCodeGate>
    );
  }

  // Cálculos demográficos confirmados
  const totalPop = population?.total ?? null;
  const capacityPop = constructionState?.residentialCapacity ?? population?.capacity ?? null;
  const availablePop = population?.available ?? null;
  const isStarving = population?.starving;

  // Cálculos de ejército confirmados
  const totalTroops = armyUnits ? armyUnits.reduce((acc, u) => acc + (u.count || 0), 0) : null;
  const totalAssignedWorkers = populationJobs?.reduce(
    (total, job) => total + job.assignedCount,
    0
  ) ?? null;

  // Etiquetas legibles de oficios
  const jobCapacity = (job: string): string => {
    const capacity = constructionState?.jobCapacities?.[job as keyof NonNullable<typeof constructionState.jobCapacities>];
    return typeof capacity === 'number' ? `capacidad de edificios: ${capacity.toLocaleString('es-ES')}` : 'capacidad sin dato';
  };
  const jobLabels: Record<string, { label: string; color: string; desc: string }> = {
    agriculture: { label: 'Agricultura', color: 'bg-emerald-500', desc: `2 alimentos por agricultor y día · ${jobCapacity('agriculture')}` },
    wood: { label: 'Aserradero (madera)', color: 'bg-lime-700', desc: `1 madera por trabajador y día · ${jobCapacity('wood')}` },
    stone: { label: 'Cantería (piedra)', color: 'bg-stone-500', desc: `0,75 piedra por trabajador y día · ${jobCapacity('stone')}` },
    iron: { label: 'Minería de hierro', color: 'bg-amber-600', desc: `0,40 hierro por trabajador y día · ${jobCapacity('iron')}` },
    gold: { label: 'Minería de oro', color: 'bg-yellow-500', desc: `0,20 oro por trabajador y día · ${jobCapacity('gold')}` },
    medicine: { label: 'Medicina (Hospital militar)', color: 'bg-teal-500', desc: PROFESSION_EFFECTS.medicine.description },
    religion: { label: 'Religión (Iglesia)', color: 'bg-indigo-400', desc: PROFESSION_EFFECTS.religion.description },
    entertainment: { label: 'Circo y feria', color: 'bg-pink-500', desc: PROFESSION_EFFECTS.entertainment.description },
    bakery: { label: 'Panadería', color: 'bg-orange-400', desc: PROFESSION_EFFECTS.bakery.description },
    construction: { label: 'Construcción y obras', color: 'bg-amber-800', desc: PROFESSION_EFFECTS.construction.description },
    mining: { label: 'Minería (heredado)', color: 'bg-neutral-500', desc: 'Oficio heredado sin efecto: reasigna a hierro, piedra u oro' },
    military: { label: 'Guarnición (heredado)', color: 'bg-neutral-500', desc: 'Oficio heredado sin efecto: las tropas se entrenan en el Cuartel' },
    scholars: { label: 'Eruditos (heredado)', color: 'bg-neutral-500', desc: 'Oficio heredado sin efecto: la investigación se hace en la Universidad' },
  };
  const persistedJobTypes = new Set((populationJobs ?? []).map(job => job.jobType.trim().toLowerCase()));
  const visibleJobTypes = Object.keys(jobLabels).filter(jobType =>
    !['mining', 'military', 'scholars'].includes(jobType) || persistedJobTypes.has(jobType)
  );

  // Etiquetas legibles de edificios (del catálogo servido)
  const buildingLabels: Record<string, string> = Object.fromEntries(
    Object.entries(constructionState?.catalog ?? {}).map(([type, rule]) => [type, rule.label])
  );

  // Etiquetas legibles de unidades militares
  const unitLabels: Record<string, { label: string; icon: React.ReactNode; desc: string }> = {
    infanteria: { label: 'Infantería Regular', icon: <Swords className="w-4 h-4 text-rose-400" />, desc: 'Tropas de línea cuerpo a cuerpo con escudo' },
    caballeria: { label: 'Caballería de Choque', icon: <Target className="w-4 h-4 text-amber-400" />, desc: 'Jinetes rápidos con lanza y armadura' },
    arqueria: { label: 'Cuerpo de Arquería', icon: <Shield className="w-4 h-4 text-emerald-400" />, desc: 'Tiradores de proyectiles para defensa y asedio' },
    asedio: { label: 'Máquinas de Asedio', icon: <Castle className="w-4 h-4 text-purple-400" />, desc: 'Catapultas y arietes pesados' },
  };

  return (
    <div className="space-y-6">
      {/* Indicador de estado de sesión / Demo */}

      {/* ====================================================================
          1. CABECERA HERÁLDICA DEL REINO (ESTRATEGIA MEDIEVAL)
          ==================================================================== */}
      <section className="bg-gradient-to-b from-[#19150f] to-[#12100c] border border-[#382f20] rounded-xl p-5 md:p-6 shadow-xl relative overflow-hidden">
        {/* Adorno heráldico de fondo */}
        <div className="absolute right-0 top-0 w-80 h-full opacity-5 pointer-events-none flex items-center justify-end pr-4">
          <Castle className="w-72 h-72 text-[#d4af37]" />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex items-start sm:items-center gap-4">
            <div className="p-3 bg-[#241c12] border border-[#d4af37]/40 rounded-lg text-[#d4af37] shadow-inner flex-shrink-0">
              <Crown className="w-8 h-8" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#a3947e] font-serif uppercase tracking-widest mb-1">
                <span>Civilización {CIVILIZATION_LABELS[kingdom.civilization] ?? kingdom.civilization ?? 'sin asignar'}</span>
                <span aria-hidden="true" className="text-[#594d3c]">•</span>
                <span className="text-[#d4af37] font-semibold">{kingdom.castleName}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-[#f7f2e4] font-serif tracking-wide drop-shadow-sm">
                {kingdom.name}
              </h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#8e816d] mt-1.5">
                {kingdom.monarchName && (
                  <span>Soberano: <strong className="text-[#e2d7c0] font-normal">{kingdom.monarchName}</strong></span>
                )}
                {kingdom.taxPolicy && (
                  <>
                    <span aria-hidden="true" className="text-[#453d30]">•</span>
                    <span>Impuestos: <span className="text-[#c7beac] capitalize">{kingdom.taxPolicy}</span></span>
                  </>
                )}
                {kingdomData?.season && (
                  <>
                    <span aria-hidden="true" className="text-[#453d30]">•</span>
                    <span className="inline-flex items-center gap-1" title={kingdomData.season.effectsEnabled ? 'Estación con efectos activos' : 'Estación informativa (P3): sin efectos hasta aprobar sus modificadores'}>
                      <Sun className="w-3 h-3 text-amber-300" />
                      {kingdomData.season.label} ({Math.round(kingdomData.season.progress * 100)} %){kingdomData.season.effectsEnabled ? '' : ' · sin efectos'}
                    </span>
                  </>
                )}
                <span aria-hidden="true" className="text-[#453d30]">•</span>
                <span className="font-mono text-[11px] text-[#695d4b]">ID: {kingdom.userId}</span>
              </div>
            </div>
          </div>

          {/* Medidores de Estado: Felicidad y Moral */}
          <div className="grid grid-cols-2 sm:flex sm:items-center gap-3 pt-3 md:pt-0 border-t md:border-t-0 border-[#262017]">
            <div className="bg-[#16130e] border border-[#2d251a] rounded-lg px-3.5 py-2.5 flex items-center gap-3">
              <div className="p-2 bg-emerald-950/50 rounded text-emerald-400">
                <Heart className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] text-[#8e816d] uppercase tracking-wider block font-medium">Bienestar</span>
                <span className="text-base font-bold text-emerald-400 font-serif">
                  {typeof kingdom.happiness === 'number' ? `${kingdom.happiness}%` : 'No disponible'}
                </span>
              </div>
            </div>
            <div className="bg-[#16130e] border border-[#2d251a] rounded-lg px-3.5 py-2.5 flex items-center gap-3">
              <div className="p-2 bg-rose-950/50 rounded text-rose-400">
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] text-[#8e816d] uppercase tracking-wider block font-medium">Moral Marcial</span>
                <span className="text-base font-bold text-rose-400 font-serif">
                  {typeof kingdom.militaryMorale === 'number' ? `${kingdom.militaryMorale}%` : 'No disponible'}
                </span>
              </div>
            </div>
            <div className="bg-[#16130e] border border-[#2d251a] rounded-lg px-3.5 py-2.5 flex items-center gap-3">
              <div className="p-2 bg-amber-950/50 rounded text-[#d4af37]">
                <Award className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] text-[#8e816d] uppercase tracking-wider block font-medium">Honor</span>
                <span className="text-base font-bold text-[#d4af37] font-serif">{(kingdom.honor ?? 0).toLocaleString('es-ES')}</span>
              </div>
            </div>
            <div className="bg-[#16130e] border border-[#2d251a] rounded-lg px-3.5 py-2.5 flex items-center gap-3">
              <div className="p-2 bg-sky-950/50 rounded text-sky-300">
                <Scroll className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] text-[#8e816d] uppercase tracking-wider block font-medium">Gloria</span>
                <span className="text-base font-bold text-sky-300 font-serif">{(kingdom.glory ?? 0).toLocaleString('es-ES', { maximumFractionDigits: 1 })}</span>
                <span className="text-[10px] text-[#695d4c] block">decae 1/día · +1 moral por cada 10</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <TabNavigation active={activeTab} onChange={setActiveTab} parliamentBadge={parliamentBadge?.badgeCount ?? 0} />
      <MissionCelebrations kingdomId={kingdom._id} enabled={isOwner} />

      {activeTab === 'ejercito' && (
        <ArmyPanel kingdomId={kingdom._id} isOwner={isOwner} buildingLabels={buildingLabels} />
      )}
      {activeTab === 'universidad' && (
        <UniversityPanel kingdomId={kingdom._id} isOwner={isOwner} buildingLabels={buildingLabels} buildingLevels={constructionState?.buildingLevels} />
      )}
      {activeTab === 'parlamento' && (
        <ParliamentPanel
          kingdomId={kingdom._id}
          isOwner={isOwner}
          kingdomName={kingdom.name}
          taxRate={typeof kingdom.taxRate === 'number' ? kingdom.taxRate : null}
          lastDailyBonusAt={typeof kingdom.lastDailyBonusAt === 'number' ? kingdom.lastDailyBonusAt : null}
          dailyBonusCooldownMs={DAILY_BONUS.COOLDOWN_MS}
          dailyBonusHonor={DAILY_BONUS.HONOR}
        />
      )}
      {activeTab === 'mapa' && (
        <MapPanel kingdomId={kingdom._id} isOwner={isOwner} homeTerritoryId={kingdom.homeTerritoryId ?? null} />
      )}

      {activeTab === 'aldea' && (<>
      <MissionsPanel kingdomId={kingdom._id} isOwner={isOwner} />
      {/* ====================================================================
          2. PANEL DE RECURSOS DEL REINO (5 RECURSOS PRIMARIOS)
          ==================================================================== */}
      <section className="bg-[#14110d] border border-[#2b2419] rounded-xl p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#241e15] pb-3">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-[#d4af37]" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-serif font-bold uppercase tracking-wider text-[#e6ded0]">
                  Tesoro y Almacenes Reales
                </h2>
                <span className="text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-2 py-0.5 rounded font-mono">
                  Persistido en Convex
                </span>
              </div>
              <p className="text-[11px] text-[#736754] mt-0.5">
                Último registro oficial en base de datos: {resources?.lastUpdated ? new Date(resources.lastUpdated).toLocaleString('es-ES') : 'Inicial'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isOwner ? (
              <button
                type="button"
                onClick={handleSettleEconomy}
                disabled={isSettling}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#261d12] hover:bg-[#382b1a] border border-[#d4af37]/50 hover:border-[#d4af37] rounded text-[#d4af37] text-xs font-serif font-semibold transition-all shadow-md disabled:opacity-50"
                title="Liquidar autoritativamente el tiempo transcurrido en el servidor Convex"
              >
                {isSettling ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Liquidando...</span>
                  </>
                ) : (
                  <>
                    <Database className="w-3.5 h-3.5" />
                    <span>Liquidar Economía</span>
                  </>
                )}
              </button>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#1a150e] border border-amber-900/40 rounded text-[11px] text-amber-400/80 font-mono">
                <Info className="w-3.5 h-3.5" />
                <span>Modo Consulta (Iberia protegido)</span>
              </div>
            )}
          </div>
        </div>

        {/* Notificación de última liquidación en el servidor */}
        {lastSettlement && (
          <div className="bg-[#12100d] border border-emerald-900/40 rounded-lg p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <div>
                <span className="font-semibold text-emerald-300">Liquidación asentada en Convex:</span>
                <span className="text-[#a09480] ml-1.5 font-mono">
                  {new Date(lastSettlement.timestamp).toLocaleTimeString('es-ES')}
                </span>
                <span className="text-[11px] text-[#8e816d] block sm:inline sm:ml-2">
                  (Variación: {lastSettlement.foodDelta >= 0 ? `+${lastSettlement.foodDelta.toFixed(1)}` : lastSettlement.foodDelta.toFixed(1)} raciones en {formatSecondsDuration(lastSettlement.elapsedSeconds)} | Régimen: {lastSettlement.appliedTier})
                </span>
              </div>
            </div>
            {lastSettlement.isStarving ? (
              <span className="text-rose-400 bg-rose-950/60 border border-rose-800/60 px-2 py-0.5 rounded font-mono text-[10px]">
                Inanición fase {lastSettlement.starvationPhase}
              </span>
            ) : (
              <span className="text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded font-mono text-[10px]">
                Suministro Regular
              </span>
            )}
          </div>
        )}
        {lastSettlement?.dailyProduction && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <div className="bg-[#12100d] border border-[#241e15] rounded-lg p-2.5 space-y-0.5">
              <span className="text-[#8e816d] uppercase tracking-wider text-[10px] block">Producción diaria (servidor)</span>
              <span className="text-[#c7beac] block">Oro +{lastSettlement.dailyProduction.gold.toFixed(1)} · Madera +{lastSettlement.dailyProduction.wood.toFixed(1)}</span>
              <span className="text-[#c7beac] block">Piedra +{lastSettlement.dailyProduction.stone.toFixed(1)} · Hierro +{lastSettlement.dailyProduction.iron.toFixed(1)}</span>
              <span className="text-[#c7beac] block">Alimentos +{lastSettlement.dailyProduction.food.toFixed(1)} · consumo −{(lastSettlement.dailyFoodConsumption ?? 0).toFixed(1)}</span>
            </div>
            <div className="bg-[#12100d] border border-[#241e15] rounded-lg p-2.5 space-y-0.5">
              <span className="text-[#8e816d] uppercase tracking-wider text-[10px] block">Impuestos y productividad</span>
              <span className="text-[#c7beac] block">Tasa {Math.round((kingdom.taxRate ?? 0.1) * 100)} % · +{(lastSettlement.dailyTaxIncome ?? 0).toFixed(1)} oro/día</span>
              <span className="text-[#c7beac] block">Recaudado en el intervalo: {lastSettlement.taxesCollected.toFixed(1)} oro</span>
              <span className="text-[#c7beac] block">Productividad ×{lastSettlement.productivityMultiplier.toFixed(2)}</span>
            </div>
            <div className="bg-[#12100d] border border-[#241e15] rounded-lg p-2.5 space-y-0.5">
              <span className="text-[#8e816d] uppercase tracking-wider text-[10px] block">Población (P12, P16)</span>
              {lastSettlement.population ? (
                <>
                  <span className="text-[#c7beac] block">{lastSettlement.population.totalBefore.toLocaleString('es-ES')} → {lastSettlement.population.totalAfter.toLocaleString('es-ES')} habitantes</span>
                  <span className="text-[#c7beac] block">Nacimientos +{lastSettlement.population.births} · pérdidas −{lastSettlement.population.deaths}</span>
                  <span className={lastSettlement.population.growthCappedByHousing ? 'text-amber-300 block' : 'text-[#c7beac] block'}>
                    {lastSettlement.population.growthCappedByHousing ? 'Crecimiento limitado por viviendas' : 'Crecimiento del 30 % anual activo'}
                  </span>
                </>
              ) : <span className="text-[#8e816d]">Sin datos en esta liquidación</span>}
            </div>
            <div className="bg-[#12100d] border border-[#241e15] rounded-lg p-2.5 space-y-0.5">
              <span className="text-[#8e816d] uppercase tracking-wider text-[10px] block">Bienestar</span>
              <span className="text-[#c7beac] block">Felicidad {lastSettlement.happiness ?? '—'} · moral militar {lastSettlement.militaryMorale ?? '—'}</span>
              <span className="text-[#c7beac] block">Inanición acumulada: {formatSecondsDuration(lastSettlement.starvationSeconds)} (fase {lastSettlement.starvationPhase})</span>
              {lastSettlement.militaryDesertion > 0 && <span className="text-rose-300 block">Deserción militar: {lastSettlement.militaryDesertion}</span>}
              {lastSettlement.glory && (
                <span className="text-[#c7beac] block">Gloria {lastSettlement.glory.after.toFixed(1)} (+{lastSettlement.glory.moraleBonus} moral)</span>
              )}
            </div>
            <div className="bg-[#12100d] border border-[#241e15] rounded-lg p-2.5 space-y-0.5">
              <span className="text-[#8e816d] uppercase tracking-wider text-[10px] block">Almacén y descanso</span>
              <span className="text-[#c7beac] block">Tope de almacén: {lastSettlement.storageCapacity !== null ? lastSettlement.storageCapacity.toLocaleString('es-ES') : '—'} por recurso</span>
              {lastSettlement.wastedByStorage && Object.values(lastSettlement.wastedByStorage).some((v) => v > 0) ? (
                <span className="text-amber-300 block">
                  Producción perdida por el tope: {Object.entries(lastSettlement.wastedByStorage).filter(([, v]) => v > 0).map(([r, v]) => `${v.toFixed(1)} ${r}`).join(', ')}
                </span>
              ) : (
                <span className="text-[#8e816d] block">Sin pérdidas por almacén</span>
              )}
              <span className="text-[#c7beac] block">Descanso: {REST_POLICIES[lastSettlement.restPolicy as keyof typeof REST_POLICIES]?.label ?? lastSettlement.restPolicy}</span>
            </div>
            <div className="bg-[#12100d] border border-[#241e15] rounded-lg p-2.5 space-y-0.5">
              <span className="text-[#8e816d] uppercase tracking-wider text-[10px] block">Profesiones (P13)</span>
              {lastSettlement.professions ? (
                <>
                  <span className="text-[#c7beac] block">Recuperación de heridos +{Math.round(lastSettlement.professions.woundedRecoveryBonus * 100)} pp · felicidad +{lastSettlement.professions.happinessPerDay}/día</span>
                  <span className="text-[#c7beac] block">Consumo de alimentos ×{lastSettlement.professions.foodConsumptionMultiplier.toFixed(2)} · obras ×{lastSettlement.professions.constructionDurationMultiplier.toFixed(2)}</span>
                </>
              ) : <span className="text-[#8e816d]">Sin datos</span>}
            </div>
            <div className="bg-[#12100d] border border-[#241e15] rounded-lg p-2.5 space-y-0.5">
              <span className="text-[#8e816d] uppercase tracking-wider text-[10px] block">Mercenarios (P53)</span>
              {lastSettlement.mercenaries && lastSettlement.mercenaries.count > 0 ? (
                <>
                  <span className="text-[#c7beac] block">{lastSettlement.mercenaries.count} contratados · pagados al contratar, sin salario diario</span>
                </>
              ) : <span className="text-[#8e816d]">Sin mercenarios contratados</span>}
            </div>
          </div>
        )}

        {/* Notificación de error en liquidación */}
        {settleError && (
          <div className="bg-rose-950/40 border border-rose-900 rounded-lg p-3 text-xs text-rose-300 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{settleError}</span>
            </div>
            <button
              type="button"
              onClick={handleSettleEconomy}
              className="px-2.5 py-1 bg-rose-900/60 hover:bg-rose-800/70 rounded border border-rose-700 text-rose-200 text-[11px]"
            >
              Reintentar
            </button>
          </div>
        )}

        {resources ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {/* Oro */}
            <div className="bg-[#1a1610] border border-[#3b3121] hover:border-[#d4af37]/40 transition-colors rounded-lg p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-[#9c8e76] font-medium uppercase tracking-wider">Oro</span>
                <div className="p-1.5 rounded bg-amber-500/10 text-amber-400">
                  <Coins className="w-4 h-4" />
                </div>
              </div>
              <span className="text-xl sm:text-2xl font-bold text-amber-300 font-serif tracking-tight">
                {resources.gold?.toLocaleString('es-ES') ?? '0'}
              </span>
              <span className="text-[10px] text-[#6b604e] mt-1">Moneda del tesoro</span>
            </div>

            {/* Madera */}
            <div className="bg-[#1a1610] border border-[#3b3121] hover:border-[#a16207]/40 transition-colors rounded-lg p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-[#9c8e76] font-medium uppercase tracking-wider">Madera</span>
                <div className="p-1.5 rounded bg-amber-700/10 text-amber-600">
                  <TreePine className="w-4 h-4" />
                </div>
              </div>
              <span className="text-xl sm:text-2xl font-bold text-[#e0a96d] font-serif tracking-tight">
                {resources.wood?.toLocaleString('es-ES') ?? '0'}
              </span>
              <span className="text-[10px] text-[#6b604e] mt-1">Tala y carpintería</span>
            </div>

            {/* Piedra */}
            <div className="bg-[#1a1610] border border-[#3b3121] hover:border-slate-500/40 transition-colors rounded-lg p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-[#9c8e76] font-medium uppercase tracking-wider">Piedra</span>
                <div className="p-1.5 rounded bg-slate-500/10 text-slate-300">
                  <Pickaxe className="w-4 h-4" />
                </div>
              </div>
              <span className="text-xl sm:text-2xl font-bold text-slate-200 font-serif tracking-tight">
                {resources.stone?.toLocaleString('es-ES') ?? '0'}
              </span>
              <span className="text-[10px] text-[#6b604e] mt-1">Sillares de cantera</span>
            </div>

            {/* Hierro */}
            <div className="bg-[#1a1610] border border-[#3b3121] hover:border-zinc-400/40 transition-colors rounded-lg p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-[#9c8e76] font-medium uppercase tracking-wider">Hierro</span>
                <div className="p-1.5 rounded bg-zinc-500/10 text-zinc-300">
                  <Anvil className="w-4 h-4" />
                </div>
              </div>
              <span className="text-xl sm:text-2xl font-bold text-zinc-200 font-serif tracking-tight">
                {resources.iron?.toLocaleString('es-ES') ?? '0'}
              </span>
              <span className="text-[10px] text-[#6b604e] mt-1">Metal para forja</span>
            </div>

            {/* Alimentos */}
            <div className="col-span-2 sm:col-span-1 bg-[#1a1610] border border-[#3b3121] hover:border-emerald-600/40 transition-colors rounded-lg p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-[#9c8e76] font-medium uppercase tracking-wider">Alimentos</span>
                <div className="p-1.5 rounded bg-emerald-500/10 text-emerald-400">
                  <Wheat className="w-4 h-4" />
                </div>
              </div>
              <span className="text-xl sm:text-2xl font-bold text-emerald-400 font-serif tracking-tight">
                {resources.food?.toLocaleString('es-ES') ?? '0'}
              </span>
              <span className="text-[10px] text-[#6b604e] mt-1">Grano y sustento</span>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-[#18140f] border border-neutral-800 rounded text-xs text-neutral-400">
            Recursos no disponibles en la consulta del reino.
          </div>
        )}
      </section>

      {/* ====================================================================
          2.B. PROYECCIÓN LOCAL ESTIMADA (MOTOR ECONÓMICO P2 / P17 / P18)
          ==================================================================== */}
      <section className="bg-gradient-to-b from-[#18140f] to-[#12100c] border border-[#3d3221] rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
        {/* Cabecera del bloque */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#2b2317] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#d4af37]/10 border border-[#d4af37]/30 text-[#d4af37]">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-serif font-bold uppercase tracking-wider text-[#f0e8d8]">
                  Proyección local estimada
                </h2>
                <span className="text-[10px] text-amber-400 bg-amber-950/40 border border-amber-800/50 px-2 py-0.5 rounded font-mono">
                  Solo Lectura — P2 Continuo
                </span>
              </div>
              <p className="text-[11px] text-[#8e816d] mt-0.5">
                Estimación en memoria basada en el último registro oficial ({resources?.lastUpdated ? new Date(resources.lastUpdated).toLocaleTimeString('es-ES') : 'N/D'})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#100e0b] border border-[#2e261a] rounded text-[#a69882] font-mono text-[11px]">
              <Clock className="w-3.5 h-3.5 text-[#d4af37]" />
              <span>+{simulationResult?.success ? formatSecondsDuration(simulationResult.elapsedSeconds ?? 0) : '0 s'}</span>
            </div>
            <button
              onClick={() => setShowProjectionDetails(prev => !prev)}
              className="p-1 bg-[#1a150e] hover:bg-[#261f15] border border-[#3b301f] rounded text-[#a69882] hover:text-[#e8dfc8] transition-colors"
              title={showProjectionDetails ? 'Ocultar detalles' : 'Mostrar detalles'}
            >
              {showProjectionDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Panel de configuración de régimen alimentario persistente */}
        <div className="bg-[#100e0b] border border-[#292116] rounded-lg p-3 sm:p-3.5 space-y-3 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[#a0937e] font-medium flex items-center gap-1.5">
                  <Wheat className="w-3.5 h-3.5 text-emerald-400" />
                  Régimen alimentario de la Corona (P17):
                </span>
                {tierSaveStatus === 'saving' && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-[#d4af37] bg-amber-950/40 border border-amber-800/40 px-1.5 py-0.5 rounded font-mono">
                    <Loader2 className="w-3 h-3 animate-spin" /> Guardando en Convex...
                  </span>
                )}
                {tierSaveStatus === 'saved' && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-1.5 py-0.5 rounded font-mono">
                    <CheckCircle2 className="w-3 h-3" /> Guardado oficial
                  </span>
                )}
                {tierSaveStatus === 'error' && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-rose-400 bg-rose-950/40 border border-rose-800/40 px-1.5 py-0.5 rounded font-mono">
                    <AlertCircle className="w-3 h-3" /> Error al guardar
                  </span>
                )}
              </div>
              <p className="text-[10px] text-[#6b604e]">
                {isOwner
                  ? "Parámetro persistido en la base de datos de Convex mediante la mutación autoritativa 'setKingdomFoodTier'."
                  : "Modo Demostración: modificación provisional en memoria (el Reino de Iberia permanece inalterado)."}
              </p>
              {tierErrorMessage && (
                <p className="text-[11px] text-rose-400 font-mono">
                  {tierErrorMessage}
                </p>
              )}
            </div>

            {/* Selector de régimen P17 */}
            <div className="flex flex-wrap items-center gap-1.5">
              {VALID_FOOD_TIERS.map((tier) => {
                const tierLabels: Record<string, string> = {
                  minima: 'Mínima (x0,75)',
                  normal: 'Normal (x1,00)',
                  abundante: 'Abundante (x1,10)',
                  excelente: 'Excelente (x1,20)',
                };
                const isSelected = selectedFoodTier === tier;
                return (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => handleFoodTierChange(tier)}
                    disabled={tierSaveStatus === 'saving'}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all ${
                      isSelected
                        ? 'bg-[#d4af37] text-neutral-950 font-semibold shadow-sm'
                        : 'bg-[#1b1610] text-[#a0937e] hover:bg-[#251f16] border border-[#362b1c]'
                    } disabled:opacity-60`}
                  >
                    {tierLabels[tier] ?? tier}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-[#211a12] pt-2">
            <span className="text-[11px] text-[#8e816d]">
              Regla D-12: las máquinas de asedio no consumen raciones; sus 5 operadores por pieza sí (factor 1,05 de P18).
            </span>
            <span className="text-[10px] text-[#615545] font-mono">
              P2: 86.400 s/año
            </span>
          </div>
        </div>

        {/* [M-04] Política de descanso del Castillo (P15, P55) */}
        <div className="bg-[#100e0b] border border-[#292116] rounded-lg p-3 sm:p-3.5 space-y-2 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-[#e6ded0] block">Política de descanso del Castillo (P15, P55)</span>
              <span className="text-[11px] text-[#8e816d]">
                Vigente: {REST_POLICIES[(kingdom.restPolicy ?? 'normal') as keyof typeof REST_POLICIES]?.label ?? kingdom.restPolicy}. Afecta a la producción, la felicidad y la fatiga del ejército en cada liquidación.
              </span>
            </div>
            {restPolicySaving && <span className="text-[11px] text-amber-300">Guardando…</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {Object.entries(REST_POLICIES).map(([id, policy]) => {
              const active = (kingdom.restPolicy ?? 'normal') === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={!isOwner || restPolicySaving}
                  onClick={() => handleRestPolicyChange(id)}
                  className={`rounded border px-2.5 py-2 text-left transition-colors ${active ? 'border-[#d4af37] bg-[#241a10] text-[#f4eedb]' : 'border-[#362b1c] bg-[#1b1610] text-[#a0937e] hover:bg-[#251f16]'} disabled:opacity-60`}
                >
                  <span className="font-semibold block">{policy.label}</span>
                  <span className="text-[10px] text-[#8e816d] block">{policy.description}</span>
                </button>
              );
            })}
          </div>
          {restPolicyError && <p role="alert" className="text-[11px] text-rose-400">{restPolicyError}</p>}
          {!isOwner && <p className="text-[10px] text-[#615545]">Consulta de solo lectura: la política no puede cambiarse en el reino demo.</p>}
        </div>

        {/* Validación y Renderizado de Resultados */}
        {simulationResult && !simulationResult.success ? (
          <div className="bg-rose-950/30 border border-rose-800/60 rounded-lg p-4 text-xs text-rose-300 space-y-1">
            <div className="flex items-center gap-2 font-semibold text-rose-200">
              <AlertCircle className="w-4 h-4 text-rose-400" />
              <span>Validación de Proyección Fallida</span>
            </div>
            <p className="text-rose-300/90 font-mono text-[11px] pl-6">
              {simulationResult.error}
            </p>
            <p className="text-[10px] text-rose-400/70 pl-6">
              El motor se detiene por seguridad sin inventar valores ficticios.
            </p>
          </div>
        ) : simulationResult?.simulatedResources ? (
          <div className="space-y-3">
            {/* Existencias proyectadas */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* Oro proyectado */}
              <div className="bg-[#120f0b] border border-[#2b2214] rounded-lg p-2.5">
                <span className="text-[10px] text-[#80725d] uppercase tracking-wider block">Oro Proyectado</span>
                <span className="text-lg font-bold text-amber-200/90 font-serif">
                  {simulationResult.simulatedResources.gold.toLocaleString('es-ES')}
                </span>
                <span className="text-[10px] text-[#5e5343] block mt-0.5">{lastSettlement?.dailyProduction ? `+${lastSettlement.dailyProduction.gold.toFixed(1)}/día + impuestos (servidor)` : 'Se liquida en el servidor'}</span>
              </div>

              {/* Madera proyectada */}
              <div className="bg-[#120f0b] border border-[#2b2214] rounded-lg p-2.5">
                <span className="text-[10px] text-[#80725d] uppercase tracking-wider block">Madera Proyectada</span>
                <span className="text-lg font-bold text-[#e0a96d]/90 font-serif">
                  {simulationResult.simulatedResources.wood.toLocaleString('es-ES')}
                </span>
                <span className="text-[10px] text-[#5e5343] block mt-0.5">{lastSettlement?.dailyProduction ? `+${lastSettlement.dailyProduction.wood.toFixed(1)}/día (servidor)` : 'Se liquida en el servidor'}</span>
              </div>

              {/* Piedra proyectada */}
              <div className="bg-[#120f0b] border border-[#2b2214] rounded-lg p-2.5">
                <span className="text-[10px] text-[#80725d] uppercase tracking-wider block">Piedra Proyectada</span>
                <span className="text-lg font-bold text-slate-300/90 font-serif">
                  {simulationResult.simulatedResources.stone.toLocaleString('es-ES')}
                </span>
                <span className="text-[10px] text-[#5e5343] block mt-0.5">{lastSettlement?.dailyProduction ? `+${lastSettlement.dailyProduction.stone.toFixed(1)}/día (servidor)` : 'Se liquida en el servidor'}</span>
              </div>

              {/* Hierro proyectado */}
              <div className="bg-[#120f0b] border border-[#2b2214] rounded-lg p-2.5">
                <span className="text-[10px] text-[#80725d] uppercase tracking-wider block">Hierro Proyectado</span>
                <span className="text-lg font-bold text-zinc-300/90 font-serif">
                  {simulationResult.simulatedResources.iron.toLocaleString('es-ES')}
                </span>
                <span className="text-[10px] text-[#5e5343] block mt-0.5">{lastSettlement?.dailyProduction ? `+${lastSettlement.dailyProduction.iron.toFixed(1)}/día (servidor)` : 'Se liquida en el servidor'}</span>
              </div>

              {/* Alimentos proyectados con indicador dinámico de delta */}
              <div className={`col-span-2 sm:col-span-1 bg-[#120f0b] border rounded-lg p-2.5 transition-colors ${
                simulationResult.exhaustionMetrics?.isStarving
                  ? 'border-rose-700/60 bg-rose-950/20'
                  : 'border-emerald-700/40'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#80725d] uppercase tracking-wider">Alimentos Proyectados</span>
                  {foodDelta !== 0 && (
                    <span className={`text-[10px] font-mono px-1 rounded ${
                      foodDelta > 0 ? 'text-emerald-400 bg-emerald-950/50' : 'text-rose-400 bg-rose-950/50'
                    }`}>
                      {foodDelta > 0 ? `+${foodDelta.toFixed(1)}` : foodDelta.toFixed(1)}
                    </span>
                  )}
                </div>
                <span className={`text-lg font-bold font-serif ${
                  simulationResult.exhaustionMetrics?.isStarving ? 'text-rose-400' : 'text-emerald-300'
                }`}>
                  {simulationResult.simulatedResources.food.toLocaleString('es-ES', { maximumFractionDigits: 1 })}
                </span>
                <span className="text-[10px] text-[#6b604e] block mt-0.5">
                  Base servidor: {resources?.food ?? 0}
                </span>
              </div>
            </div>

            {/* Métricas analíticas del motor económico */}
            {showProjectionDetails && simulationResult.productionAndConsumption && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                {/* Producción diaria */}
                <div className="bg-[#100e0b] border border-[#261e13] rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between text-xs text-[#a0937e]">
                    <span className="flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                      Producción agrícola:
                    </span>
                    <span className="font-mono text-emerald-400 font-semibold">
                      +{simulationResult.productionAndConsumption.dailyFoodProduction.toLocaleString('es-ES')} / d
                    </span>
                  </div>
                  <p className="text-[10px] text-[#635745]">
                    {`${populationJobs?.find(j => j.jobType === 'agriculture')?.assignedCount ?? 0} agricultores asignados · capacidad de granjas: ${constructionState?.jobCapacities?.agriculture ?? 'sin dato'} (2 raciones/d por agricultor efectivo).`}
                  </p>
                </div>

                {/* Consumo diario */}
                <div className="bg-[#100e0b] border border-[#261e13] rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between text-xs text-[#a0937e]">
                    <span className="flex items-center gap-1.5">
                      <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
                      Consumo de raciones:
                    </span>
                    <span className="font-mono text-amber-300 font-semibold">
                      -{simulationResult.productionAndConsumption.dailyFoodConsumption.toLocaleString('es-ES', { maximumFractionDigits: 1 })} / d
                    </span>
                  </div>
                  <p className="text-[10px] text-[#635745]">
                    Población civil + {simulationResult.militaryClassification?.regularSoldiers ?? 0} personas militares (x1,05 P18; incluye operadores de asedio y heridos)
                  </p>
                </div>

                {/* Balance neto y estado de inanición */}
                <div className="bg-[#100e0b] border border-[#261e13] rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#a0937e]">Balance neto diario:</span>
                    <span className={`font-mono font-semibold ${
                      dailySurplus >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {dailySurplus >= 0 ? `+${dailySurplus.toFixed(1)}` : dailySurplus.toFixed(1)} / d
                    </span>
                  </div>
                  {simulationResult.exhaustionMetrics?.isStarving ? (
                    <div className="text-[10px] text-rose-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-rose-400" />
                      <span>Inanición analítica: reservas agotadas (tiempo sin comida: {formatSecondsDuration(simulationResult.exhaustionMetrics.starvationSeconds)})</span>
                    </div>
                  ) : simulationResult.exhaustionMetrics?.secondsToExhaustion != null ? (
                    <div className="text-[10px] text-amber-400 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-amber-400" />
                      <span>Agotamiento en {formatSecondsDuration(simulationResult.exhaustionMetrics.secondsToExhaustion)}</span>
                    </div>
                  ) : (
                    <p className="text-[10px] text-emerald-400/80">
                      Superávit sostenible (+{((dailySurplus / (simulationResult.productionAndConsumption.dailyFoodConsumption || 1)) * 100).toFixed(1)}% margen)
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Nota legal / informativa de anti-autoridad */}
        <div className="text-[10px] text-[#6b5f4c] border-t border-[#211a12] pt-2.5 flex items-center justify-between">
          <span>
            ℹ Proyección estrictamente estimativa en cliente. No modifica la base de datos de Convex ni autoriza transacciones.
          </span>
          <span className="font-mono text-[#524838]">
            Motor: P2/P17/P18
          </span>
        </div>
      </section>

      {/* ====================================================================
          3. PANELES CENTRALES: DEMOGRAFÍA & EJÉRCITO (RESPONSIVE 2 COLUMNAS)
          ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* PANEL DE POBLACIÓN (6 col) */}
        <section className="lg:col-span-6 bg-[#14110d] border border-[#2b2419] rounded-xl p-5 shadow-sm space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#241e15] pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#d4af37]" />
                <h2 className="text-sm font-serif font-bold uppercase tracking-wider text-[#e6ded0]">
                  Censo y Población
                </h2>
              </div>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
                isStarving === true
                  ? 'bg-rose-950/60 text-rose-300 border-rose-800/50'
                  : isStarving === false
                    ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800/40'
                    : 'bg-neutral-900 text-neutral-400 border-neutral-700'
              }`}>
                {isStarving === true ? 'En Peligro de Hambruna' : isStarving === false ? 'Población Abastecida' : 'Estado sin registro'}
              </span>
            </div>

            {/* Métricas macroscópicas */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#19150f] p-3 rounded-lg border border-[#2c2419]">
                <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider mb-0.5">Censo Total</span>
                <span className="text-lg font-bold text-[#f5efe1] font-serif">
                  {totalPop !== null ? totalPop.toLocaleString('es-ES') : 'No disponible'}
                </span>
                <span className="text-[10px] text-[#695d4c] block mt-0.5">habitantes</span>
              </div>
              <div className="bg-[#19150f] p-3 rounded-lg border border-[#2c2419]">
                <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider mb-0.5">Capacidad</span>
                <span className="text-lg font-bold text-[#c7beac] font-serif">
                  {capacityPop !== null ? capacityPop.toLocaleString('es-ES') : 'Sin dato'}
                </span>
                <span className="text-[10px] text-[#695d4c] block mt-0.5">
                  plazas en viviendas (100 por nivel)
                </span>
              </div>
              <div className="bg-[#19150f] p-3 rounded-lg border border-[#2c2419]">
                <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider mb-0.5">Mano Libre</span>
                <span className="text-lg font-bold text-[#d4af37] font-serif">
                  {availablePop !== null ? availablePop.toLocaleString('es-ES') : 'No disponible'}
                </span>
                <span className="text-[10px] text-[#695d4c] block mt-0.5">sin asignar</span>
              </div>
            </div>

            {/* Barra de capacidad residencial */}
            {totalPop !== null && capacityPop !== null && capacityPop > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-xs text-[#a09480]">
                  <span>Ocupación de Viviendas</span>
                  <span>{Math.round((totalPop / capacityPop) * 100)}% ({totalPop} / {capacityPop})</span>
                </div>
                <div className="w-full h-2 bg-[#1b1712] rounded-full overflow-hidden border border-[#2d2418]">
                  <div 
                    className="h-full bg-gradient-to-r from-amber-600 to-[#d4af37] transition-all duration-500 rounded-full"
                    style={{ width: `${Math.min(100, Math.round((totalPop / capacityPop) * 100))}%` }}
                  ></div>
                </div>
              </div>
            )}

            {/* Distribución por oficios confirmados */}
            <div className="space-y-2 pt-2">
              <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider">
                Distribución de Oficios Activos
              </h3>
              <p className="text-[10px] text-[#8e816d]">
                {totalAssignedWorkers?.toLocaleString('es-ES') ?? 'No disponible'} asignados · {availablePop?.toLocaleString('es-ES') ?? 'No disponible'} disponibles · {totalPop?.toLocaleString('es-ES') ?? 'No disponible'} habitantes
              </p>
              {populationJobs && populationJobs.length > 0 ? (
                <div className="space-y-2">
                  {visibleJobTypes.map((jobType) => {
                    const info = jobLabels[jobType];
                    const assignedCount = populationJobs.find(
                      job => job.jobType.trim().toLowerCase() === jobType
                    )?.assignedCount ?? 0;
                    const percent = totalPop && totalPop > 0 ? Math.round((assignedCount / totalPop) * 100) : 0;
                    return (
                      <form
                        key={jobType}
                        onSubmit={event => handleWorkerReassignment(event, jobType)}
                        className="bg-[#18140f] p-2.5 rounded-lg border border-[#2c2419] flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`w-2 h-2 rounded-full ${info.color}`}></span>
                          <div className="min-w-0">
                            <span className="font-medium text-[#f0e8d4] block">{info.label}</span>
                            <span className="text-[10px] text-[#786c5a]">{info.desc}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-[10px] text-[#8e816d]">({percent}%)</span>
                          {isOwner ? (
                            <>
                              <input
                                key={`${jobType}-${assignedCount}`}
                                name="assignedCount"
                                type="number"
                                min="0"
                                step="1"
                                defaultValue={assignedCount}
                                aria-label={`Trabajadores asignados a ${info.label}`}
                                disabled={savingWorkerJob !== null}
                                className="w-20 rounded border border-[#3b3121] bg-[#100e0b] px-2 py-1 text-right font-mono text-[#e6ded0] disabled:opacity-50"
                              />
                              <button
                                type="submit"
                                disabled={savingWorkerJob !== null}
                                className="rounded border border-[#6e5520] px-2 py-1 text-[#d4af37] hover:bg-[#2b2113] disabled:opacity-50"
                              >
                                {savingWorkerJob === jobType ? 'Guardando…' : 'Guardar'}
                              </button>
                            </>
                          ) : (
                            <span className="font-mono font-bold text-[#e6ded0]">{assignedCount}</span>
                          )}
                        </div>
                      </form>
                    );
                  })}
                  {populationJobs.filter(job => !Object.hasOwn(jobLabels, job.jobType)).map(job => (
                    <div key={job._id ?? job.jobType} className="bg-[#18140f] p-2.5 rounded-lg border border-[#2c2419] flex items-center justify-between text-xs">
                      <span className="font-medium text-[#f0e8d4]">{jobLabels[job.jobType]?.label ?? job.jobType}</span>
                      <span className="font-mono font-bold text-[#e6ded0]">{job.assignedCount}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">
                    No se registraron asignaciones laborales persistidas.
                  </p>
                  {isOwner && visibleJobTypes.map((jobType) => { const info = jobLabels[jobType]; return (
                    <form
                      key={jobType}
                      onSubmit={event => handleWorkerReassignment(event, jobType)}
                      className="bg-[#18140f] p-2.5 rounded-lg border border-[#2c2419] flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="font-medium text-[#f0e8d4]">{info.label}</span>
                      <div className="flex items-center gap-2">
                        <input
                          name="assignedCount"
                          type="number"
                          min="0"
                          step="1"
                          defaultValue={0}
                          aria-label={`Trabajadores asignados a ${info.label}`}
                          disabled={savingWorkerJob !== null}
                          className="w-20 rounded border border-[#3b3121] bg-[#100e0b] px-2 py-1 text-right font-mono text-[#e6ded0] disabled:opacity-50"
                        />
                        <button
                          type="submit"
                          disabled={savingWorkerJob !== null}
                          className="rounded border border-[#6e5520] px-2 py-1 text-[#d4af37] hover:bg-[#2b2113] disabled:opacity-50"
                        >
                          {savingWorkerJob === jobType ? 'Guardando…' : 'Guardar'}
                        </button>
                      </div>
                    </form>
                  ); })}
                </div>
              )}
              {workerSaveError && (
                <p role="alert" className="text-xs text-rose-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" /> {workerSaveError}
                </p>
              )}
              {workerSaveMessage && (
                <p role="status" className="text-xs text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {workerSaveMessage}
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-[#241e15] pt-3 text-[11px] text-[#7a6f5e] flex items-center justify-between">
            <span>Modelo P10 / P12 / P19</span>
            <span>Censo gobernado por servidor</span>
          </div>
        </section>

        {/* PANEL DE EJÉRCITO (6 col) */}
        <section className="lg:col-span-6 bg-[#14110d] border border-[#2b2419] rounded-xl p-5 shadow-sm space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#241e15] pb-3">
              <div className="flex items-center gap-2">
                <Swords className="w-4 h-4 text-rose-400" />
                <h2 className="text-sm font-serif font-bold uppercase tracking-wider text-[#e6ded0]">
                  Fuerzas Militares y Guarnición
                </h2>
              </div>
              <span className="text-[11px] text-[#d4af37] font-semibold bg-[#241a10] px-2.5 py-0.5 rounded border border-[#d4af37]/30">
                {totalTroops !== null ? `${totalTroops} tropas en armas` : 'No disponible'}
              </span>
            </div>

            {/* Medidor de guarnición */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#19150f] p-3 rounded-lg border border-[#2c2419]">
                <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider mb-0.5">Efectivos Totales</span>
                <span className="text-xl font-bold text-rose-300 font-serif">
                  {totalTroops !== null ? totalTroops.toLocaleString('es-ES') : 'No disponible'}
                </span>
                <span className="text-[10px] text-[#695d4c] block mt-0.5">contingente permanente</span>
              </div>
              <div className="bg-[#19150f] p-3 rounded-lg border border-[#2c2419]">
                <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider mb-0.5">Moral de Combate</span>
                <span className="text-xl font-bold text-[#f5efe1] font-serif">
                  {typeof kingdom.militaryMorale === 'number' ? `${kingdom.militaryMorale}%` : 'No disponible'}
                </span>
                <span className="text-[10px] text-[#695d4c] block mt-0.5">firmeza marcial</span>
              </div>
            </div>

            {/* Desglose por tipos de unidad verificados */}
            <div className="space-y-2 pt-1">
              <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider">
                Composición de Cuerpos Militares
              </h3>
              {armyUnits && armyUnits.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {armyUnits.map((unit, idx) => {
                    const info = unitLabels[unit.unitType] || {
                      label: unit.unitType,
                      icon: <Shield className="w-4 h-4 text-neutral-400" />,
                      desc: 'Unidad militar'
                    };
                    const percent = totalTroops && totalTroops > 0 ? Math.round((unit.count / totalTroops) * 100) : 0;
                    return (
                      <div key={idx} className="bg-[#18140f] p-3 rounded-lg border border-[#2c2419] flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="p-1.5 bg-[#251e14] border border-[#3b301f] rounded">
                            {info.icon}
                          </div>
                          <div>
                            <span className="text-xs font-semibold text-[#f0e8d4] block">{info.label}</span>
                            <span className="text-[10px] text-[#786c5a]">{info.desc}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-base font-bold font-serif text-[#f4eedb]">{unit.count}</span>
                          <span className="text-[10px] text-[#8e816d] block">({percent}%)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">
                  No hay unidades militares registradas en este castillo.
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-[#241e15] pt-3 text-[11px] text-[#7a6f5e] flex items-center justify-between">
            <span>Requisitos marciales P23</span>
            <span>Unidades bajo mando directo</span>
          </div>
        </section>
      </div>

      <section className="bg-[#14110d] border border-[#2b2419] rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[#241e15] pb-3">
          <div className="flex items-center gap-2">
            <Castle className="w-4 h-4 text-[#d4af37]" />
            <h2 className="text-sm font-serif font-bold uppercase tracking-wider text-[#e6ded0]">Edificios y Construcción</h2>
          </div>
          <span className="text-[11px] text-[#8e816d]">
            {constructionState ? `${constructionState.constructionQueue.length}/2 ranuras ocupadas` : 'Estado no disponible'}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider">Edificios persistidos</h3>
            {constructionState?.buildings.length ? constructionState.buildings.map((building) => (
              <div key={building._id} className="bg-[#18140f] p-3 rounded-lg border border-[#2c2419] flex justify-between text-xs">
                <span className="text-[#f0e8d4]">{building.buildingType}</span>
                <span className="font-mono text-[#d4af37]">Nivel {building.level}</span>
              </div>
            )) : (
              <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">
                No hay documentos de edificios persistidos para este reino.
              </p>
            )}
            {constructionState?.catalogForLevels && (
              <div className="mt-3 space-y-1.5">
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[#8e816d]">
                  Catálogo oficial · siguiente nivel
                  {constructionState.constructionDurationModifier && constructionState.constructionDurationModifier !== 1
                    ? ` · duración ×${constructionState.constructionDurationModifier.toFixed(2)} por tecnología`
                    : ''}
                </h4>
                {Object.entries(constructionState.catalogForLevels).map(([buildingType, entry]) => {
                  const blockers: string[] = [];
                  if (!entry.requirementsSatisfied) blockers.push(`requiere ${formatRequirements(entry.requirements, buildingLabels)}`);
                  if (!entry.castleCapSatisfied) blockers.push(`el Castillo (nivel ${constructionState.buildingLevels?.castillo ?? 0}) limita el nivel`);
                  if (entry.nextLevel === null) blockers.push('nivel máximo alcanzado');
                  const inQueue = constructionState.constructionQueue.some((c) => c.buildingType === buildingType);
                  const canStart = isOwner && blockers.length === 0 && !inQueue;
                  const jobNames: Record<string, string> = { agriculture: 'agricultura', wood: 'madera', stone: 'piedra', iron: 'hierro', gold: 'oro' };
                  const professionNames: Record<string, string> = { medicine: 'medicina', religion: 'religión', entertainment: 'circo y feria', bakery: 'panadería' };
                  const professionJob = (BUILDINGS as Record<string, { professionJob?: string }>)[buildingType]?.professionJob;
                  const effect = entry.residentialCapacityPerLevel > 0
                    ? `+${entry.residentialCapacityPerLevel} plazas de vivienda`
                    : entry.workerCapacityPerLevel > 0
                      ? `+${entry.workerCapacityPerLevel} trabajadores${entry.jobType ? ` de ${jobNames[entry.jobType] ?? entry.jobType}` : professionJob ? ` de ${professionNames[professionJob] ?? professionJob}` : ''} · ${entry.role}`
                      : entry.role;
                  return (
                    <div key={buildingType} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 rounded border border-[#2b2419] bg-[#100e0b] px-2.5 py-2 text-[11px]">
                      <span className="text-[#c7beac]">
                        <strong className="text-[#f0e8d4]">{entry.label}</strong> nivel {entry.currentLevel}
                        {entry.nextLevel !== null && (
                          <> → {entry.nextLevel} · coste: {formatCosts(entry.nextCosts)} · tarda: {entry.nextDurationMs ? formatSecondsDuration(entry.nextDurationMs / 1000) : 'sin dato'} · efecto: {effect}</>
                        )}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {blockers.length ? (
                          <span className="text-amber-300">{blockers.join('; ')}</span>
                        ) : inQueue ? (
                          <span className="text-[#8e816d]">en cola</span>
                        ) : (
                          <span className="text-emerald-300">disponible</span>
                        )}
                        {canStart && (
                          <button
                            type="button"
                            onClick={() => handleConstructionStart(buildingType)}
                            disabled={startingConstruction !== null || constructionState.constructionQueue.length >= 2}
                            className="rounded border border-[#6e5520] px-2 py-1 text-[#d4af37] hover:bg-[#2b2113] disabled:opacity-50"
                          >
                            {startingConstruction === buildingType ? 'Encolando…' : 'Construir'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-[#8e816d]">
              Capacidad residencial: {capacityPop === null ? 'sin dato' : capacityPop.toLocaleString('es-ES')} plazas ·
              capacidad laboral: {constructionState?.jobCapacities
                ? Object.entries(constructionState.jobCapacities).map(([job, cap]) => `${{ agriculture: 'agricultura', wood: 'madera', stone: 'piedra', iron: 'hierro', gold: 'oro' }[job] ?? job} ${cap}`).join(', ')
                : 'sin dato'}.
            </p>
            {isOwner && constructionState && (!constructionState.hasInitialBuildings || !kingdom.homeTerritoryId) && (
              <div className="rounded border border-amber-900/40 bg-[#1b160f] p-3 text-[11px] text-[#c7b99f] space-y-2">
                <span className="block">Este reino es anterior a las reglas actuales y le faltan elementos fundacionales:</span>
                <div className="flex flex-wrap gap-2">
                  {!constructionState.hasInitialBuildings && (
                    <button type="button" onClick={handleBootstrapBuildings} disabled={bootstrapBusy !== null} className="rounded border border-[#6e5520] px-2 py-1 text-[#d4af37] hover:bg-[#2b2113] disabled:opacity-50">
                      {bootstrapBusy === 'buildings' ? 'Asignando…' : 'Recibir edificios fundacionales'}
                    </button>
                  )}
                  {!kingdom.homeTerritoryId && (
                    <button type="button" onClick={handleEnsureHomeTerritory} disabled={bootstrapBusy !== null} className="rounded border border-[#6e5520] px-2 py-1 text-[#d4af37] hover:bg-[#2b2113] disabled:opacity-50">
                      {bootstrapBusy === 'territory' ? 'Asignando…' : 'Asignar territorio principal'}
                    </button>
                  )}
                </div>
                {bootstrapMessage && <span className="block text-emerald-300">{bootstrapMessage}</span>}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider">Cola del servidor</h3>
            {constructionState?.constructionQueue.length ? constructionState.constructionQueue.map((construction) => {
              const timingAvailable = hasConstructionTiming(construction);
              const progress = timingAvailable
                ? constructionProgress(construction, constructionDisplayServerTime)
                : null;
              const remainingSeconds = timingAvailable
                ? Math.max(0, (construction.startedAt + construction.durationMs - constructionDisplayServerTime) / 1000)
                : null;
              const notStarted = timingAvailable && construction.startedAt > constructionDisplayServerTime;
              const progressLabel = progress === null ? 'Progreso no disponible' : `${Math.floor(progress)} %`;
              return (
                <div key={construction._id} className="bg-[#18140f] p-3 rounded-lg border border-[#2c2419] space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-[#f0e8d4]">{construction.buildingType ?? 'Construcción heredada'} · nivel {construction.targetLevel ?? 'sin dato'}</span>
                    <span className="font-mono text-[#d4af37]">{progressLabel}</span>
                  </div>
                  <p className="text-[11px] text-[#8e816d]">
                    {remainingSeconds === null
                      ? 'Tiempo restante no disponible: faltan marcas temporales persistidas.'
                      : `${notStarted ? 'Comienza en' : 'Tiempo restante'}: ${formatSecondsDuration(remainingSeconds)}`}
                  </p>
                  {progress !== null && (
                    <div className="h-1.5 bg-[#0d0b09] rounded overflow-hidden">
                      <div className="h-full bg-amber-600" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
                    </div>
                  )}
                  {isOwner && !notStarted && progress !== null && progress < 100 && (
                    <button
                      type="button"
                      onClick={() => handleConstructionCancellation(construction)}
                      disabled={cancellingConstruction !== null}
                      className="rounded border border-rose-900/70 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-950/40 disabled:opacity-50"
                    >
                      {cancellingConstruction === construction._id ? 'Cancelando…' : 'Cancelar (reembolso 50 %)'}
                    </button>
                  )}
                </div>
              );
            }) : (
              <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">
                No hay construcciones en curso.
              </p>
            )}
          </div>
        </div>

        <div className="rounded border border-amber-900/40 bg-[#1b160f] p-3 text-xs text-[#c7b99f]">
          {isOwner
            ? 'Las obras usan el reloj del servidor, dos ranuras simultáneas, +1 % de duración por nivel y coste ×1,15 por nivel. Ningún edificio supera el nivel del Castillo; cancelar devuelve el 50 % de lo pagado.'
            : 'Consulta de solo lectura. Iberia no puede iniciar ni cancelar construcciones.'}
          <span className="block mt-1 text-[11px] text-[#8e816d]">
            La capacidad residencial y la laboral se calculan como capacidad por nivel × nivel de cada edificio completado.
          </span>
        </div>
        {constructionError && <p role="alert" className="text-xs text-rose-400">{constructionError}</p>}
        {constructionMessage && <p role="status" className="text-xs text-emerald-400">{constructionMessage}</p>}
      </section>

      <section className="bg-[#12100d] border border-[#241e15] rounded-xl p-4 text-xs text-[#8e816d] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <span><strong>Secciones:</strong> Ejército, Universidad, Parlamento y Mapa están disponibles en la navegación principal.</span>
        <button
          onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
          className="inline-flex items-center gap-1.5 text-xs text-[#c5a059] hover:text-[#e8dfc8] transition-colors flex-shrink-0"
        >
          <span>{showTechnicalDetails ? 'Ocultar detalles técnicos' : 'Ver ficha de consulta'}</span>
          {showTechnicalDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </section>

      {/* Ficha técnica desplegable con información del backend */}
      {showTechnicalDetails && (
        <section className="bg-[#0f0d0a] border border-[#2b2419] rounded-xl p-4 text-xs space-y-3 font-mono">
          <div className="flex items-center justify-between border-b border-[#241e15] pb-2 text-[#d4af37]">
            <span className="font-semibold">Ficha Técnica de Consulta Remota</span>
            <span className="text-[10px] text-[#7d705c]">Convex @ 1.46.0</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-[#a09480]">
            <div>
              <span className="text-[#6d614e] block">Función Autoritaria:</span>
              <code className="text-[#e0d6c3]">kingdoms:getKingdomFull</code>
            </div>
            <div>
              <span className="text-[#6d614e] block">Argumento de Usuario:</span>
              <code className="text-[#e0d6c3]">{`{ userId: "${activeUserId}" }`}</code>
            </div>
            <div>
              <span className="text-[#6d614e] block">Identificador de Reino:</span>
              <code className="text-[#e0d6c3]">{kingdom._id}</code>
            </div>
            <div>
              <span className="text-[#6d614e] block">Canal de Sincronización:</span>
              <code className="text-emerald-400">WebSocket reactivo en tiempo real (useQuery)</code>
            </div>
            <div>
              <span className="text-[#6d614e] block">Identidad Convex (OIDC):</span>
              <code className={viewer ? "text-emerald-400" : "text-amber-400"}>
                {viewer ? `${viewer.email || viewer.subject} (Validado)` : 'Sin sesión OIDC en Convex'}
              </code>
            </div>
            <div>
              <span className="text-[#6d614e] block">Titularidad y Permisos B.8:</span>
              <code className={isOwner ? "text-emerald-400" : "text-amber-400"}>
                {isOwner ? "Soberano Verificado (Mutaciones Activas)" : "Modo Consulta / Demo (Escrituras Bloqueadas)"}
              </code>
            </div>
            <div>
              <span className="text-[#6d614e] block">Régimen Persistido (BD):</span>
              <code className="text-[#e0d6c3]">
                {kingdom.foodTier ?? "normal (por defecto)"}
              </code>
            </div>
            <div>
              <span className="text-[#6d614e] block">Mutaciones B.8 Conectadas:</span>
              <code className="text-emerald-400">
                economy:settleKingdomEconomy | economy:setKingdomFoodTier
              </code>
            </div>
          </div>
        </section>
      )}
      </>)}
    </div>
  );
}

/* ==========================================================================
   COMPONENTE RAÍZ APP
   ========================================================================== */
export default function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Si está cargando el estado inicial de sesión, mostrar cargador minimalista para estabilizar la transición (P4, T-01)
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0b0a08] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-[#d4af37] animate-spin" />
          <span className="text-xs text-[#8e816d] font-serif uppercase tracking-widest">Validando Sesión...</span>
        </div>
      </div>
    );
  }

  // Si no está autenticado, renderiza la pantalla de inicio oficial a pantalla completa
  if (!isAuthenticated) {
    return (
      <HomeScreen />
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0a08] text-[#e8dfc8] flex flex-col font-sans selection:bg-[#d4af37]/30 selection:text-[#f7f2e4]">
      {/* ====================================================================
          BARRA DE NAVEGACIÓN SUPERIOR (RESPONSIVE MÓVIL Y TABLET)
          ==================================================================== */}
      <header className="border-b border-[#292218] bg-[#12100d] px-4 sm:px-6 py-3.5 sticky top-0 z-40 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#211a12] border border-[#d4af37]/40 rounded-lg text-[#d4af37] shadow-sm">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base sm:text-lg font-bold font-serif text-[#f5efe1] tracking-wide">
                  La Conquista
                </span>
                <span className="text-[10px] text-[#d4af37] font-serif border border-[#d4af37]/30 bg-[#251c11] px-1.5 py-0.5 rounded uppercase tracking-wider">
                  Resumen del Reino
                </span>
              </div>
              <p className="text-[11px] text-[#8e816d] hidden sm:block">
                Estrategia Medieval Persistente — Servidor Autoritativo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setRefreshTrigger(prev => prev + 1)}
              className="p-1.5 sm:px-2.5 sm:py-1.5 bg-[#1b1711] hover:bg-[#262017] border border-[#3b3121] rounded text-[#c5a059] hover:text-[#e8dfc8] transition-colors flex items-center gap-1.5 text-xs"
              title="Forzar actualización reactiva de datos"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sincronizar</span>
            </button>
            <SessionControls />
            <ConnectionStatusBadge />
          </div>
        </div>
      </header>

      {/* ====================================================================
          CONTENEDOR PRINCIPAL
          ==================================================================== */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 pb-24 sm:p-6" key={refreshTrigger}>
        <QueryErrorBoundary fallbackUserId={DEMO_USER_ID}>
          <KingdomOverviewContent />
        </QueryErrorBoundary>
      </main>

      {/* ====================================================================
          PIE DE PÁGINA
          ==================================================================== */}
      <footer className="border-t border-[#241e15] bg-[#0e0c09] px-4 py-3 pb-20 sm:pb-3 text-center text-xs text-[#6e6352]">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>La Conquista — Interfaz Jugable: Resumen del Reino</span>
          <span className="text-[11px] text-[#594f41]">
            Datos sincronizados en tiempo real mediante Convex WebSocket
          </span>
        </div>
      </footer>
    </div>
  );
}
