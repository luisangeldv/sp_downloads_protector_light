
# Downloads Protector (Cloud) — Extension (MV3)

Extensión ligera. Delegará la protección/renombrado al servicio cloud (Render).

## Instalación (Chrome/Edge/Firefox Nightly con MV3)
1. Build no requerido: es puro JS.
2. Abre `chrome://extensions` → "Load unpacked" → elige esta carpeta.
3. En Opciones, indica la **URL del servicio** (Render) y abre el panel para **iniciar sesión con EntraID** y obtener tu **API key**.
4. Verifica con "Probar conexión".

## Permisos
- `downloads`, `storage`, `cookies` para poder pausar/cancelar descargas y capturar cookies de sesión en dominios de descarga cuando sea necesario.
- `host_permissions: *://*/*` para observar URLs de descarga (restringe en producción a tus dominios).

## Cómo funciona
- Intercepta `downloads.onCreated`, coteja la URL contra patrones remotos.
- Si coincide, **pausa** el original, solicita al backend `POST /api/proxy-protect` con la URL y cookies capturadas (si hiciera falta).
- El backend descarga el fichero, lo **protege con SealPath REST SDK** y devuelve una URL temporal al fichero protegido.
- La extensión **cancela** el original y descarga el protegido.
- El histórico se envía a `/api/history` (remoto).

## Limitaciones
- Algunas fuentes requieren cookies/headers. La extensión las adjunta en `x-forwarded-cookies`; asegúrate de permitir su uso en el backend.
- Restringe host_permissions para pasar la revisión de la tienda.
