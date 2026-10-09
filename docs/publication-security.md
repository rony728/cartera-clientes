# Preparación para publicación

Antes de hacer público el repositorio se aplicaron estas medidas:

- sustitución de identificadores operativos usados inicialmente como ejemplos por datos inequívocamente ficticios;
- uso de la dirección `noreply` correspondiente a la cuenta para la identidad Git futura y para los metadatos saneados;
- ampliación de las exclusiones de Git para archivos de entorno, credenciales, llaves, cachés de autenticación y volcados locales;
- generalización de rutas, usuarios y nombres de procesos propios del despliegue;
- verificación del árbol y del historial para descartar secretos y datos operativos retirados.

Los archivos `.env`, cachés MSAL, snapshots y datos exportados deben permanecer siempre fuera de Git. Los valores de `.env.example` son exclusivamente marcadores o datos sintéticos.

La publicación del historial reescrito requiere una revisión manual y una actualización explícita de la rama remota. La visibilidad del repositorio debe cambiarse solamente después de comprobar que la rama remota contiene el historial saneado.
