'use strict';

/** Erro HTTP semântico do contrato do Studio (compartilhado). */
function httpError(code, status, message) {
  const err = new Error(message || code);
  err.code = code;
  err.status = status;
  return err;
}

module.exports = { httpError };
