require('dotenv').config();
require('isomorphic-fetch');

const { Client } = require('@microsoft/microsoft-graph-client');
const { getAccessToken } = require('./auth');

async function sendMail({ subject, body } = {}) {
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
      body: { contentType: 'Text', content: mailBody },
      toRecipients: [{ emailAddress: { address: to } }]
    },
    saveToSentItems: true
  });

  return { to, subject: mailSubject };
}

async function sendTestMail() {
  return sendMail();
}

module.exports = { sendMail, sendTestMail };
