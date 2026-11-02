# Sprint 4 — revisión del 1 de noviembre de 2026

## Rama de integración `copi`

Se añadió `PaperExecutionService` al módulo real de hedging. Con `EXECUTION_MODE=paper`, una solicitud stop-loss genera `execution_notification` para la sala del símbolo. Flutter recibe el evento, actualiza su estado y muestra un banner explícito de SIMULACIÓN; borra el aviso al desconectarse o cambiar símbolo. El modo predeterminado es desactivado. El servicio deduplica 10.000 correlaciones por sesión y deja de aceptar nuevas al alcanzar ese límite; no persiste ejecuciones ni confirma fills. Reiniciar elimina esa memoria. No sirve como bróker productivo.

Esto conecta las piezas locales antes separadas, pero no implementa FCM en segundo plano ni un adaptador de bróker real. La suite HTTP E2E anterior sigue verificando el contrato con su mock; las pruebas nuevas verifican aceptación paper y recepción/limpieza en el estado Flutter. No se presenta como una prueba de dispositivo físico ni como cierre de los requisitos externos.

Para probarlo: definir `EXECUTION_MODE=paper` en la configuración local del backend, iniciar la aplicación con su fuente de ticks y conectar Flutter al mismo backend/símbolo. No cambiar esta opción en un despliegue que se presente como ejecución real.

Asignación confirmada en ClickUp: [Ejecutar simulador de estrés y backtesting](https://app.clickup.com/t/90171539493/86e390ze6), Diego Alejandro Ocampo, 8 puntos. Requiere 24 meses de NASDAQ 100 con procedencia, métricas, configuración y artefactos reproducibles.

Se actualizó la rama local con `origin/main` fda981c, que incorpora la entrega previa mediante PR 13. No aparecieron implementaciones nuevas de bróker ni FCM en main. La rama de entidades tiene trabajo independiente; no se fusionó indiscriminadamente.

El usuario confirmó que no existen histórico intradía de 24 meses ni entorno bróker/FCM. Por tanto no se certifica la integración externa ni el criterio histórico.

## Entrega ejecutable

`backend/scripts/backtest.ts` importa JSON con `provenance` (source, version, synthetic), `config` (initialCapital, costBps, slippageBps, maxGapMs) y `samples` (symbol, price, eventTimeMs). Valida orden, símbolo y precios, calcula SHA-256 del dataset y guarda configuración, curva de capital, retorno, drawdown, huecos y ejecuciones.

Usa el motor DynamicStopLoss existente. Es un benchmark de posición larga inicial y liquidación completa, sin reentrada ni cobertura asimétrica; no equivale a una estrategia completa de cartera. Ejecuta en la observación posterior al trigger para evitar asumir un fill retrospectivo. Incluye comisiones y slippage. Cancela pendientes al atravesar huecos. No interpola precios ni inventa ticks históricos.

Desde backend:

```
npx --no-install ts-node scripts/backtest.ts ../reportes/sprint-4/synthetic-stress.json ../reportes/sprint-4/stress-result.json
npm test -- --runInBand --cacheDirectory=.cache/jest backtest
```

Se ejecutó un estrés sintético reproducible de 601 observaciones. Drawdown: -10,3592810786 %. Esto muestra que un salto entre señal y ejecución puede superar el límite del 2 %; no se ajustaron datos para aprobar el objetivo. El resultado histórico queda `NOT_DEMONSTRATED`.

El backlog dice «menor a -2%». Para un límite de pérdida del 2 %, el criterio matemático es drawdown firmado mayor o igual a -2 %. El informe conserva el valor firmado y llama explícitamente `riskLimitWithinTwoPercent` al criterio utilizado; hace falta aclarar esta discrepancia con quien acepta la historia.

## Pendientes reales

- Obtener un dataset licenciado intradía de NDX de 24 meses con cobertura y frecuencia adecuadas. Datos diarios no prueban reglas por minuto; QQQ debe identificarse como proxy.
- Implementar o recibir el conector sandbox del bróker y FCM/dispositivo de prueba; la suite E2E existente usa dobles y Socket.IO.
- Validar la estrategia de cobertura, posiciones y reentrada que se quiere medir. El benchmark de liquidación no demuestra el motor asimétrico completo.
- Remediar y verificar TLS y cifrado de almacenamiento del despliegue; la auditoría anterior continúa sin aprobar esos criterios.

No se marcaron tareas como completadas en ClickUp ni se afirmó cumplimiento de 24 meses, drawdown objetivo, publicación móvil o integración productiva.
