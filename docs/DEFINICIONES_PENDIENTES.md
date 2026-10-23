# Definiciones pendientes — LA CONQUISTA

**Fecha: 23-10-2026.** Estado tras fusionar los PR #4, #5 y #6.
Todo lo que sigue está **implementado en código local y en pruebas**, pero con valores marcados `[DERIVADO]` en `convex/balanceConfig.ts` que el responsable aún no ha aprobado, o con puntos que solo él puede cerrar. Nada está desplegado; nunca se ha jugado contra el servidor real.

Cómo responder: basta con decir, por bloque, «vale» o el valor que prefieres. Si no se dice nada, se mantiene lo propuesto.

---

## A. Valores propuestos pendientes de aprobación

### A1. Cuenta y código de recuperación (PR #4)
**Problema:** sin correo no hay recuperación de contraseña. Se decidió mostrar un código una sola vez al crear la cuenta. Faltaba fijar su forma y los límites contra ataques de fuerza bruta.

| Parámetro | Propuesto | Dónde |
|---|---|---|
| Formato del código | 16 símbolos en 4 grupos (`XXXX-XXXX-XXXX-XXXX`), sin 0/O ni 1/I/L | `ACCOUNT.RECOVERY_CODE` |
| Intentos fallidos seguidos antes de bloquear | 5 | `MAX_FAILED_ATTEMPTS` |
| Duración del bloqueo | 15 minutos | `LOCK_MS` |
| Intentos de inicio de sesión fallidos por hora | 10 (valor por defecto de Convex Auth) | `SIGN_IN_MAX_FAILED_ATTEMPTS_PER_HOUR` |

**Opciones:** aceptar · pedir un código más corto (12 símbolos, más fácil de copiar, menos seguro) · cambiar intentos o bloqueo.

### A2. Formaciones tácticas (PR #5)
**Problema:** se aprobaron cuatro formaciones sin porcentajes. Se calcularon y validaron con el simulador: con ejércitos iguales, la formación que contrarresta gana por unos 7 puntos de bajas (victoria clara, nunca aplastante); cualquier otro cruce empata.

| Formación | Ataque | Defensa | Fuerte contra | Débil contra |
|---|---|---|---|---|
| Ofensiva | ×1,12 | ×0,90 | Flanqueo | Defensiva |
| Defensiva | ×0,90 | ×1,12 | Ofensiva | Flanqueo |
| Flanqueo | ×1,06 | ×0,96 | Defensiva | Ofensiva |
| Equilibrada | ×1,00 | ×1,00 | Ninguna | Ninguna |

Contrarrestar: ×1,15 directo sobre la potencia (término «Contramedida» de la fórmula). `TACTICAL_FORMATIONS`, `TACTICAL_FORMATION_COUNTER_BONUS`.

**Opciones:** aceptar · hacer la contramedida más fuerte (×1,20 → ~9 puntos de bajas) o más suave (×1,12 → ~5,5 puntos, al borde del empate).

### A3. Mercenarios (PR #5)
**Problema:** se pidieron tipos «más baratos y más caros» ligados a la Taberna, sin salario. Los precios salen de una sola fórmula desde el anclaje aprobado (lanceros, 25 oro).

| Tipo | Tropa | Oro por unidad | Taberna mínima |
|---|---|---|---|
| Mesnada a sueldo | Infantería nivel 1 | 20 | 1 |
| Lanceros a sueldo | Infantería nivel 2 | 25 (anclaje) | 1 |
| Arqueros de fortuna | Arquería nivel 2 | 30 | 2 |
| Jinetes de fortuna | Caballería nivel 2 | 75 | 3 |
| Compañía veterana | Infantería nivel 3 | 30 | 4 |
| Guardia mercenaria | Caballería nivel 3 | 90 | 5 |

Tope común: 50 activos por nivel de Taberna. Contrato de 7 días. `MERCENARIES.TYPES`.

**Opciones:** aceptar · cambiar niveles de Taberna · quitar o añadir tipos.

### A4. Misiones (PR #5)
**Problema:** el diseño estaba aprobado, pero no las cantidades ni la hora de reinicio.

- **Reinicio de las diarias:** 00:00 UTC (`MISSIONS.DAILY.RESET_UTC_HOUR`). Alternativa: 03:00 UTC (madrugada en España y Brasil, menos jugadores activos en el cambio).
- **Diarias por día:** 3 de un catálogo de 6, iguales para todos. Premios de 40–100 oro o 100–150 de recursos y +2/+3 honor.
- **Etapas (4):** misiones de +5 a +20 honor con 50–800 de recursos. Premio final por etapa:

| Etapa | Recursos | Honor | Gloria | Extra |
|---|---|---|---|---|
| 1 Los primeros pasos | 200 oro, 200 madera, 200 piedra, 100 hierro, 300 alimentos | +10 | +5 | 20 infantería nivel 1 |
| 2 Un reino en marcha | 400/400/400/200/600 | +20 | +10 | producción ×1,05 durante 1 día |
| 3 La corona se afirma | 600/600/600/300/800 | +30 | +15 | 30 arquería nivel 2 |
| 4 Señor de la guerra | 1.000/800/800/500/1.000 | +50 | +25 | 30 caballería nivel 2 y producción ×1,10 durante 1 día |

