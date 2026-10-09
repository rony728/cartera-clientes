require('dotenv').config();

const readline = require('node:readline');
const { Writable } = require('node:stream');
const { closeDatabase, pool } = require('../database');
const users = require('../auth/repository');
const { hashPassword, validatePassword } = require('../auth/password');

function question(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

function hiddenQuestion(rl, output, prompt) {
  output.write(prompt);
  output.muted = true;
  return new Promise((resolve) => rl.question('', (answer) => {
    output.muted = false;
    output.write('\n');
    resolve(answer);
  }));
}

async function main() {
  if (!process.stdin.isTTY) {
    throw new Error('Este procedimiento requiere una consola interactiva segura.');
  }

  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!this.muted) process.stdout.write(chunk, encoding);
      callback();
    }
  });
  output.muted = false;
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });

  try {
    const usuario = (await question(rl, 'Usuario: ')).trim().toLowerCase();
    const nombre = (await question(rl, 'Nombre: ')).trim();
    const password = await hiddenQuestion(rl, output, 'Contraseña: ');
    const confirmation = await hiddenQuestion(rl, output, 'Confirmar contraseña: ');

    if (!/^[A-Za-z0-9._-]{3,64}$/u.test(usuario) || nombre.length < 1 || nombre.length > 120) {
      throw new Error('Usuario o nombre inválido.');
    }
    if (!validatePassword(password)) {
      throw new Error('La contraseña debe tener 12-128 caracteres, mayúscula, minúscula, número y símbolo.');
    }
    if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');

    const created = await users.createFirstAdmin(pool, {
      usuario,
      nombre,
      passwordHash: await hashPassword(password)
    });
    process.stdout.write(`Administrador creado: ${created.usuario} (id ${created.id}).\n`);
  } finally {
    rl.close();
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error(`No se pudo crear el administrador: ${error.message}`);
  process.exitCode = 1;
});
