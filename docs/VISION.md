# Visión

**Un sistema solar navegable donde todo —del Sol a los anillos de Saturno— está hecho de partículas, y cuanto más te acercas, más partículas aparecen, hasta poder bajar a la superficie de un planeta.**

## Decisiones cerradas

| Tema | Decisión |
|---|---|
| Plataforma | **App web** (navegador). WebGPU como objetivo, WebGL2 como respaldo. |
| Estilo | **Realista con toque artístico**: datos reales (texturas NASA, órbitas JPL), pero con bloom, colores algo saturados y partículas que brillan. |
| Escala | **Comprimida por defecto** (bonita y explorable) con **escala real** como opción conmutable en caliente. |
| Profundidad | **Hasta la superficie**: el detalle de partículas crece de forma continua desde la vista del sistema completo hasta el suelo. |
| Navegación | Vuelo libre (6DOF), órbita alrededor de un cuerpo y viaje cinematográfico (clic → ir). |

## Experiencia objetivo

1. Abres la web y ves el sistema solar entero: el Sol hirviendo en el centro, planetas como nubes de puntos de color siguiendo sus órbitas, el cinturón de asteroides y un fondo de estrellas real.
2. Haces clic en la Tierra: la cámara viaja, las partículas se estiran por la velocidad (efecto *warp*) y al llegar la Tierra se **condensa** desde el polvo.
3. Orbitas la Tierra: continentes, océanos, nubes que se mueven, luces de ciudades en el lado nocturno y el borde de la atmósfera brillando.
4. Bajas: aparecen montañas en relieve hechas de millones de partículas, hasta casi tocar el suelo.
5. Activas "escala real" y entiendes lo vacío y enorme que es el sistema solar.

## Lo que NO es (por ahora)

- No es un simulador físico N-cuerpos: las órbitas son keplerianas analíticas.
- No es un juego con objetivos: es una experiencia de exploración.
- No hay multijugador ni backend: todo es estático y corre en el cliente.
