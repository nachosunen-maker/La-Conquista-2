import React from 'react';
import { AccessPanel } from './AccessPanel';

interface HomeScreenProps {
  /** Entrar como invitado: reino de demostración Iberia en modo exploración. */
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

/**
 * Pantalla de inicio oficial de «La Conquista».
 * Reproducción 1:1 de la referencia oficial inalterable:
 * - Composición horizontal única completa:
 *   - Lado izquierdo: Ilustración cinematográfica, rey, castillo, río, puesta de sol,
 *     logotipo «LA CONQUISTA» y lemas oficiales.
 *   - Lado derecho: Panel medieval gótico oscuro con controles reales e interactivos
 *     posicionados exactamente sobre la zona del panel de la referencia.
 * - En escritorio / tablets horizontales (>= 768px): La composición es siempre horizontal
 *   mediante un lienzo proporcional 1536:1024 centrado que cubre la pantalla sin apilarse.
 * - En móvil vertical (< 768px): Adaptación ergonómica vertical para facilitar el uso táctil.
 */
export function HomeScreen() {
  return (
    <div className="min-h-screen w-full bg-[#05080e] text-[#e8dfc8] flex items-center justify-center relative overflow-hidden select-none">
      {/* ====================================================================
          1. COMPOSICIÓN HORIZONTAL OFICIAL (ESCRITORIO Y PANTALLAS ANCHAS)
          Composición horizontal inalterable: paisaje a la izquierda, panel interactivo a la derecha.
          ==================================================================== */}
      <div className="hidden md:flex items-center justify-center w-full h-screen overflow-hidden relative">
        {/* Lienzo proporcional 1264 × 843 (~3:2) que mantiene exactamente la escala del arte oficial */}
        <div
          className="relative max-w-full max-h-full aspect-[1264/843] shadow-2xl overflow-hidden"
          style={{
            width: 'min(100vw, calc(100vh * (1264 / 843)))',
            height: 'min(100vh, calc(100vw / (1264 / 843)))',
          }}
        >
          {/* Ilustración artística oficial como fondo del lienzo */}
          <img
            src="/assets/aistudio/1793086836321_852e3733.jpg"
            alt="La Conquista — Un reino. Una corona. Tu legado. Forja tu reino. Escribe tu historia."
            className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
          />

          {/* Panel interactivo real posicionado sobre la zona derecha del lienzo */}
          <div
            className="absolute z-20"
            style={{
              left: '59%',
              top: '4.5%',
              width: '37.5%',
              height: '91%',
            }}
          >
            <AccessPanel isStageOverlay />
          </div>
        </div>
      </div>

      {/* ====================================================================
          2. ADAPTACIÓN RESPONSIVE ERGONÓMICA EN MÓVIL (< 768px)
          Permite que en teléfonos los controles sean cómodamente táctiles.
          ==================================================================== */}
      <div className="flex md:hidden flex-col w-full min-h-screen bg-[#070b12] overflow-y-auto">
        {/* Cabecera con la ilustración oficial y la marca */}
        <div className="relative w-full h-56 sm:h-72 overflow-hidden bg-[#070b12] flex-shrink-0">
          <img
            src="/assets/aistudio/1793086836321_852e3733.jpg"
            alt="La Conquista"
            className="w-full h-full object-cover object-left select-none pointer-events-none"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#070b12] via-transparent to-black/30 pointer-events-none" />
        </div>

        {/* Panel interactivo adaptado en móvil */}
        <div className="w-full flex-1 flex items-start justify-center p-4 pb-12">
          <div className="w-full max-w-md">
            <AccessPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
