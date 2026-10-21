## Contexto
<!-- Qué issue o feature resuelve este cambio. Usa "Closes #N" al final para que GitHub cierre el issue. -->

## Problemática
<!-- Qué problema o necesidad hay. -->

## Qué cambia
<!-- Los cambios concretos, en viñetas. -->

## Por qué
<!-- La razón de las decisiones tomadas. -->

## Observaciones
<!-- Revisión nativa y su resultado, riesgos, costo ($0), decisiones pendientes, lo que queda para otro issue. -->

## Alcances
<!-- Incluye / No incluye. -->

## Pruebas
<!-- Regla del proyecto (AGENTS.md, "Definition of done"): cada entrega incluye todas las pruebas que le corresponden. -->
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`: limpios.
- [ ] Pruebas unitarias nuevas o ajustadas (RED observado primero en el dominio).
- [ ] Pruebas de base de datos (`pnpm test:db`) si toca migraciones, tablas, privilegios, SQL o la conexión. Si no aplica, explicar por qué:
- [ ] Pruebas E2E (`pnpm test:e2e`) si toca una pantalla, un flujo, una etiqueta, un rol o un permiso. Si no aplica, explicar por qué:
- [ ] Prueba de regresión por cada defecto corregido.
- [ ] CI en verde: `verify`, `database` y `e2e`.

Closes #
