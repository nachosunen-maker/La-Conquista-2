import React, { useState } from 'react';
import { Crown, Shield, Scroll } from 'lucide-react';
import { AccessPanel } from './AccessPanel';

interface HomeScreenProps {
  /** Entrar como invitado: reino de demostración Iberia en solo lectura. */
  onEnterDemo: () => void;
}

// Las 12 Civilizaciones Oficiales de la Especificación Maestra (Punto 6)
export const OFFICIAL_CIVILIZATIONS = [
  { id: 'ingleses', name: 'Ingleses', icon: '🏹', desc: 'Maestría con el arco largo, lana e infantería disciplinada' },
  { id: 'romanos', name: 'Romanos', icon: '🏛️', desc: 'Ingeniería militar, calzadas y legiones de formación cerrada' },
  { id: 'griegos', name: 'Griegos', icon: '🏺', desc: 'Filosofía, falanges de hoplitas y arquitectura monumental' },
  { id: 'vikingos', name: 'Vikingos', icon: '🪓', desc: 'Incursiones marítimas, hachas de combate y temple nórdico' },
  { id: 'bizantinos', name: 'Bizantinos', icon: '👑', desc: 'Catafractos acorazados, diplomacia y murallas inexpugnables' },
  { id: 'arabes', name: 'Árabes', icon: '🐎', desc: 'Caballería rápida, regadío avanzado y ciencias matemáticas' },
  { id: 'mongoles', name: 'Mongoles', icon: '🏹', desc: 'Tiradores a caballo nómadas, movilidad extrema y asedio veloz' },
  { id: 'chinos', name: 'Chinos', icon: '🏯', desc: 'Pólvora temprana, burocracia eficiente y gran muralla' },
  { id: 'japoneses', name: 'Japoneses', icon: '⚔️', desc: 'Código de honor marcial, katanas forjadas y arqueros samurái' },
  { id: 'navajos', name: 'Navajos', icon: '🦅', desc: 'Conocimiento del terreno, sigilo, caza y resistencia física' },
  { id: 'aztecas', name: 'Aztecas', icon: '☀️', desc: 'Guerreros águila y jaguar, templos y tenacidad en el combate' },
  { id: 'masais', name: 'Masáis', icon: '🦁', desc: 'Velocidad, lanzas ligeras, pastoreo y aguante territorial' },
];

