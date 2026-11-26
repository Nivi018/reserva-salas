export const loginStyle = `
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.25rem;
    font: 1rem/1.5 system-ui, sans-serif; background: #f2f7fb; color: #172d46; }
  main { width: min(100%, 25rem); background: white; padding: clamp(1.25rem, 6vw, 2rem);
    border: 1px solid #cbd6e0; border-radius: 1rem; box-shadow: 0 8px 30px #173e6014; }
  h1 { font-size: 1.8rem; line-height: 1.15; margin: 0 0 .5rem; }
  p { margin: 0 0 1.5rem; color: #40576d; }
  form { display: grid; }
  label { font-weight: 600; margin-bottom: .35rem; }
  input, button { font: inherit; border: 1px solid #8b9dad; border-radius: .5rem; padding: .65rem .75rem; }
  input { margin-bottom: 1rem; min-width: 0; }
  button { color: white; background: #164574; font-weight: 600; cursor: pointer; }
  button:hover { background: #103456; }
  :focus-visible { outline: 3px solid #4075a5; outline-offset: 2px; }
  [role=alert] { color: #8b1a1a; background: #fff2f2; border-radius: .5rem; padding: .65rem .75rem; }
  main.account { width: min(100%, 45rem); }
  section { margin-top: 1.5rem; border-top: 1px solid #cbd6e0; }
  h2 { font-size: 1.2rem; }
  ul { padding: 0; list-style: none; }
  li { padding: .75rem 0; border-bottom: 1px solid #cbd6e0; overflow-wrap: anywhere; }
  li form { display: inline-block; margin-left: .5rem; }
  li details form { display: grid; max-width: 24rem; margin: .75rem 0; }
  summary { cursor: pointer; }
  a { color: #164574; }
`

export function loginPage(error: 'credentials' | 'limit' | null = null) {
  const message = error === 'credentials' ? 'Correo, usuario o contraseña incorrectos.'
    : error === 'limit' ? 'Demasiados intentos. Vuelve a probar en un minuto.' : ''

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Iniciar sesión · Reserva Salas</title>
    <link rel="stylesheet" href="/login.css">
  </head>
  <body>
    <main>
      <h1>Iniciar sesión</h1>
      <p>Acceso local a Reserva Salas con tu cuenta.</p>
      ${message ? `<p role="alert">${message}</p>` : ''}
      <form method="post" action="/login">
        <label for="username">Correo o usuario</label>
        <input id="username" name="username" autocomplete="username" required maxlength="254">
        <label for="password">Contraseña</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256">
        <button type="submit">Entrar</button>
      </form>
    </main>
  </body>
</html>`
}

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char] ?? '')

export function accountPage(account: Account, users: Account[], feedback: { error?: string; notice?: string }) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mi cuenta · Reserva Salas</title>
  <link rel="stylesheet" href="/login.css">
</head>
<body><main class="account">
  <p><a href="/">Volver al calendario</a></p>
  <h1>Mi cuenta</h1>
  <p>${escape(account.username)} · ${escape(account.email)} · ${account.role === 'admin' ? 'Administración' : 'Miembro'}</p>
  ${feedback.error ? `<p role="alert">${escape(feedback.error)}</p>` : ''}
  ${feedback.notice ? `<p role="status">${escape(feedback.notice)}</p>` : ''}
  <section>
    <h2>Cambiar contraseña</h2>
    <form method="post" action="/cuenta/clave">
      <label for="current">Contraseña actual</label>
      <input id="current" name="current" type="password" autocomplete="current-password" required maxlength="256">
      <label for="new">Contraseña nueva</label>
      <input id="new" name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="256">
      <label for="confirm">Repite la contraseña nueva</label>
      <input id="confirm" name="confirm" type="password" autocomplete="new-password" required minlength="12" maxlength="256">
      <button type="submit">Cambiar contraseña</button>
    </form>
  </section>
  ${account.role === 'admin' ? `<section>
    <h2>Usuarios</h2>
    <ul>${users.map((user) => `<li><strong>${escape(user.username)}</strong> · ${escape(user.email)} ·
      ${user.role === 'admin' ? 'Administración' : user.active ? 'Activo' : 'Desactivado'}
      ${user.role === 'member' ? `<form method="post" action="/cuenta/estado">
        <input type="hidden" name="id" value="${escape(user.id)}">
        <button type="submit" name="active" value="${user.active ? 'no' : 'yes'}">${user.active ? 'Desactivar' : 'Activar'}</button>
      </form>
      <details>
        <summary>Restablecer contraseña de ${escape(user.username)}</summary>
        <form method="post" action="/cuenta/restablecer">
          <input type="hidden" name="id" value="${escape(user.id)}">
          <label for="reset-${escape(user.id)}">Contraseña nueva</label>
          <input id="reset-${escape(user.id)}" name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="256">
          <label for="confirm-${escape(user.id)}">Repite la contraseña nueva</label>
          <input id="confirm-${escape(user.id)}" name="confirm" type="password" autocomplete="new-password" required minlength="12" maxlength="256">
          <button type="submit">Restablecer contraseña</button>
        </form>
      </details>` : ''}</li>`).join('')}</ul>
    <h2>Crear usuario</h2>
    <form method="post" action="/cuenta/usuarios" autocomplete="off">
      <label for="new-user">Nombre de usuario</label>
      <input id="new-user" name="username" required minlength="3" maxlength="32">
      <label for="new-email">Correo electrónico</label>
      <input id="new-email" name="email" type="email" required maxlength="254">
      <label for="new-password">Contraseña inicial (mínimo 12 caracteres)</label>
      <input id="new-password" name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="256">
      <button type="submit">Crear usuario</button>
    </form>
  </section>` : ''}
</main></body></html>`
}
import type { Account } from './accounts.js'
