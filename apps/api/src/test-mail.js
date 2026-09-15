const { sendTestMail } = require('./mail');

sendTestMail()
  .then(({ to, subject }) => {
    console.log(`Correo enviado correctamente a ${to}. Asunto: ${subject}`);
  })
  .catch((error) => {
    console.error(`No se pudo enviar el correo: ${error.message}`);
    process.exitCode = 1;
  });