- **Secretas generales (4):** felicidad 90 · 5.000 oro acumulado · 100 de honor · 5 expediciones. Premios de +10 a +15 honor y +5/+10 gloria.
- **Secretas por civilización (1 cada una):** completar su tecnología única. Mismo premio para todas: 300 oro, 200 madera, 200 piedra, 100 hierro, 300 alimentos, +20 honor, +10 gloria.
- **Objetos únicos:** previstos en la estructura de recompensas, pero sin catálogo todavía (no se inventan).

Referencia: una victoria en batalla da +20 honor y +10 gloria; los recursos fundacionales son 500 oro y 1.000 madera.

**Opciones:** aceptar · subir o bajar todas las cantidades en un porcentaje · cambiar la hora de reinicio.

### A5. Debilidades por civilización (PR #5)
**Problema:** cada civilización debe tener ventaja y debilidad; solo había ventajas. Las seis primeras vienen del dossier; las cuatro siguientes son propuestas.

| Civilización | Debilidad | Origen |
|---|---|---|
| Ingleses | Caballería +15 % de coste de instrucción | Dossier |
| Romanos | Caballería +10 % de duración de instrucción | Dossier |
| Vikingos | Asedio +15 % de duración de instrucción | Dossier |
| Bizantinos | Caballería +15 % de coste (élites caras) | Dossier |
| Mongoles | −5 % de fuerza defensiva en combate | Dossier |
| Aztecas | Plaza de caballería ocupada por élite a pie, +15 % de duración | Dossier |
| Griegos | Caballería +10 % de coste | Propuesta |
| Árabes | Infantería +10 % de duración | Propuesta |
| Chinos | Caballería +10 % de coste | Propuesta |
| Japoneses | Asedio +10 % de duración | Propuesta |
| Navajos | Pendiente | Sin dossier |
| Masáis | Pendiente | Sin dossier |

`passive.weakness` y `passive.trainingCostByUnit` / `trainingDurationByUnit` en `CIVILIZATIONS`.

**Opciones:** aceptar · cambiar los porcentajes de las cuatro propuestas · cambiar su tipo de debilidad.

### A6. Terreno en las marchas (PR #6)
**Problema:** la mecánica está decidida (media del terreno del camino), pero todos los terrenos siguen con multiplicador 1,0, así que hoy no tiene efecto.

| Terreno | Propuesto |
|---|---|
| Llanura | ×1,0 |
| Río | ×1,1 |
| Costa | ×1,1 |
| Bosque | ×1,2 |
| Colina | ×1,25 |
| Montaña | ×1,5 |

`TERRAINS.marchMultiplier`. Afecta a la duración de la marcha y a la fatiga (+2 por hexágono × multiplicador).

**Opciones:** aceptar esta tabla · mantener todo en 1,0 (sin efecto) · otra tabla.

---

## B. Puntos que solo el responsable puede cerrar

### B1. Navajos y Masáis
Sin dossier histórico en el repositorio no se les diseña equipo, edificio único, tropa ni debilidad (no se inventa). Conservan sus pasivas actuales. **Decisión del 23-10-2026: dejarlo pendiente.** Para avanzar: subir a la conversación el dossier de las 12 civilizaciones o un texto con cronología, región y equipamiento de ambas.

### B2. Despliegue real (T-02)
**Decisión del 23-10-2026: todavía no.** Cuando se autorice:
1. Alguien con acceso ejecuta `npx convex deploy` (yo no lo ejecuto).
2. En el panel de Convex se configuran `JWT_PRIVATE_KEY`, `JWKS` y `SITE_URL` (los genera el asistente de Convex Auth; nunca van al repositorio).
3. Se prueba el flujo completo contra el servidor: crear cuenta, código de recuperación, fundar reino, una obra, un desafío.
Puedo preparar una guía paso a paso para el colaborador en cuanto se decida.

### B3. P56 y P61 de la Especificación Maestra
Siguen marcados «pendiente de aclaración» en la especificación vigente. No se inventan requisitos. Hace falta que el responsable indique qué debían contener o que se den por eliminados.

### B4. Carpeta `convex_backup/`
**Decisión del 23-10-2026: se mantiene.** Recordatorio: es una copia antigua de `convex/` que no se usa ni se edita.

---

## C. Cerrado el 23-10-2026 (no reabrir)
- Terreno en las marchas: media del camino, en Parlamento y en el mapa.
- Despliegue: todavía no.
- `convex_backup/`: se queda.
- Navajos y Masáis: pendientes hasta tener documentación.

## D. Estado de verificación
Local, tras fusionar el PR #6: lint y build limpios · 200 pruebas puras · 40 de integración · banco de simulaciones de combate sin cambios en los escenarios anteriores. Nunca ejecutado contra el servidor real.