export function HomeScreen({ onEnterDemo }: HomeScreenProps) {
  const [selectedCiv, setSelectedCiv] = useState<string | null>(null);

  return (
    <div className="space-y-8 max-w-5xl mx-auto py-4">
      {/* ====================================================================
          PANTALLA DE INICIO (sección 5 de CLAUDE.md): ilustración + panel de acceso
          ==================================================================== */}
      <section className="bg-[#14120e] border border-[#382f20] rounded-xl p-5 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6 lg:gap-10 items-center">
          <div className="text-center lg:text-left space-y-4">
            <div className="inline-flex items-center justify-center p-3.5 bg-[#211a12] border border-[#d4af37]/40 rounded-xl text-[#d4af37] shadow-inner">
              <Crown className="w-10 h-10" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl sm:text-5xl font-serif font-bold text-[#f7f2e4] tracking-wide">LA CONQUISTA</h1>
              <p className="text-sm sm:text-base text-[#d4af37] font-serif tracking-widest uppercase font-semibold">
                Un reino. Una corona. Tu legado.
              </p>
              <p className="text-sm text-[#e6ded0] font-serif">Forja tu reino. Escribe tu historia.</p>
              <p className="text-xs sm:text-sm text-[#baa890] leading-relaxed font-serif pt-1">
                Juego de estrategia y gestión medieval de partidas persistentes. Mueve los hilos y tu población ejecutará las órdenes en el servidor en tiempo real.
              </p>
            </div>
            <p className="text-[11px] text-[#8e816d] italic max-w-lg mx-auto lg:mx-0">
              Tu cuenta y todo el progreso viven en el servidor: retoma la partida desde cualquier dispositivo con tu nombre de gobernante y tu contraseña. Sin correo ni Google.
            </p>
          </div>
          <AccessPanel onGuest={onEnterDemo} />
        </div>
      </section>

      {/* ====================================================================
          LAS 12 CIVILIZACIONES INICIALES (PUNTO 6 DE LA ESPECIFICACIÓN)
          ==================================================================== */}
      <section className="bg-[#14120e] border border-[#2d251a] p-6 rounded-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#2d251a] pb-3">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#d4af37]" />
            <div>
              <h2 className="text-sm sm:text-base font-serif font-bold text-[#f4eedb] uppercase tracking-wider">
                Las 12 Civilizaciones Iniciales (Punto 6)
              </h2>
              <p className="text-[11px] text-[#8e816d]">
                Cada civilización cuenta con bonificaciones pasivas y estilo propio. Seleccionable al fundar un nuevo reino.
              </p>
            </div>
          </div>
          <span className="text-[10px] text-[#d4af37] bg-[#221a11] px-2 py-0.5 rounded border border-[#d4af37]/30 self-start sm:self-auto font-mono">
            12 Facciones Oficiales
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {OFFICIAL_CIVILIZATIONS.map((civ) => {
            const isSelected = selectedCiv === civ.id;
            return (
              <div
                key={civ.id}
                onClick={() => setSelectedCiv(isSelected ? null : civ.id)}
                className={`p-3.5 rounded-lg border transition-all cursor-pointer text-left space-y-1.5 ${
                  isSelected
                    ? 'bg-[#251b11] border-[#d4af37] shadow-md shadow-[#d4af37]/10'
                    : 'bg-[#18140f] border-[#31271b] hover:border-[#4d3d29] hover:bg-[#1f1913]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xl" role="img" aria-label={civ.name}>
                    {civ.icon}
                  </span>
                  {civ.name === 'Ingleses' && (
                    <span className="text-[9px] text-[#d4af37] bg-[#291e13] px-1 rounded border border-[#d4af37]/30 font-mono">
                      Ref
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-serif font-bold text-[#f4eedb]">
                    {civ.name}
                  </h3>
                  <p className="text-[11px] text-[#938673] leading-snug line-clamp-2">
                    {civ.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {selectedCiv && (
          <div className="p-3 bg-[#1e1710] border border-[#4a3a24] rounded-lg text-xs text-[#c5b7a0] flex items-center justify-between gap-3">
            <div>
              <span className="font-serif font-semibold text-[#f4eedb]">
                {OFFICIAL_CIVILIZATIONS.find(c => c.id === selectedCiv)?.name}
              </span>
              : {OFFICIAL_CIVILIZATIONS.find(c => c.id === selectedCiv)?.desc}.
            </div>
            <span className="text-[10px] text-[#d4af37] whitespace-nowrap font-serif">
              Disponible en la creación del reino (P6–P9)
            </span>
          </div>
        )}
      </section>

      {/* ====================================================================
          LEYES FUNDAMENTALES DEL MUNDO (PUNTOS 2, 3, 10, 38)
          ==================================================================== */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 px-1">
          <Scroll className="w-4 h-4 text-[#d4af37]" />
          <h2 className="text-sm font-serif font-semibold text-[#d4af37] uppercase tracking-wider">
            Leyes Fundamentales del Mundo (Puntos 1–73)
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#14120e] border border-[#2d251a] p-4 rounded-xl space-y-2">
            <div className="text-xl">⏳</div>
            <h3 className="text-sm font-serif font-bold text-[#f4eedb]">Escala Temporal (P2)</h3>
            <p className="text-xs text-[#9d8f7b] leading-relaxed">
              1 día real = 1 año de reino. Las estaciones y cosechas transcurren en el servidor sin botones artificiales de avance.
            </p>
          </div>

          <div className="bg-[#14120e] border border-[#2d251a] p-4 rounded-xl space-y-2">
            <div className="text-xl">👑</div>
            <h3 className="text-sm font-serif font-bold text-[#f4eedb]">Comienzo (P10)</h3>
            <p className="text-xs text-[#9d8f7b] leading-relaxed">
              El jugador comienza con 2.000 habitantes. La población civil se asigna a profesiones y crece un 30% anual si hay viviendas.
            </p>
          </div>

          <div className="bg-[#14120e] border border-[#2d251a] p-4 rounded-xl space-y-2">
            <div className="text-xl">🌾</div>
            <h3 className="text-sm font-serif font-bold text-[#f4eedb]">Economía Real (P26)</h3>
            <p className="text-xs text-[#9d8f7b] leading-relaxed">
              Oro, madera, piedra, hierro y alimentos. Los soldados consumen un 5% más de comida que los civiles (factor P18).
            </p>
          </div>

          <div className="bg-[#14120e] border border-[#2d251a] p-4 rounded-xl space-y-2">
            <div className="text-xl">⚔️</div>
            <h3 className="text-sm font-serif font-bold text-[#f4eedb]">Parlamento (P38)</h3>
            <p className="text-xs text-[#9d8f7b] leading-relaxed">
              No existen ataques sorpresa en PvP. Todo desafío pasa por el Parlamento con 3 ventanas de fecha programada.
            </p>
          </div>
        </div>
      </section>

      {/* ====================================================================
          PILARES FUNCIONALES Y ACCESO A IBERIA
          ==================================================================== */}
      <section className="bg-[#14120e] border border-[#2d251a] p-6 rounded-xl space-y-5">
        <h2 className="text-sm font-serif font-semibold text-[#f4eedb] uppercase tracking-wider flex items-center gap-2">
          <span>🏛️ Navegación Principal del Reino (Punto 64)</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          <div className="p-3 bg-[#1a1611] border border-[#332a1e] rounded-lg space-y-1.5">
            <div className="text-sm font-serif font-bold text-[#d4af37]">🌾 Aldea</div>
            <p className="text-[#a09480] text-[11px] leading-relaxed">
              Economía, oficios, alimentos, impuestos y balance demográfico.
            </p>
          </div>

          <div className="p-3 bg-[#1a1611] border border-[#332a1e] rounded-lg space-y-1.5">
            <div className="text-sm font-serif font-bold text-[#d4af37]">⚔️ Ejército</div>
            <p className="text-[#a09480] text-[11px] leading-relaxed">
              Tropas, entrenamiento, armas, armaduras, heridos y hospital.
            </p>
          </div>

          <div className="p-3 bg-[#1a1611] border border-[#332a1e] rounded-lg space-y-1.5">
            <div className="text-sm font-serif font-bold text-[#d4af37]">📜 Universidad</div>
            <p className="text-[#a09480] text-[11px] leading-relaxed">
              Árboles de tecnologías, supervisores e investigación activa.
            </p>
          </div>

          <div className="p-3 bg-[#1a1611] border border-[#332a1e] rounded-lg space-y-1.5">
            <div className="text-sm font-serif font-bold text-[#d4af37]">🏛️ Parlamento</div>
            <p className="text-[#a09480] text-[11px] leading-relaxed">
              Desafíos de combate, diplomacia y notificaciones oficiales.
            </p>
          </div>

          <div className="p-3 bg-[#1a1611] border border-[#332a1e] rounded-lg space-y-1.5">
            <div className="text-sm font-serif font-bold text-[#d4af37]">🗺️ Mapa</div>
            <p className="text-[#a09480] text-[11px] leading-relaxed">
              Territorios del reino, provincias libres, distancias y conquista.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
