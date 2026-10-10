require('dotenv').config();
require('isomorphic-fetch');

const { Client } = require('@microsoft/microsoft-graph-client');
const { getAccessToken } = require('./auth');
const { POWER_AUTOMATE_FIELD_SET } = require('./terminales/fields');

async function sendMail({ subject, body, contentType = 'Text' } = {}) {
  const to = process.env.MAIL_TO;
  if (!to) {
    throw new Error('Falta MAIL_TO en el archivo .env.');
  }

  const accessToken = await getAccessToken();
  const graphClient = Client.init({
    authProvider: (done) => done(null, accessToken)
  });

  const mailSubject = subject || process.env.MAIL_SUBJECT || 'ACTUALIZAR_CARTERA|00000000|99999999';
  const mailBody = body || process.env.MAIL_BODY || 'Solicitud de actualización de cartera.';

  await graphClient.api('/me/sendMail').post({
    message: {
      subject: mailSubject,
      body: { contentType, content: mailBody },
      toRecipients: [{ emailAddress: { address: to } }]
    },
    saveToSentItems: true
  });

  return { to, subject: mailSubject };
}

async function sendTestMail() {
  return sendMail();
}

function buildPowerAutomateV2Mail(terminal, changes) {
  if (typeof terminal !== 'string' || terminal.length === 0) {
    throw new TypeError('La Terminal del correo V2 no es válida.');
  }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new TypeError('Los cambios del correo V2 no son válidos.');
  }
  const entries = Object.entries(changes);
  if (entries.length === 0) throw new TypeError('El correo V2 requiere al menos un cambio.');
  for (const [field, value] of entries) {
    if (!POWER_AUTOMATE_FIELD_SET.has(field) || (value !== null && typeof value !== 'string')) {
      throw new TypeError('El correo V2 contiene un campo o valor no admitido.');
    }
  }
  return {
    subject: 'ACTUALIZAR_CARTERA_V2',
    body: JSON.stringify({ version: 2, terminal, cambios: changes }),
    contentType: 'Text'
  };
}

module.exports = { buildPowerAutomateV2Mail, sendMail, sendTestMail };
