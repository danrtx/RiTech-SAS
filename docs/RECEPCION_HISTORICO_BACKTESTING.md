# Recepción del histórico para backtesting

La herramienta recibe JSON; no descarga datos ni necesita credenciales. Valida antes de ejecutar y conserva una huella SHA-256 del texto recibido. No ordena, rellena, interpola ni elimina observaciones silenciosamente.

## Formato

Ejemplo **sintético**, únicamente para explicar el contrato:

```json
{
  "provenance": {
    "source": "Ejemplo sintético de documentación",
    "version": "1",
    "synthetic": true
  },
  "config": {
    "initialCapital": 10000,
    "costBps": 1,
    "slippageBps": 1,
    "maxGapMs": 2000
  },
  "samples": [
    { "symbol": "NDX", "price": 100, "eventTimeMs": 1704067200000 },
    { "symbol": "NDX", "price": 99, "eventTimeMs": 1704067201000 }
  ]
}
```

| Campo | Requisito |
| --- | --- |
| `source`, `version` | Texto no vacío; adjuntar por separado referencia del proveedor, extracción y permiso/licencia. |
| `synthetic` | Booleano explícito. `false` declara procedencia real, pero no la acredita automáticamente. |
| `initialCapital` | Número finito positivo. |
| `costBps`, `slippageBps` | Números finitos entre 0 incluido y 10000 excluido. Un punto básico equivale a 0,01 %. |
| `maxGapMs` | Número finito positivo; continuidad/frescura del modelo. El motor en vivo usa 2000 ms. |
| `symbol` | Un solo símbolo por archivo, consistente; letras, números, punto, guion o guion bajo, máximo 32 caracteres. |
| `price` | Número finito positivo; informar si es operación, cotización o cierre de barra. |
| `eventTimeMs` | Entero representable como fecha, UTC en milisegundos desde epoch, estrictamente creciente y sin duplicados. |

Se requieren al menos dos observaciones para ejecutar, pero ese mínimo no satisface la historia de 24 meses. Los duplicados se rechazan para que el proveedor defina cómo resolver observaciones con el mismo timestamp; no se escoge un precio arbitrariamente.

## Uso

Desde `backend`:

```powershell
npm run backtest:validate -- C:/datos/historico.json ../reportes/historico/validacion.json
npm run backtest -- C:/datos/historico.json ../reportes/historico/resultado.json
```

El primer comando solo inspecciona; el segundo añade curva de capital, ejecuciones y métricas del benchmark. Ambos crean la carpeta de salida y devuelven código 1 ante entrada inválida. No usar la misma ruta para entrada y salida. Un archivo bien formado puede devolver código 0 y tener `historicalAcceptance: NOT_DEMONSTRATED`: el código de salida verifica ejecución, no aceptación del requisito.

El informe muestra instrumento, rango, intervalo mínimo/máximo, discontinuidades mayores que `maxGapMs` y hasta 20 ejemplos de huecos. QQQ se etiqueta como proxy. Los datos sintéticos, menos de 24 meses, un instrumento distinto de NDX o ausencia de observaciones intradía impiden demostrar el requisito. Incluso con esos controles satisfechos, queda `REQUIRES_SOURCE_AND_COVERAGE_REVIEW`, nunca aprobación automática.

## Comprobaciones humanas antes de aceptación

1. Verificar fuente, licencia, versión, fecha de extracción y hash del archivo recibido.
2. Confirmar NDX o aprobación explícita de QQQ como proxy y significado de cada precio.
3. Comparar cobertura con calendario de mercado, sesiones, festivos y frecuencia prometida. Las discontinuidades incluyen cierres normales; no equivalen automáticamente a datos perdidos.
4. Verificar que la resolución permita evaluar la regla. Datos por minuto no prueban una regla de frescura de dos segundos. Cambiar `maxGapMs` modifica el modelo, no recupera muestras ausentes.
5. Aprobar estrategia, costos, cantidades y objetivo de drawdown antes de interpretar resultados.

El evaluador actual mantiene una posición larga inicial y liquida en la observación posterior a la señal; no implementa reentrada ni cartera con cobertura asimétrica. El reporte puede mostrar incumplimiento del límite: no ajustar datos ni umbrales para ocultarlo.

## Límite de tamaño

La implementación actual carga el JSON completo en memoria y el benchmark genera una curva por observación. Antes de usar 24 meses de ticks de alta frecuencia hay que medir tamaño y memoria disponibles; la validación no es streaming. Si el archivo excede esa capacidad, hará falta una ingestión incremental que preserve estado entre bloques. Dividir archivos y reiniciar el motor por bloque no produce un backtest equivalente.
